# Monitoring

Four ways to check on the Studio, from cheapest to most detailed:

1. `/healthz` — a liveness probe for Docker and load balancers.
2. `/api/status` — a JSON list of open Problems, for scripts and
   dashboards.
3. The **Overview** page in the admin UI — a live, polling view of
   everything, plus your Backends' VRAM and the day's error count.
4. Backup pings — a [Healthchecks.io](https://healthchecks.io) ping on
   every backup run, success or failure, so a silent backup failure
   becomes visible.

## The liveness probe: `/healthz`

`GET /healthz` is public (no auth) and answers one of two ways:

- **200** with body `{"status":"ok"}` — the server is up and can reach
  the database.
- **503** with body `{"status":"db_unreachable"}` — the server is up but
  the database connection is down.

The check runs a single `SELECT 1` with a 2-second timeout, so a hung
database can't hold the endpoint open. It never takes longer than 2
seconds to answer, no matter what is wrong.

```
$ curl https://studio.example.com/healthz
{"status":"ok"}
```

`docker-compose.yml` ships a healthcheck for the `studio` service that
uses exactly this endpoint: every 10 seconds, 5-second timeout, 5
retries, a 20-second start period. `docker compose ps` shows the
container `healthy` only while the database is reachable, and a load
balancer in front of the Studio can probe the same URL.

## The status endpoint: `/api/status`

`GET /api/status` lists the Studio's open Problems as JSON. It is
gated: the request's `Authorization: Bearer <token>` must match the
`STATUS_TOKEN` environment variable (an Admin session also gets in).
With no `STATUS_TOKEN` set the endpoint returns 404 — it is effectively
off.

With no open Problems it answers **200** with `{"problems":[]}`. With
open Problems it answers **503**, one entry per Problem:

```
{
  "problems": [
    {
      "code": "backend_unreachable",
      "message": "ComfyUI at https://gpu-01.example.com is unreachable",
      "target": "https://gpu-01.example.com",
      "since": "2026-10-26T14:02:11.000Z"
    }
  ]
}
```

`code` is one of the Problem codes below, `target` names the specific
Backend or Model where applicable, and `since` is when the Problem was
first observed. Because the status flips 200→503, a poller can page on a
plain HTTP check:

```
curl -sf -H "Authorization: Bearer $STATUS_TOKEN" \
     https://studio.example.com/api/status >/dev/null \
  || alert "studio has open Problems"
```

Set `STATUS_TOKEN` to a long random string, e.g.
`openssl rand -hex 32` (see
[server-env.md](../server-env.md#status_token)). Treat it as a secret: it
is equivalent to being able to see every open Problem at any time.

## The monitor

A background task, the **monitor**, runs a check every 10 seconds and
maintains the open-Problem list that `/api/status` and the Overview page
both show:

- **Backend reachability.** Each attached Backend is probed. One that
  stops answering is marked unreachable after a **5-minute grace
  period**, so a Backend that is briefly restarting does not page you;
  when it answers again the Problem clears.
- **Free disk.** The server measures free space on the volume that holds
  `DATA_DIR` (Uploads and Assets). When it drops below **twice**
  `MIN_FREE_DISK_GB`, a `disk_low` Problem is raised. The threshold is
  `2 × MIN_FREE_DISK_GB` — doubled so a backup running at the same
  moment can't tip a healthy volume over the edge; you set the single
  number in `.env`, the doubling is built in.
- **Jobs.** A Generation that ends in an error, and a queue that is
  paused mid-Generation, are recorded as Problems the same way, so
  neither disappears into the logs.

The Problem codes the monitor raises today are:

| Code | Raised when |
|---|---|
| `backend_unreachable` | a Backend has not answered for 5 minutes. |
| `disk_low` | free space on the data volume is below `2 × MIN_FREE_DISK_GB`. |
| `job_failed` | a Generation ended in an error. |
| `generating_paused` | a Generation's queue was paused. |

The Problem type defines a few more codes — `db_unreachable`,
`model_without_backend`, `backend_failing` — that are not raised by the
monitor in the current build; they appear if and when the monitor learns
to raise them.

Problems clear on their own when the condition ends; a `job_failed`
Problem clears after 24 hours.

## The Overview page

The admin UI's **Overview** page (top of the admin left rail) polls
`/api/admin/overview` every 10 seconds and shows the same data as
`/api/status`, plus:

- **Problems** — every open Problem, same shape as the endpoint.
- **Backends** — for each attached Backend: its name, reachability,
  ComfyUI version, total and free VRAM, and — when the Backend's
  credentials are rejected (401/403) — a credentials error.
- **Disk** — free gigabytes against your `MIN_FREE_DISK_GB`.
- **Errors (24h)** — the count of `error`-level Log entries recorded in
  the last 24 hours, with a link into the Logs page.
- **Version and uptime** — the Studio's release version and how long
  this server process has been running.

When a Model is currently disabled (for example because its Backend
went away), a banner at the top of the page says so and names the
Model.

## Backup pings

The backup script from [Backups](backup.md) (`ops/backup/backup.sh`)
sends a ping to `BACKUP_PING_URL` — a [Healthchecks.io](https://healthchecks.io)
ping URL — after each run: a bare ping on success, and the same URL with
`/fail` appended when the backup fails. In Healthchecks.io you set a
check's "grace period" (say 26 hours for a daily backup); when a ping
doesn't arrive in time, Healthchecks emails you (or pages you, however
you've wired it) that the check is **down**. That is the only way a
silent failure — the script not running at all — becomes visible, which
is why the ping matters more than the log line.

The ping itself is a bare `curl -m 10 --retry 3`. If the ping can't be
sent (say, no outbound network from the backup host), the backup has
already run and the script prints a warning; it does not fail the run
over a lost ping.

## Logs

The server writes **JSON lines to stdout** — one JSON object per line:
`timestamp`, `level`, `message`, plus a `meta` object. In the Compose
setup the lines are collected by Docker's `json-file` driver (10 MB per
file, 5 files, rotated). For a longer tail, point a log shipper at the
container, or tail the json-file in `/var/lib/docker/containers/`
directly.

The admin UI's **Logs** page reads a different, structured stream: the
event entries the server records in the database for user and admin
actions (sign-ins, approvals, admin changes — the same entries the
Overview's error count is based on), filterable by level. These entries
are deleted after `LOG_RETENTION_DAYS` days (default 30).

## Behind Caddy

The Caddyfile in `ops/caddy/Caddyfile` adds one more safety net: a
`handle_errors` block rewrites any upstream 502 or 503 into a static
"Restarting — this page will refresh in a moment" page that reloads
itself after 3 seconds. A rolling restart of the container therefore
reads as a brief flicker to users, not a broken site.
