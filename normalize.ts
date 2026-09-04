import type { BrokerPosition } from "gloomberb/types/broker";
import type { BrokerAccount } from "gloomberb/types/trading";

export interface BrokerPortfolioSnapshot {
  accounts: BrokerAccount[];
  positions: BrokerPosition[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replaceAll(",", ""))
        : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nested(source: UnknownRecord, key: string): UnknownRecord {
  return record(source[key]) ?? {};
}

function accountId(source: UnknownRecord): string {
  return text(
    source.accountId,
    source.account_id,
    source.accountNumber,
    source.account_number,
    source.brokerageAccountId,
    source.brokerage_account_id,
  );
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[_\s-])([a-z])/g, (_match, prefix: string, letter: string) => (
    `${prefix === "_" ? " " : prefix}${letter.toUpperCase()}`
  ));
}

function withCanonicalShares(position: BrokerPosition): BrokerPosition {
  const side = position.side ?? (position.shares < 0 ? "short" : "long");
  const shares = Math.abs(position.shares);
  if (shares === position.shares && side === position.side) return position;
  return { ...position, shares, side };
}

function sumOptional(left?: number, right?: number): number | undefined {
  if (left == null && right == null) return undefined;
  return (left ?? 0) + (right ?? 0);
}

/**
 * One row per holding. A broker can report the same holding more than once —
 * separate tax lots, or one row per sub-account — and keeping only the last one
 * silently understates the position.
 */
function mergeIdenticalPositions(positions: BrokerPosition[]): BrokerPosition[] {
  const merged = new Map<string, BrokerPosition>();
  for (const position of positions) {
    const key = [
      position.accountId ?? "",
      position.ticker,
      position.assetCategory ?? "",
      position.exchange ?? "",
      position.brokerContract?.conId ?? "",
    ].join(":");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, position);
      continue;
    }
    const shares = existing.shares + position.shares;
    const existingCost = (existing.avgCost ?? 0) * existing.shares;
    const nextCost = (position.avgCost ?? 0) * position.shares;
    merged.set(key, {
      ...existing,
      shares,
      avgCost: shares !== 0 ? (existingCost + nextCost) / shares : existing.avgCost,
      marketValue: sumOptional(existing.marketValue, position.marketValue),
      unrealizedPnl: sumOptional(existing.unrealizedPnl, position.unrealizedPnl),
    });
  }
  return [...merged.values()];
}

function uniqueSnapshot(accounts: BrokerAccount[], positions: BrokerPosition[]): BrokerPortfolioSnapshot {
  const uniqueAccounts = [...new Map(accounts.map((account) => [account.accountId, account])).values()];
  const knownAccounts = new Set(uniqueAccounts.map((account) => account.accountId));
  for (const position of positions) {
    if (!position.accountId || knownAccounts.has(position.accountId)) continue;
    knownAccounts.add(position.accountId);
    uniqueAccounts.push({
      accountId: position.accountId,
      name: position.accountId,
      currency: position.currency,
    });
  }
  return { accounts: uniqueAccounts, positions: mergeIdenticalPositions(positions.map(withCanonicalShares)) };
}

export function normalizePublicSnapshot(accountsPayload: unknown, portfolioPayloads: unknown[]): BrokerPortfolioSnapshot {
  const accountRecords = record(accountsPayload)?.accounts;
  const accounts = (Array.isArray(accountRecords) ? accountRecords : []).flatMap((value): BrokerAccount[] => {
    const item = record(value);
    if (!item) return [];
    const id = accountId(item);
    if (!id) return [];
    const type = text(item.accountType, item.account_type);
    return [{ accountId: id, name: type ? `Public ${titleCase(type)}` : `Public ${id}`, currency: "USD" }];
  });

  const positions: BrokerPosition[] = [];
  for (const value of portfolioPayloads) {
    const portfolio = record(value);
    if (!portfolio) continue;
    const id = accountId(portfolio);
    const knownAccount = accounts.find((account) => account.accountId === id);
    if (knownAccount) {
      knownAccount.netLiquidation = numberValue(portfolio.totalAccountValue, portfolio.total_account_value);
      knownAccount.totalCashValue = numberValue(portfolio.cash);
      knownAccount.buyingPower = numberValue(nested(portfolio, "buyingPower").buyingPower);
    }
    const rawPositions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
    for (const rawPosition of rawPositions) {
      const item = record(rawPosition);
      if (!item) continue;
      const instrument = nested(item, "instrument");
      const lastPrice = nested(item, "lastPrice");
      const costBasis = nested(item, "costBasis");
      const symbol = text(instrument.symbol, item.symbol).toUpperCase();
      const shares = numberValue(item.quantity);
      if (!symbol || shares == null || shares === 0) continue;
      positions.push({
        ticker: symbol,
        exchange: "SMART",
        shares,
        avgCost: numberValue(costBasis.unitCost, costBasis.unit_cost),
        currency: "USD",
        accountId: id || undefined,
        name: text(instrument.name, symbol),
        assetCategory: text(instrument.type, "STK").toUpperCase() === "EQUITY" ? "STK" : text(instrument.type, "STK").toUpperCase(),
        markPrice: numberValue(lastPrice.lastPrice, lastPrice.last_price),
        marketValue: numberValue(item.currentValue, item.current_value),
        unrealizedPnl: numberValue(costBasis.gainValue, costBasis.gain_value),
        percentOfNav: numberValue(item.percentOfPortfolio, item.percent_of_portfolio),
        dateAcquired: text(item.openedAt, item.opened_at) || undefined,
        side: shares < 0 ? "short" : "long",
      });
    }
  }
  return uniqueSnapshot(accounts, positions);
}
