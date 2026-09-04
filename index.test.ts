import { describe, expect, test } from "bun:test";
import { loadPublicPortfolio } from "./index";
import { normalizePublicSnapshot } from "./normalize";

describe("Public sync", () => {
  test("uses one token request and read-only portfolio requests", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/personal/access-tokens")) {
        return Response.json({ accessToken: "temporary-token" });
      }
      if (url.endsWith("/trading/account")) {
        return Response.json({ accounts: [{ accountId: "PUB-1", accountType: "BROKERAGE" }] });
      }
      return Response.json({
        accountId: "PUB-1",
        accountType: "BROKERAGE",
        totalAccountValue: "110",
        buyingPower: { buyingPower: "10" },
        positions: [{
          instrument: { symbol: "AAPL", name: "Apple", type: "EQUITY" },
          quantity: "1",
          currentValue: "100",
          lastPrice: { lastPrice: "100" },
          costBasis: { unitCost: "80", gainValue: "20" },
        }],
      });
    }) as typeof fetch;

    const snapshot = await loadPublicPortfolio("public-secret", fetchImpl);

    expect(calls.map(({ method }) => method)).toEqual(["POST", "GET", "GET"]);
    expect(calls.every(({ url }) => url.startsWith("https://api.public.com/"))).toBe(true);
    expect(snapshot.positions[0]).toEqual(expect.objectContaining({
      ticker: "AAPL",
      assetCategory: "STK",
      avgCost: 80,
    }));
  });

  test("rejects a secret with control characters before it reaches the wire", async () => {
    // A pasted secret that picked up a newline should fail here rather than
    // becoming a malformed request whose error blames Public.
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return Response.json({});
    }) as unknown as typeof fetch;

    await expect(loadPublicPortfolio("secret\nwith-newline", fetchImpl)).rejects.toThrow("exactly as Public generated it");
    expect(called).toBe(false);
  });
});

describe("Public normalization", () => {
  test("aggregates repeated lots of one holding instead of keeping the last row", () => {
    const snapshot = normalizePublicSnapshot(
      { accounts: [{ accountId: "PUB-1", accountType: "BROKERAGE" }] },
      [{
        accountId: "PUB-1",
        positions: [
          { instrument: { symbol: "AAPL" }, quantity: "2", currentValue: "200", costBasis: { unitCost: "80" } },
          { instrument: { symbol: "AAPL" }, quantity: "3", currentValue: "300", costBasis: { unitCost: "90" } },
        ],
      }],
    );

    expect(snapshot.positions).toEqual([expect.objectContaining({
      ticker: "AAPL",
      shares: 5,
      avgCost: (2 * 80 + 3 * 90) / 5,
      marketValue: 500,
    })]);
  });

  test("keeps shorts as absolute shares with a side", () => {
    const snapshot = normalizePublicSnapshot(
      { accounts: [{ accountId: "PUB-1" }] },
      [{ accountId: "PUB-1", positions: [{ instrument: { symbol: "TSLA" }, quantity: "-4", costBasis: { unitCost: "100" } }] }],
    );

    expect(snapshot.positions[0]).toEqual(expect.objectContaining({ ticker: "TSLA", shares: 4, side: "short" }));
  });
});
