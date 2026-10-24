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
them. Pinned status is read live against this list on every request, not
stored, so removing an email unpins that Admin immediately without
demoting them — they stay an Admin until a (now-possible) demote.
Required; refused if empty.

## `oidc_issuer`

### `OIDC_ISSUER`

Overrides the OIDC issuer used for sign-in, for the in-repo mock issuer
in dev and tests. Refused unless `PUBLIC_URL` points at `localhost` or
`127.0.0.1`, so it can never be set in a real deployment. Leave unset to
sign in against Google.

## `data_dir`

### `DATA_DIR`

The directory the local-disk `storage` module writes to (Site settings'
logo and background images today). Defaults to `/data`.

## `secret_key`

### `SECRET_KEY`

Base64 for exactly 32 bytes, used as the AES-256-GCM key that encrypts
Backend credentials at rest (issue #39). Generate one with
`openssl rand -base64 32`. Required. Changing it makes every stored
Backend credential undecryptable — re-enter them after a rotation.

## `backends_enabled`

### `BACKENDS_ENABLED`

`true` or `false`. When `false`, the studio never contacts any Backend
(no health polling) and Admins see a banner saying so. Defaults to
`true`.

## `status_token`

### `STATUS_TOKEN`

A bearer token the Operator's outside monitor sends as
`Authorization: Bearer <token>` to call `GET /api/status` without an
Admin session (issue #70). Optional; while unset, `/api/status` can only
be called with an Admin session.

## `min_free_disk_gb`

### `MIN_FREE_DISK_GB`

The floor, in GB, the retention jobs (issue #69) try to keep free on
`DATA_DIR`'s disk. The Overview's `disk_low` Problem fires once free
space drops below twice this value, so an Admin has warning before
retention's own floor is hit. Below this floor, the studio also refuses
new Upload chunks and new Submissions with "storage is full, try later"
(issue #50); saving a running Generation's Assets ignores it. Defaults
to `10`.

## `max_upload_mb`

### `MAX_UPLOAD_MB`

The largest Upload, in MB (1 MB = 1,048,576 bytes), a user may send
(issue #50). Checked when an Upload is created, on every chunk and when
it completes; also the ceiling on an Image Upload Input's own max size,
and sent to the browser in the current-user response so a too-large
file is refused on pick. Defaults to `500`.

## `ffmpeg_concurrency`

### `FFMPEG_CONCURRENCY`

The most ffmpeg/ffprobe processes Asset finishing (issue #45) runs at
once; each also gets a share of the box's CPU threads, so a burst of
saves can't starve it. Defaults to `2`.

## `c2pa_cert_path`

### `C2PA_CERT_PATH`

Path (inside the container) to a PEM certificate chain used to sign
every Asset's C2PA manifest after it's finished (issue #75): the
end-entity certificate first, then any intermediates, ending before the
root CA. Must be set together with `C2PA_KEY_PATH`; leave both unset to
skip C2PA signing (Assets still get their existing "AI-generated" tag).
A relative path is resolved against the server's working directory at
boot — `c2patool` itself would otherwise resolve a relative path
against the manifest file's folder (the Asset's own storage directory),
not the server's. `c2patool` has no arm64 Linux build, so signing is
also skipped on an arm64 box, and for a file format `c2patool` doesn't
support (notably `webm` video and `ogg`/`opus` audio).

## `c2pa_key_path`

### `C2PA_KEY_PATH`

Path (inside the container) to the PEM private key matching
`C2PA_CERT_PATH`'s end-entity certificate. Must be set together with it.
A relative path is resolved against the server's working directory at
boot (not against the manifest file c2patool reads it from, which sits
in the Asset's own storage directory).

The key's own type decides the signing algorithm c2patool uses — the
server works this out once at boot with `node:crypto`, rather than
leaving it to c2patool's default (which is always `es256`, silently
wrong for any other key and resulting in a signing failure, and so
only the "AI-generated" tag, on every Asset). Supported key types:

- EC on the P-256, P-384 or P-521 curve → ES256, ES384 or ES512
- RSA → PS256
- Ed25519 → Ed25519

Any other key type (or a path that isn't a readable PEM private key)
fails the server at boot with a clear error, instead of warning on
every Asset.

## `c2pa_timestamp_url`

### `C2PA_TIMESTAMP_URL`

An optional RFC 3161 Time Authority URL (e.g.
`http://timestamp.digicert.com`) `c2patool` uses so a signed manifest
stays verifiable after the certificate expires. Requires
`C2PA_CERT_PATH`/`C2PA_KEY_PATH` to be set; needs a live connection to
that URL at signing time.
