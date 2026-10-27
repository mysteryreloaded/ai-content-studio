# Deploying the studio

How an Operator runs the app itself — the `studio` container, its
Postgres and HTTPS in front of it. For turning a GPU machine into a
Backend, see [backend-kit.md](backend-kit.md); that's a separate host.
For daily backups, restore and the quarterly restore drill, see
[backup.md](backup.md) — `ops/studio/upgrade.sh`'s own backup step
below is a one-off safety net for an upgrade, not a substitute for
that. The other operator docs live beside this one: [GPU Backends](backend-kit.md),
[Backups](backup.md), [Monitoring](monitoring.md),
[Building a Model](model-building.md), [the consent
screen](consent.md), [Site terms](site-terms.md),
[Privacy](privacy.md) and [Releasing](releasing.md) — plus
[Model licenses and AI rules](../licensing.md) and the reference for
every environment variable in [server-env.md](../server-env.md).

## The default path: one Compose file, one `.env`

1. Install [Docker Engine](https://docs.docker.com/engine/install/) with
   the Compose plugin on the VPS that will host the studio.
2. Copy `docker-compose.yml`, `.env.example`, `ops/caddy/Caddyfile` and
   `ops/studio/upgrade.sh` to that host, keeping the same relative layout
   (`ops/caddy/Caddyfile` and `ops/studio/upgrade.sh` next to
   `docker-compose.yml`, not flattened) — Compose bind-mounts the
   Caddyfile from that path and `upgrade.sh` finds the compose directory
   from its own. Easiest: clone the repo at the release tag you're
   deploying and work from there instead of copying files individually.
3. Copy `.env.example` to `.env` and fill it in: `STUDIO_VERSION` (a
   released version — the images are published at
   `ghcr.io/mysteryreloaded/ai-content-studio`, and the package page on
   the [repository](https://github.com/mysteryreloaded/ai-content-studio)
   lists them; never `latest`), `DOMAIN`, `PUBLIC_URL`, the Google OAuth
   credentials,
   `ADMIN_EMAILS`, and a `SECRET_KEY` from `openssl rand -base64 32`. See
   [server-env.md](../server-env.md) for what each one does, and change
   `POSTGRES_PASSWORD` before the first start.
4. `docker compose up -d`. This pulls `studio`, `postgres` and `caddy`
   and starts all three: Caddy requests a certificate for `DOMAIN` from
   Let's Encrypt automatically and proxies `443`/`80` to `studio`, which
   waits for Postgres to report healthy, then runs any pending migrations
   under an advisory lock before it starts serving.
5. Point `DOMAIN`'s DNS `A`/`AAAA` record at the host, if you haven't
   already — Caddy needs it resolvable to issue the certificate.

The image is multi-arch (`linux/amd64`, `linux/arm64`). A release is cut
in two steps, described in [releasing.md](releasing.md): a maintainer
first tags a **candidate** (`vX.Y.Z-rc.N`), which runs the full gate
(including an upgrade check and native boots) and pushes
`ghcr.io/mysteryreloaded/ai-content-studio:X.Y.Z-rc.N`; once the release
issue's checklist is ticked, the maintainer tags **`vX.Y.Z`**, which
re-tags that candidate's digest as `X.Y.Z` (and `:latest`, for browsing
the package page only) without rebuilding — the final image is the exact
digest the gate already ran. Pin `STUDIO_VERSION` to the numbered tag,
never to `latest`.

## Google OAuth client

The Studio signs users in with their own Google accounts over OpenID
Connect. The one thing you have to create yourself is an OAuth client,
in the [Google Cloud console](https://console.cloud.google.com):

1. **APIs & Services → Credentials → Create credentials → OAuth
   client ID**, application type **Web application**.
2. Under **Authorized origins**, add your `PUBLIC_URL`'s origin (e.g.
   `https://studio.example.com`).
3. Under **Authorized redirect URIs**, add
   `<PUBLIC_URL>/api/auth/google/callback` exactly — e.g.
   `https://studio.example.com/api/auth/google/callback`. The Studio
   always redirects to this URL.
4. Copy the **Client ID** and **Client secret** into `.env` as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see
   [server-env.md](../server-env.md) for the full list).

The details the Studio needs from Google:

- it calls the standard issuer `https://accounts.google.com` with the
  scopes `openid email profile` — nothing else to request;
- the sign-in is PKCE (S256) with the client secret held
  server-side, so no extra configuration is needed;
- **unverified email addresses are refused**: the ID token's
  `email_verified` must be true or the sign-in fails, so a Google
  account with an unverified address simply can't get in;
- **the redirect URI is pinned to `PUBLIC_URL`'s origin.** If you ever
  change `PUBLIC_URL` (say, moving to a new domain), add the new
  `<new PUBLIC_URL>/api/auth/google/callback` to the same client
  *before* the switch — an origin Google doesn't recognize fails the
  sign-in with an error from Google's side, not yours.

For local development the repo ships a mock issuer: point
`OIDC_ISSUER` at `http://localhost:3000/mock-oidc` (the checked-in
dev `.env` does) — the mock is only served when `PUBLIC_URL` is
`localhost` or `127.0.0.1`, so it can't be confused with a real
deployment. No Google client is needed to try the Studio locally.

## Upgrading

`ops/studio/upgrade.sh`, run from the directory holding
`docker-compose.yml` and `.env`: it's the whole path, back up, pull, up.

1. **Back up**: dumps Postgres and tars the `studio` data volume (Uploads
   and Assets) into `backups/<timestamp>/` next to the compose file.
2. **Pull**: `docker compose pull` — set `STUDIO_VERSION` in `.env` to the
   new release first.
3. **Up**: `docker compose up -d` — `studio` runs migrations under its
   lock before serving, same as any other start.

Each published release passed an **upgrade check** before its final tag
was cut ([releasing.md](releasing.md)): its image booted on a database
and `/data` seeded by the previous release and came up healthy, migrated
and with `check-storage` clean. The backup in step 1 is still the safety
net — the check proves the path is sound, it does not replace the backup.

Keep a few backups around and copy them off the host; the script only
writes them locally.

## Alternatives to Caddy

`caddy` has no `profiles:` entry in `docker-compose.yml`, so it's part of
Compose's implicit default profile and comes up with everything else. To
use one of these instead, run `docker compose up -d studio postgres` (never
starting `caddy`) and put one of the following in front of `studio:3000`
yourself.

### nginx

Three settings matter for this app specifically, beyond the usual
`proxy_pass`:

- **No response buffering** (`proxy_buffering off;`) — the Generation
  stream (`/api/generations/stream`, issue #43) is Server-Sent Events;
  buffered, it arrives in bursts or not at all until the connection ends.
- **A body size limit of at least 20 MB** (`client_max_body_size 20m;`) —
  below the largest video Upload this app accepts.
- **A long proxy timeout** (`proxy_read_timeout 300s;` or more) — an SSE
  connection and a slow Upload both hold the connection open well past
  nginx's 60-second default.

### A named Cloudflare Tunnel

Run `cloudflared` as its own system service (not inside this Compose
stack, the same way Tailscale runs for [Backends](backend-kit.md)),
pointed at `http://localhost:3000` with a **named** tunnel bound to your
own hostname in the Cloudflare dashboard.

**Quick Tunnels are unsupported.** A Quick Tunnel's `trycloudflare.com`
hostname is generated fresh every run, which breaks the OAuth
`redirect_uri` Google has on file for `PUBLIC_URL` and gives every visitor
a different, unverifiable origin. Use a named tunnel with a domain you
control, or one of the options above.
