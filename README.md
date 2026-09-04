# gloomberb-public

Read-only account and position sync for [Public](https://public.com) in [Gloomberb](https://github.com/gloom-sh/gloomberb).

```bash
gloomberb install gloom-sh/gloomberb-public
```

## Setup

1. In Public, open **Settings → API** and generate an API secret.
2. In Gloomberb, run `BROKER` (or `Ctrl+P` → "Connect a broker"), pick **Public**, and paste the secret.

Sync pulls every account on the secret, along with its holdings, cost basis, and market values.

## What it can do

Nothing but read. The secret is exchanged for an access token that Public only honours for five minutes, and every call after that exchange is a `GET` against a reporting endpoint. There is no order placement path in this plugin.

The secret is stored in your local Gloomberb config and is never sent anywhere except `api.public.com`.

## Development

```bash
bun install
bun test
bun run typecheck
```

The plugin depends on the host through the `gloomberb` package, which Gloomberb symlinks into `node_modules` at install time so there is exactly one copy of the runtime.

## License

MIT
