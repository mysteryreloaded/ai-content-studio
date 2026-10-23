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

## `public_url`

### `PUBLIC_URL`

The origin the app is served from, e.g. `https://studio.example.com` or
`http://localhost:3000` in dev. Used to build Google's `redirect_uri`, to
check the `Origin` header on unsafe requests, and to decide whether
`OIDC_ISSUER` may be set. Required.

## `google_client_id`

### `GOOGLE_CLIENT_ID`

The OAuth client ID from Google's console for this app. Required.

## `google_client_secret`

### `GOOGLE_CLIENT_SECRET`

The OAuth client secret matching `GOOGLE_CLIENT_ID`. Required.

## `admin_emails`

### `ADMIN_EMAILS`

Comma-separated, case-insensitive list of Google account emails that are
promoted to Admin, approved and re-enabled at every sign-in. Admins named
here are pinned: the admin panel can never demote, disable or delete
them. Required; refused if empty.

## `oidc_issuer`

### `OIDC_ISSUER`

Overrides the OIDC issuer used for sign-in, for the in-repo mock issuer
in dev and tests. Refused unless `PUBLIC_URL` points at `localhost` or
`127.0.0.1`, so it can never be set in a real deployment. Leave unset to
sign in against Google.
