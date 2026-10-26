# Deploying the studio

How an Operator runs the app itself — the `studio` container, its
Postgres and HTTPS in front of it. For turning a GPU machine into a
Backend, see [backend-kit.md](backend-kit.md); that's a separate host.
For daily backups, restore and the quarterly restore drill, see
[backup.md](backup.md) — `ops/studio/upgrade.sh`'s own backup step
below is a one-off safety net for an upgrade, not a substitute for
that.

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
   released version, from the
   [package's GHCR page](https://github.com/mysteryreloaded/ai-content-studio/pkgs/container/ai-content-studio) —
   never `latest`), `DOMAIN`, `PUBLIC_URL`, the Google OAuth credentials,
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

The image is multi-arch (`linux/amd64`, `linux/arm64`). Pushing a
`vX.Y.Z` tag runs `.github/workflows/release.yml`, which builds and
pushes `ghcr.io/mysteryreloaded/ai-content-studio:X.Y.Z` (and `:latest`,
for browsing the package page only — pin `STUDIO_VERSION` to the numbered
tag, never to `latest`).

## Upgrading

`ops/studio/upgrade.sh`, run from the directory holding
`docker-compose.yml` and `.env`: it's the whole path, back up, pull, up.

1. **Back up**: dumps Postgres and tars the `studio` data volume (Uploads
   and Assets) into `backups/<timestamp>/` next to the compose file.
2. **Pull**: `docker compose pull` — set `STUDIO_VERSION` in `.env` to the
   new release first.
3. **Up**: `docker compose up -d` — `studio` runs migrations under its
   lock before serving, same as any other start.

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
