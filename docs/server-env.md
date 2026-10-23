# Server environment variables

Checked by `apps/server/src/env.ts` at boot. A missing or invalid value
lists every failing variable and stops the process before it serves any
request.

## `database_url`

### `DATABASE_URL`

The Postgres connection string, e.g. `postgres://user:pass@host:5432/db`.
Required.

## `port`

### `PORT`

The one port the Bun process listens on for both the API and the built
SPA. Defaults to `3000`.

## `log_level`

### `LOG_LEVEL`

The minimum level the JSON-lines logger writes: `debug`, `info`, `warn`
or `error`. Defaults to `info`.
