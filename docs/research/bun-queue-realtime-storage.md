# Queue, live progress, storage, ORM and ffmpeg on Bun + Hono + Postgres

Research for ticket `06-bun-queue-realtime-storage`. Gathered 2026-10-22 from primary sources. Library, runtime and server source was cloned from GitHub at the commits listed under Sources, plus vendor documentation pages. The npm registry was unreachable from the research shell (DNS failure, then a proxy 403), so versions come from each repo's `package.json`, changelog and git tags. No third-party code was run.

"Current Bun" here means **Bun 1.4.3**, the latest release tag (`bun-v1.4.3`, commit dated 2026-10-09). Bun claims are read from the docs and types at that tag, not from `main`, because `main` already documents unreleased work.

## Summary

- **Queue:** **pg-boss 12.38.0** (2026-10-13) is the only maintained queue that officially targets Bun with Postgres alone. It has a first-party `Bun.SQL` adapter (`fromBunSql`, since 12.31.0 on 2026-09-10) and a Bun CI job, and it already provides retries with backoff, delays, expiry and heartbeats, cancellation, dead-letter queues and a global per-group concurrency limit. **BullMQ 6.x** gained a Postgres backend in 6.0.0 (2026-07-30), but that backend requires `pg` and its CI runs only on Node. BullMQ's Bun support covers the Redis path, and per-group concurrency is a paid Pro feature. **graphile-worker 0.18.0** says nothing about Bun. A **hand-rolled `SKIP LOCKED` table** is a sanctioned Postgres pattern, but every queue feature becomes code the project owns. None of the options has a per-user *daily* cap. That stays an application-level check whichever option is chosen.
- **Bun's Postgres client supports LISTEN/NOTIFY**: `sql.listen()` and `sql.notify()` arrived in Bun 1.4.0 (2026-08-19). Bun reconnects the listener automatically, but notifications sent while it is disconnected are lost, so callers catch up in the reconnect callback.
- **Live progress:** Hono's `streamSSE` works on Bun. The SSE route must turn off Bun's 10-second idle timeout with `server.timeout(req, 0)` or send a heartbeat more often than that. With nginx, the response needs `X-Accel-Buffering: no` (or `proxy_buffering off`) and a heartbeat inside nginx's 60 s read timeout. Caddy flushes event streams immediately. Cloudflare's proxy streams by default but returns a 524 after 125 s with no bytes, and Cloudflare Quick Tunnels do not support SSE at all. WebSockets also work through `@hono/bun` (the old `hono/bun` import is deprecated and will be removed in Hono v5).
- **Storage:** with local disk, `new Response(Bun.file(path))` gets single-range `206` responses, `416` and `If-Range` handling plus `sendfile` from Bun itself, including from a handler such as a Hono route. For S3-compatible storage, `Bun.S3Client` covers presigned GET/PUT URLs, a 302 redirect to a presigned URL, ranged reads via `slice()`, and multipart writes. **The MinIO community repository now says it is no longer maintained** (source-only, last commit 2026-02-12). Maintained self-hosted alternatives include SeaweedFS and RustFS (both Apache-2.0). Upload size limits matter more than the storage choice: Bun's default body cap is 128 MB, nginx's is 1 MB, and Cloudflare Free/Pro allow 100 MB.
- **ORM:** Drizzle stable **0.45.4** (2026-10-08) ships a `drizzle-orm/bun-sql` driver and a runtime `migrate()`. The `drizzle-kit` 0.31 CLI cannot use Bun's client; it needs `pg` or `postgres` installed. Drizzle's own Bun page points to the **1.0.0-rc** line, whose rc.5 (2026-10-21) still makes breaking changes. Bun.SQL has open Postgres bugs that touch an ORM: JS arrays are not encoded as arrays (#18775), and `json`/`jsonb` values are double-encoded (#28819, still open on 1.4.x). The `postgres.js` driver is the alternative on Bun.
- **ffmpeg:** call the ffmpeg CLI through `Bun.spawn` with argv arrays, `timeout`/`AbortSignal`, an optional Linux cgroup limit, and `-progress pipe:1` for machine-readable progress. **fluent-ffmpeg is deprecated and read-only.** `Bun.Image` (JPEG/PNG/WebP/HEIC/AVIF) can make image thumbnails without ffmpeg or sharp. Video posters and trims still need ffmpeg.
- **One process or two:** a single Bun process can serve the API, SSE and queue workers. Generation dispatch is I/O-bound, and ffmpeg runs in child processes. Splitting the workers into their own process is supported (pg-boss can turn off supervision, scheduling or migrations per instance). The cost of splitting is cross-process progress fan-out, for example through Postgres NOTIFY.

## 1. Durable queue

### Requirements recap (from the charter)
The queue must dispatch Generations to N Backends per Model, enforce a per-user concurrent cap and a per-user daily cap (admin-set, with per-user overrides), and support retries and cancellation. Load is about 10k web requests per day, roughly 0.12 requests per second on average. Throughput is no constraint for any option; the deciding factors are features, Bun evidence and the number of moving parts.

### Option A: pg-boss (Postgres)

- **Version and maintenance.** 12.38.0, tagged 2026-10-13; repo HEAD commit 2026-10-15. MIT. The only runtime dependency that touches the database is `pg` (^8.23.1). `engines` declares Node ≥22.12.0. [pgboss-pkg]
- **Bun evidence.**
  - A first-party adapter, `fromBunSql(new SQL(url))`, lets pg-boss run on Bun's built-in client. The adapter landed in commit 60758b2 (2026-09-09), and 12.31.0 (2026-09-10) is the first release that contains it. [pgboss-bun-src] [pgboss-git]
  - The docs say the bundled `pg` driver also runs under Bun. The adapter exists so the app and the queue can share one client and pool. [pgboss-backends]
  - CI has a dedicated `test-bun` job that installs Bun and runs the adapter conformance suite against a real Postgres. [pgboss-ci]
  - The adapter works around three Bun.SQL behaviours:
    - arrays are not encoded as Postgres arrays (Bun #18775), so the adapter expands them into scalar parameters;
    - Bun infers a bind type from the cast in front of it, so pg-boss routes JSON through `::text::json` (Bun #28819);
    - SQLSTATE arrives in `errno` rather than `code`, so the adapter moves it.

    The adapter also pins a reserved connection for its `BEGIN … COMMIT` scripts, because Bun refuses a raw `BEGIN` on a pooled connection. [pgboss-backends] [pgboss-bun-src]
  - `useListenNotify` needs `sql.listen()`, which means Bun ≥1.4.0. On older runtimes the adapter exposes no `listen`, and pg-boss falls back to polling. [pgboss-bun-src]
- **Features that map to the studio** [pgboss-queues] [pgboss-jobs] [pgboss-workers]:
  - **Retries:** `retryLimit`, `retryDelay`, `retryBackoff` (exponential with jitter) and `retryDelayMax`, set per queue or per job.
  - **Delays:** `startAfter`, which takes seconds, an ISO string or a Date.
  - **Liveness:** `expireInSeconds` defaults to 15 minutes. `heartbeatSeconds` (≥10) lets a dead worker be detected within roughly the heartbeat plus the monitor interval (60 s default). The docs explicitly recommend heartbeats for long video jobs. A worker that was only partitioned may keep running after its job is failed, so the docs ask for idempotent handlers.
  - **Cancellation:** `cancel(name, id)` works on pending *or active* jobs. A running handler finds out through `job.signal` (an `AbortSignal`), which is aborted on expiry, on shutdown, or when a heartbeat finds that the job is no longer active under this worker's claim. Cancel latency for a running job is therefore bounded by the heartbeat refresh, which defaults to half of `heartbeatSeconds`.
  - **Concurrency:**
    - `localConcurrency` sets the number of parallel handlers per `work()` call.
    - `groupConcurrency` limits how many jobs of the same `group: { id, tier }` run at once **across all nodes**. It can be one number or per-tier limits. The docs warn the limit can be briefly exceeded when fetches race.
    - `localGroupConcurrency` is an in-memory, per-process variant.
  - **Policies:** `standard`, `short`, `singleton`, `stately`, `exclusive` and `key_strict_fifo`, plus `singletonKey`, throttling and debouncing, `priority`, `deadLetter` queues, and `retry`/`resume`/`redrive`.
  - **Transactions:** `send()` accepts a `db` option, so a job can be enqueued in the same transaction as the app's own insert. There is a Drizzle adapter (`fromDrizzle(tx, sql)`) that supports the `node-postgres`, `postgres-js` **and `bun-sql`** drivers. [pgboss-adapters]
  - **Extras:** an optional `@pg-boss/dashboard` package for browsing queues and jobs. [pgboss-dashboard]
- **Dispatch latency.** Polling defaults to every 2 s. With `useListenNotify` and `notify: true` on a queue, workers wake immediately and polling drops to a 30 s backstop. LISTEN needs a session-pinned connection, so it does **not** work through PgBouncer in transaction or statement mode. [pgboss-workers] [pgboss-ctor]
- **Roles.** Per-instance flags `supervise`, `schedule` and `migrate` (all default true) let some instances skip maintenance, scheduling or schema migration. [pgboss-ctor]
- **Ops cost:** no extra service. pg-boss lives in its own schema in the app's Postgres.

### Option B: BullMQ 6 (Redis, or its new Postgres backend)

- **Version.** 6.4.0, released 2026-10-21. MIT. Very active: four releases between 2026-10-17 and 2026-10-21. [bullmq-changelog]
- **Pluggable backends.** 6.0.0 (2026-07-30) introduced an `IQueueBackend` abstraction with Redis and PostgreSQL backends. [bullmq-changelog] The Postgres backend:
  - is selected with `createPostgresBackend` and requires the optional peer `pg` plus PostgreSQL 13+;
  - needs an explicit `runMigrations()` step;
  - implements blocking waits with LISTEN/NOTIFY on a dedicated connection;
  - is described by its own docs as usually 1.5–2× slower in jobs per second than Redis;
  - is called less battle-tested than Redis in its own docs. [bullmq-pg]
- **Bun evidence.**
  - The README lists the npm package under "Node.js / Bun". [bullmq-readme]
  - The adapter `createBunRedisClient(new RedisClient(url))` wraps Bun's built-in Redis client. [bullmq-conn]
  - CI has a `bun-redis` job that runs the suite on the latest Bun against Redis. That config excludes sandboxed-processor and child-pool tests, plus one scheduler stress test that hangs because of limitations in Bun's Redis client. [bullmq-ci] [bullmq-bun-config]
  - **The Postgres backend's CI job runs only on Node**, and its docs mention only node-postgres. Running it on Bun relies on Bun's `pg` compatibility and has not been tested by the project. [bullmq-ci] [bullmq-pg]
  - Bun's Redis client does not support Sentinel or Cluster, and needs raw commands for `MULTI/EXEC`. [bun-redis]
- **Features.** Retries and backoff, delays, a global rate limit, and cancellation of active jobs through an `AbortSignal` passed to the processor (`worker.cancelJob(id)`). [bullmq-cancel] **Groups, group concurrency and group rate limits are listed under BullMQ Pro**, which is commercial. A per-user concurrent cap would therefore be the studio's own code in open-source BullMQ. [bullmq-summary]
- **Ops cost:** one more service (Redis or Valkey, with persistence configured) on the Redis path. The Postgres path adds none, but leans on untested Bun compatibility.

### Option C: graphile-worker (Postgres)

- **Version.** 0.18.0 (2026-09-08); repo HEAD 2026-10-20. MIT. Requires PostgreSQL 12+ and Node 22.18+, and depends on `pg`. The project calls itself production-ready, but it is still 0.x, and minor versions may need code changes. [gw-req] [gw-status] [gw-pkg]
- **Bun evidence:** none. A search of the repo's docs, README and release notes found no mention of Bun. The engines field names only Node, and there is no Bun CI job. [gw-repo]
- **Features:**
  - `run_at` delays;
  - `max_attempts` (default 25) with exponential backoff;
  - `job_key` for replacing or deduplicating jobs;
  - `helpers.abortSignal` for graceful shutdown;
  - admin functions such as `permanentlyFailJobs`;
  - LISTEN/NOTIFY, on by default, with a PgBouncer caveat in the FAQ.

  Serialisation is per `queue_name`, which means one job at a time per named queue. The docs warn against high-cardinality queue names such as per-entity UUIDs. As a result, a "max N concurrent per user" rule does not map onto it directly. [gw-addjob] [gw-tasks] [gw-faq]
- **Ops cost:** no extra service.

### Option D: hand-rolled Postgres table with `SKIP LOCKED`

- **Postgres's stance.** The `SELECT` locking-clause docs say `SKIP LOCKED` returns an inconsistent view of the data, so it is not for general-purpose work. They also say it is suitable for avoiding lock contention when multiple consumers read a queue-like table. [pg-select]
- **Wake-ups.** `NOTIFY` payloads must be shorter than 8000 bytes by default. Notifications are delivered only when the sending transaction commits. Duplicates within one transaction may be folded. The notification queue is about 8 GB, and once it fills, `NOTIFY` transactions fail at commit. [pg-notify]
- **On Bun**, `sql.listen()` and `tx.notify()` (delivered on commit) cover the wake-up side natively (see section 2). [bun-sql]
- **What the project then owns:** retry and backoff, stale-claim detection (heartbeat or lease expiry), cancellation signalling, a dead-letter state, and admin visibility. The upside is that the per-user concurrent cap and per-Backend capacity can live in the same claim query as plain SQL over the Generations table. A library cannot offer that.
- **Ops cost:** no extra service, but the most code to maintain.

### Other queue options seen but not researched
`pgmq` (a Postgres extension), and Bun-specific packages such as `bunqueue` or `groupmq`. None of these was checked against primary sources (see Open).

### Queue comparison

| | pg-boss 12.38 | BullMQ 6.4 (Redis) | BullMQ 6.4 (Postgres) | graphile-worker 0.18 | Hand-rolled |
|---|---|---|---|---|---|
| Extra service | none | Redis/Valkey | none | none | none |
| Bun statement | first-party `Bun.SQL` adapter; docs say `pg` also works | README lists Bun; Bun Redis adapter | none for this backend | none | n/a (own code) |
| Bun CI | yes (`test-bun`) | yes (`bun-redis`, some tests excluded) | no (Node only) | no | own tests |
| Retries + backoff | yes | yes | yes | yes | build |
| Delays | `startAfter` | yes | yes | `run_at` | build |
| Cancel running job | `cancel()` + `job.signal` via heartbeat | `cancelJob()` + AbortSignal | same API | abortSignal is for shutdown; cancel of a running job not documented | build |
| Global per-group concurrency | `groupConcurrency` (brief overshoot possible) | Pro only | Pro only | serial per `queue_name` only | in the claim SQL |
| Enqueue in app transaction | `db` option, Drizzle `bun-sql` adapter | no (separate store) | not checked | SQL `add_job` in the same DB | yes |
| Per-user daily cap | app code | app code | app code | app code | app code |

## 2. Live progress to the browser

### Bun's built-in Postgres client: LISTEN/NOTIFY

- `sql.listen(channel, cb, onSubscribe?)` and `sql.notify(channel, payload)` are documented at Bun 1.4.3. They appear in the docs at `bun-v1.4.0` (2026-08-19) and are absent at `bun-v1.3.14` (2026-05-12). pg-boss's adapter cites the same 1.4.0 boundary (oven-sh/bun#32089). [bun-sql] [pgboss-bun-src]
- **How it behaves** [bun-sql]:
  - All subscriptions on a client share one dedicated connection, opened on the first `listen()`.
  - While anything is subscribed, that connection keeps the process alive.
  - On a drop, Bun reconnects with backoff from 250 ms up to 32 s and re-subscribes. Notifications sent during the gap are lost. The optional third argument runs after every reconnect so the caller can catch up from the database.
  - A server-side `idle_session_timeout` will kill the idle listener connection unless the client sets it to 0.
  - `notify()` inside `sql.begin()` is delivered on commit and dropped on rollback.
- **Other Bun.SQL limits** [bun-sql]:
  - Column name transforms (snake_case to camelCase) are on the roadmap, not shipped.
  - Postgres features not yet implemented include GSSAPI, Point/PostGIS types and most multi-dimensional integer array types.
  - The docs also note that `pg` and `postgres.js` work under Bun.

### Server-Sent Events (SSE) with Hono on Bun

- **Hono's `streamSSE(c, cb, onError?)`** [hono-sse-src] [hono-stream-docs]:
  - It writes `event`/`data`/`id`/`retry` frames and sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and `Transfer-Encoding: chunked`. It does **not** set `X-Accel-Buffering`.
  - On Bun it holds the request context until the stream ends.
  - It has a fallback for Bun versions before 1.1.27, which did not cancel the stream on disconnect.
  - Cleanup goes through `stream.onAbort()` and the `stream.aborted` flag.
  - An error thrown inside the callback does not reach `app.onError`, because the response has already started.
  - Hono 4.13.13 is current; repo HEAD is from 2026-10-17. [hono-pkg]
- **Bun idle timeout** [bun-server]:
  - `Bun.serve` closes a connection after **10 s** of inactivity by default. `idleTimeout` goes up to 255, and 0 disables it.
  - The idle timer also runs while a response is streaming, so a quiet SSE stream is cut. The documented fix is `server.timeout(req, 0)` for that request only.
  - Over HTTP/2 the timeout belongs to the connection.
  - Under Hono the Bun server is reachable through `getBunServer(c)` (it reads `c.env`). [hono-bun-server]
- **SSE protocol** [sse-spec]:
  - `EventSource` reconnects automatically.
  - The server can set the delay with `retry:`.
  - The browser sends `Last-Event-ID` on reconnect, so the server can resume.
  - Answering 204 stops reconnection.
  - The spec recommends a comment line about every 15 s to keep old proxies from dropping idle connections.
- **Browser connection limit.** Over HTTP/1.1, browsers allow 6 SSE connections per domain, shared across all tabs (Chrome and Firefox marked this "won't fix"). Over HTTP/2 the stream limit is negotiated and defaults to 100. [mdn-eventsource] `Bun.serve` HTTP/2 is marked **experimental**. [bun-server]

### WebSocket with Hono on Bun

- **Imports.** `upgradeWebSocket` and `websocket` now come from **`@hono/bun` 1.0.1**, released 2026-10-08 from the Hono monorepo (`adapters/bun`); its peer range is `hono >=4.13.9 || ^5.0.0-0`. In Hono 4.13.13, `hono/bun` is marked deprecated and slated for removal in v5. The exports are unchanged, only the import path moves. [hono-bun-pkg] [hono-bun-src]
- **Wiring.** The app exports `{ fetch: app.fetch, websocket }`. Hono's docs warn that header-modifying middleware such as CORS on a WebSocket route can fail with an immutable-headers error. [hono-ws-docs]
- **Bun's WebSocket defaults** [bun-ws] [bun-server]:
  - idle timeout 120 s;
  - pings on by default (`sendPings`);
  - maximum message size 16 MB;
  - a native topic pub/sub (`ws.subscribe`, `server.publish`), which is in-process only;
  - `server.upgrade()` works only on HTTP/1.1, so there are no WebSockets over HTTP/2.

### Behind common reverse proxies

| Proxy | Default behaviour for a long-lived event stream | What SSE needs | Source |
|---|---|---|---|
| nginx | `proxy_buffering on`. `proxy_read_timeout 60s` counts the gap between two reads. Source defaults: buffering 1, read timeout 60000 ms. `proxy_http_version` defaults to 1.1 only since 1.29.7 (1.0 before). | Send `X-Accel-Buffering: no` from the app (or set `proxy_buffering off` on the location), and a heartbeat under 60 s | [nginx-proxy] [nginx-src] |
| Caddy | Flushes immediately when the response is `text/event-stream`. Streams have no timeout by default. WebSockets are closed on config reload unless `stream_close_delay` is set. | Nothing extra for SSE | [caddy-rp] |
| Cloudflare proxy (orange cloud) | Streams data as it arrives (response buffering is an Enterprise-only switch). Returns 524 after **125 s** with no response bytes; only Enterprise can raise it. `text/event-stream` is not on the compression list. WebSockets work on all plans but are closed when idle or when Cloudflare restarts edge servers. | A heartbeat well under 125 s. Optionally `Cache-Control: no-transform`, which stops Cloudflare from changing compression on that response. | [cf-pagerules] [cf-524] [cf-compression] [cf-ws] |
| Cloudflare Quick Tunnel (`trycloudflare`) | **SSE not supported**; 200 in-flight request cap | Use a named tunnel instead | [cf-quick-tunnel] |

A heartbeat comment every few seconds meets Bun's 10 s idle default, nginx's 60 s, Cloudflare's 125 s and the spec's 15 s advice, without `server.timeout(req, 0)`. That is an inference from the limits above.

## 3. Upload and Asset storage

### Local disk, served by Bun

- **Range support on file responses** [bun-routing] [bun-range-tests]:
  - `new Response(Bun.file(path))` handles `Range` automatically: `206` with `Content-Range`, `416` past the end of the file, `If-Range`, `Last-Modified`/`If-Modified-Since`, and streaming with backpressure.
  - It uses `sendfile(2)` where it can.
  - Bun's test suite runs the same Range cases for a `routes` entry and for a handler that returns `new Response(Bun.file(...))`, at both `bun-v1.3.14` and `bun-v1.4.3`. So the support is not limited to static routes.
  - Multi-range requests get the full body.
  - A `Bun.file().slice()` body cannot be escaped by a client `Range` header.
- **Directory routes.** `{ dir }` routes canonicalise paths and use `openat2(RESOLVE_IN_ROOT)` on Linux. The docs say to keep access-controlled files outside a served directory instead of relying on an overlapping route. That fits per-user Assets served through an authorising handler, not a static dir. [bun-routing]
- **Hono.** Hono's Bun `serveStatic` passes the `BunFile` to `c.body()`. [hono-bun-src]
- **Ops cost:** none. The trade-offs are that files live on the one VPS (backups and disk size are the operator's job), and the web process serves every byte.

### S3-compatible storage through `Bun.S3Client`

- **Basics.** `Bun.S3Client` / `Bun.s3` is native. Credentials come from options or `S3_*`/`AWS_*` environment variables. The docs list AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, Backblaze B2, GCS and Supabase, and `virtualHostedStyle` is supported. [bun-s3]
- **Presigning** [bun-s3] [bun-s3-types]:
  - `presign()` is synchronous and makes no network call.
  - The default is GET with a 24 h expiry. Options are `expiresIn`, `method` (GET/PUT/HEAD/DELETE/POST), `type` (response content type), `contentDisposition` (for example to force a download filename) and `acl`.
  - The presign options include **no content-length or size condition**.
- **Redirect.** `new Response(s3file)` returns a **302 to a presigned URL**, so the browser fetches the object straight from storage and the server never relays the bytes. [bun-s3]
- **Ranged reads and large writes** [bun-s3]:
  - `s3file.slice(start, end)` sends an HTTP `Range` request.
  - Large writes become multipart automatically.
  - `s3file.writer({ partSize, queueSize, retry })` streams a multipart upload.
  - `S3Client.stat()` returns size, etag and type.
- **Video seeking.**
  - With a 302 to a presigned GET, the browser's `<video>` issues its own Range requests against the storage endpoint. R2's S3 API marks `Range` on GetObject as supported. [r2-s3api]
  - Proxying through Bun with `slice()` is the other route.
  - A presigned URL that expires mid-playback breaks later range requests, so expiry should cover a viewing session (inference).
- **R2 specifics** [r2-presign] [r2-pricing] [r2-limits]:
  - Presigned URLs allow GET, HEAD, PUT and DELETE, but **not POST** (form uploads). Expiry is at most 7 days.
  - Presigned URLs work only on the `r2.cloudflarestorage.com` endpoint, **not on custom domains**.
  - No size cap can be put in the signature. Content-Type is signed, so a mismatch fails.
  - A single PUT can be up to about 5 GiB.
  - Storage costs $0.015/GB-month, with free egress. Class A operations cost $4.50 per million and Class B $0.36 per million. The free tier is 10 GB-month, 1M Class A and 10M Class B per month.
  - Writes to the same key are limited to about 1 per second.
- **MinIO status.**
  - The `minio/minio` README now says, in bold, that **the repository is no longer maintained**. It points to the commercial "AIStor" editions, and says the community edition is source-only, with no new binaries.
  - The last commit is 2026-02-12. The license is AGPL-3.0. [minio-readme]
  - Maintained self-hosted S3 servers seen in their repos on 2026-10-22: **SeaweedFS** (Apache-2.0, tag 4.48, HEAD 2026-10-21) [seaweedfs] and **RustFS** (Apache-2.0, tag 1.0.3, HEAD 2026-10-22) [rustfs]. Neither was tested against `Bun.S3Client` (see Open).
- **Ops cost:** a self-hosted S3 server is one more service to run, upgrade and back up. R2 or S3 is an external account with per-GB cost, plus CORS setup for browser PUTs.

### Getting large Uploads in (hundreds of MB)

- **Through the app.**
  - `Bun.serve` rejects bodies over `maxRequestBodySize`, **128 MB by default**, which is configurable. [bun-serve-types]
  - nginx's `client_max_body_size` defaults to **1 MB**. With `proxy_request_buffering on` (the default), nginx reads the whole body before passing it on. [nginx-src] [nginx-proxy]
  - **Cloudflare's proxy caps request bodies at 100 MB on Free and Pro**, 200 MB on Business, and up to 5 GB on Enterprise. Its suggested workarounds are chunking or a DNS-only (grey-cloud) record. [cf-413]
  - Bun's own upload guide uses `req.formData()`. `Bun.write()` accepts a `Response` as data. [bun-upload-guide] [bun-fileio] Whether a multi-hundred-MB body streams to disk without buffering in memory is not documented (see Open).
- **Direct to storage.**
  - A presigned PUT avoids every app-side limit above, and R2 takes up to about 5 GiB in one PUT. [r2-limits]
  - But neither Bun's presign options nor R2 can cap the size, so the server must `stat()` the object afterwards and reject oversize files. [bun-s3-types] [r2-presign]
  - Because trimming happens on the server, the server then has to read the object back for ffmpeg.

## 4. ORM and migrations

### Drizzle ORM

- **Lines and versions.** Stable is **0.45.4** (tag 2026-10-08), with drizzle-kit **0.31.11**. The **1.0.0-rc** line reached **rc.5** on 2026-10-21. The rc.5 changelog still lists breaking changes: JSON parsers for `postgres-js`, relational-query filters that now reject `undefined`, codec reshuffles and moved exports. [drizzle-tags] [drizzle-rc5]
- **Bun.SQL driver.**
  - 0.45.x ships `drizzle-orm/bun-sql` (driver, session) and `drizzle-orm/bun-sql/migrator` (`migrate(db, config)`). [drizzle-045-src]
  - In rc.5 it is split into `bun-sql/postgres` and `bun-sql/mysql`. [drizzle-rc5-src]
  - Drizzle's "connect Bun SQL" page tells readers to install `drizzle-orm@rc` and `drizzle-kit@rc`, and documents `drizzle(process.env.DATABASE_URL)` or `drizzle({ client: new SQL(...) })`. It mentions no Bun version requirement and no known issues. [drizzle-bunsql-docs]
  - 0.45.0 fixed `Date` mapping for `bun-sql:postgresql` responses (#4493), a sign the driver is still settling. [drizzle-045-changelog]
- **drizzle-kit on Bun.SQL.**
  - The **stable drizzle-kit 0.31 CLI picks a Postgres driver from the installed packages: `pg`, `postgres`, `@vercel/postgres` or Neon. It never uses Bun.SQL.** A project on `bun-sql` therefore still needs `pg` or `postgres` as a dev dependency for `drizzle-kit migrate`/`push`/`pull`. [drizzle-kit-045]
  - The rc drizzle-kit adds a `bun` driver, which must be run with `bun --bun`. [drizzle-kit-rc5]
- **Migration workflow.** `drizzle-kit generate` writes SQL files plus a snapshot. `drizzle-kit migrate` applies them. `push` diffs the schema straight into the database (for prototyping), `pull` introspects, and `export` prints SQL. Or the app calls `migrate()` at startup, which the docs describe as common for monoliths. [drizzle-migrations-docs]
- **License:** Apache-2.0. [drizzle-license]

### Bun.SQL bugs that reach an ORM
- **#18775:** a JS array parameter is stringified without braces, so Postgres rejects it as a malformed array literal. [bun-18775]
- **#28819:** values bound to `json`/`jsonb` columns are double-encoded and stored as JSON strings. The issue is **open**; comments say the bug is still present on 1.4.x and a fix (PR #40944) awaits review. [bun-28819] pg-boss works around it in its SQL. [pgboss-backends] Whether Drizzle's `bun-sql` driver works around it was not confirmed (see Open). This matters for any `jsonb` column, such as a stored Workflow.

### Alternatives on Bun
- Drizzle over `postgres.js` (`drizzle-orm/postgres-js`) or `node-postgres`. The Bun docs say both libraries work in Bun. [bun-sql] pg-boss's Drizzle adapter supports both drivers too. [pgboss-adapters]
- Kysely and Prisma 7 (with `@prisma/adapter-pg`) have pg-boss transaction adapters. [pgboss-adapters] Their Bun status was not researched.

## 5. ffmpeg: trimming, thumbnails and posters

- **Spawning ffmpeg** [bun-spawn]:
  - `Bun.spawn({ cmd: [...] })` takes an argv array, so no shell is involved.
  - `stdout` is a `ReadableStream`. `stderr` is inherited unless `"pipe"` is set.
  - `onExit(proc, exitCode, signalCode, error)` reports the end of the process.
  - `timeout` (ms) and `killSignal` stop runaway processes, and an `AbortSignal` can cancel one.
  - `proc.kill()` is available, and `resourceUsage()` runs after exit.
  - On Linux, a `cgroup` option starts the child inside a control group, so memory, CPU and pid limits apply from the first instruction.
  - `node:child_process` is only partly compatible (🟡 IPC gaps), so the native API is the cleaner path. [bun-compat]
- **Library wrappers.** `fluent-ffmpeg` (2.1.3) says it is deprecated, no longer maintained and does not work properly with recent ffmpeg. Its repo is read-only, and the last commit is 2025-05-22. [fluent-readme]
- **Relevant ffmpeg semantics** [ffmpeg-doc] [ffmpeg-formats]:
  - **Seeking.** `-ss` before `-i` seeks to the nearest seek point before the position. When transcoding, ffmpeg decodes and discards up to the exact position (accurate seek is the default). With `-c copy` that extra stretch is kept. So stream-copy trims are cheap but start at a keyframe, and frame-exact trims need a re-encode.
  - **Length.** `-t` is a duration and `-to` an end position; they are mutually exclusive.
  - **Posters.** `-frames:v 1` writes a single frame, which gives a poster image.
  - **Progress.** `-progress pipe:1` writes `key=value` progress to stdout every 0.5 s by default (`-stats_period`), ending with `progress=end`. That feeds an Upload-trim progress bar.
  - **Faststart.** `-movflags +faststart` moves the MP4 index to the front with a second pass. The docs say this improves playback; it is not on by default.
- **Image thumbnails without ffmpeg** [bun-image]:
  - `Bun.Image` decodes, resizes and encodes JPEG, PNG, WebP, HEIC and AVIF off the JS thread. It has a Sharp-like API, no npm dependencies, and accepts `Bun.file()` and `Bun.s3.file()` as input.
  - `maxPixels` guards against decompression bombs.
  - The docs warn never to pass user-controlled path strings to it.
  - It is documented at both 1.3.14 and 1.4.3.
  - Video posters still need ffmpeg to extract the frame; `Bun.Image` could then resize it.
- **Ops cost:** ffmpeg is a system binary in the VPS or container image. The CPU load scales with how many Uploads need a re-encode, not with web traffic.

## 6. One Bun process or separate queue workers?

- **What Bun offers.**
  - A single process can run `Bun.serve` (API and SSE) and queue workers (`boss.work(...)`) on one event loop.
  - Generation dispatch is mostly network I/O: HTTP and WebSocket calls to ComfyUI over the tunnel.
  - ffmpeg runs in child processes, so heavy encodes do not block the loop. [bun-spawn]
  - Bun `Worker` threads are still **experimental**, especially terminating them. [bun-workers]
  - Several HTTP processes can share a port with `reusePort`, on Linux only. [bun-cluster]
  - `Bun.cron(expr, cb)` runs in-process schedules, for example daily-cap resets or cleanup. [bun-cron]
- **What pg-boss offers.** Any number of instances may share a database. The `supervise`, `schedule` and `migrate` flags let an API-only instance skip maintenance while a worker instance does it. [pgboss-ctor]
- **Single process.**
  - Fewest moving parts. Progress can go from queue worker to SSE through an in-memory emitter, and Bun's WebSocket `server.publish()` also works in-process.
  - A deploy or restart drops SSE connections (`EventSource` reconnects) and interrupts in-flight dispatch. A Generation still running on ComfyUI must then be re-attached or retried. pg-boss's expiry and heartbeat would retry the job, so handlers must be idempotent, as the docs ask. [pgboss-queues]
- **Separate worker process.**
  - Restarts of the web tier do not touch dispatch, and a crash in one process does not take down the other.
  - Progress must cross processes: Postgres `NOTIFY` (payloads under 8000 bytes) with `sql.listen()` in the web process, or pg-boss `publish`/`subscribe`. [pg-notify] [bun-sql] [pgboss-pubsub]
  - LISTEN needs a session connection, not PgBouncer in transaction mode. [pgboss-ctor]
  - In-process pub/sub (Bun `server.publish`) no longer reaches clients by itself.

## Options & implications for the studio

These are trade-offs to decide in a grilling ticket, not decisions.

1. **Queue engine.**
   - *pg-boss on `fromBunSql`* gives Postgres only, documented and CI-tested Bun support, and most of the required features. The per-user concurrent cap fits `group: { id: userId }` + `groupConcurrency`, with a possible brief overshoot under races. Per-user *overrides* would need tiers, because tier limits are fixed when `work()` is called, or an app-level gate.
   - *A hand-rolled table* gives full control: the user cap and Backend capacity live in one claim query, and Backends can be added or removed in the admin panel at runtime. The cost is that the project owns retries, stale-claim detection and cancellation.
   - *BullMQ* is the most mature engine, but on Redis it adds a service, per-user groups are Pro-only, and its Postgres backend is untested on Bun.
   - *graphile-worker* has no Bun evidence, and its serialisation model does not fit "N per user".
2. **Dispatch to N Backends per Model.** The libraries do not model Backends.
   - One shape is a queue per Model, with a handler that leases a free Backend, for example a row lock on a Backend table. Its concurrency is fixed at `work()` time, so adding a Backend means calling `offWork()`/`work()` again with a new `localConcurrency` (inference).
   - Another is the hand-rolled claim, which joins Generations to idle Backends.
   - Binding a Generation to a Backend at submission is simpler but balances load poorly.
3. **Daily cap.** No queue enforces it. It is a count over Generations at submission, whichever engine is chosen.
4. **Cancellation.** Library cancel only marks the job and aborts `job.signal` at the next heartbeat. Stopping GPU work also needs ComfyUI's own interrupt or delete call (ticket 02). For quick cancels in a single process, the cancel endpoint can signal the in-process handler directly.
5. **Progress transport.**
   - *SSE* is one-way, which progress cards need. It reconnects and resumes with `Last-Event-ID`, and runs over plain HTTP. It needs `server.timeout(req, 0)` or a heartbeat, `X-Accel-Buffering: no` for nginx, and a design that fits the 6-connection limit, such as one stream per tab carrying all of a user's Generations.
   - *WebSocket* is two-way, which the studio does not need for progress. It is HTTP/1.1-only on Bun and needs proxy Upgrade handling.
   - Either way, the browser should re-read current state from the API on connect, because NOTIFY and SSE both drop messages across disconnects.
6. **Storage.**
   - *Local disk* means no service and free Range support from Bun, but ties Assets to one VPS.
   - *R2/S3* adds a bill, gives direct-to-storage downloads and seeking via presigned 302s, and offloads bandwidth.
   - *Self-hosted S3* adds an ops burden. MinIO's community repo is now unmaintained, so SeaweedFS, RustFS or Garage would need vetting.
   - With an S3 backend, the storage interface stays small (`write`, `stat`, `presign`, `slice`, `delete`), which suits a "local disk or S3" adapter.
7. **Upload path.** Uploads of hundreds of MB through a Cloudflare-proxied hostname fail on Free and Pro (100 MB) unless they go direct to storage, are chunked, or use a grey-cloud hostname. Through nginx, `client_max_body_size` must be raised, and through Bun, `maxRequestBodySize`. Trimming on the server means the original must reach the server anyway: either uploaded through it, or presigned-PUT to storage and read back.
8. **ORM driver.**
   - *Drizzle 0.45 + `bun-sql`* gives one pool shared with pg-boss, but exposes the open Bun bugs (#28819 `jsonb`, #18775 arrays). drizzle-kit still needs `pg` or `postgres` installed.
   - *Drizzle 0.45 + `postgres-js`* avoids the Bun.SQL bugs at the cost of a second driver, unless pg-boss also uses `postgres-js` or its bundled `pg`.
   - *Drizzle 1.0 rc* aligns with Drizzle's own Bun docs and Better Auth's peer range, but is still making breaking changes.
9. **ffmpeg.** Call the CLI directly with `Bun.spawn`; there is no maintained wrapper to depend on. For images, `Bun.Image` removes the need for `sharp`.
10. **Process layout.** One process is simplest and enough for about 10k requests per day. A separate worker process isolates deploys and crashes, but needs NOTIFY-based fan-out. With pg-boss, the same codebase can run both roles by toggling `work()` and `supervise`.

## Open / unconfirmed

- **Drizzle `bun-sql` and `jsonb`.** Does Drizzle's driver work around Bun #28819, which double-encodes JSON? Not checked in source. The fix needs a test against real Postgres on Bun 1.4.3.
- **Hono `c.body(BunFile)` and Range.** Does Bun's automatic Range handling still apply when the response is built by Hono's `c.body()` or `serveStatic`? It is likely, because Bun's tests cover handler responses with custom headers, but Hono was not run.
- **Streaming large request bodies.** Does a multi-hundred-MB request body stream to disk in Bun, through `req.body`, `Bun.write` with a `Response`, or `formData()`, without being buffered in memory? Not documented.
- **R2 response overrides.** Does R2 honour `response-content-disposition`/`response-content-type` on presigned GETs (Bun's `contentDisposition` option)? The R2 S3 API page does not list them.
- **Self-hosted S3 compatibility.** SeaweedFS, RustFS and Garage were not tested against `Bun.S3Client` presign, multipart or Range. Garage's repo could not be reached from the shell.
- **Unresearched queue packages.** `bunqueue`, `groupmq` and `pgmq`.
- **BullMQ on Bun with Postgres.** Would `createPostgresBackend` work under Bun? Untested by the project, and not tried here.
- **graphile-worker cancellation.** Can it cancel a running job, beyond shutdown aborts? Not found in docs.
- **pg-boss detail.**
  - The default pool size and connection count per instance were not checked.
  - The exact cancel latency with `heartbeatRefreshSeconds` was not measured.
- **nginx WebSocket proxying** needs `Upgrade`/`Connection` header forwarding. This is from general nginx knowledge; the nginx WebSocket page was not re-read here.
- **Cloudflare and the Backend tunnel.** Do the 100 MB body cap and the 125 s timeout also apply to Cloudflare *Tunnel* public hostnames used to reach ComfyUI Backends? Likely, since they go through the same proxy, but this is an inference and was not confirmed.
- **Blocked pages.** The AWS S3 docs (`upload-objects`, `API_GetObject`) were blocked by the session's permission system. The postgresql.org pages were too, and were read from the Postgres source tree instead. trac.ffmpeg.org's Seeking wiki returned a bot wall. The S3 single-PUT limit and multi-range behaviour are therefore cited from R2 and Bun only.
- **npm metadata.** Package versions were taken from repo tags and `package.json` because the npm registry was unreachable.

## Sources

Repos were cloned on 2026-10-22 into the session scratchpad and read without running any code.

**Bun** (`oven-sh/bun`, tag `bun-v1.4.3`, commit c6da4a4, 2026-10-09; compared with `bun-v1.4.0` from 2026-08-19 and `bun-v1.3.14` from 2026-05-12)
- [bun-sql] `docs/runtime/sql.mdx`: LISTEN/NOTIFY, pooling, roadmap, "Why not just use an existing library?"
- [bun-s3] `docs/runtime/s3.mdx`
- [bun-s3-types] `packages/bun-types/s3.d.ts` (`S3FilePresignOptions`)
- [bun-server] `docs/runtime/http/server.mdx` (idleTimeout, `server.timeout`, HTTP/2)
- [bun-serve-types] `packages/bun-types/serve.d.ts` (`maxRequestBodySize` default)
- [bun-routing] `docs/runtime/http/routing.mdx` (file responses, Range, directory routes)
- [bun-range-tests] `test/js/bun/http/bun-serve-file.test.ts` ("Range requests via FileRoute / fetch handler")
- [bun-ws] `docs/runtime/http/websockets.mdx`
- [bun-spawn] `docs/runtime/child-process.mdx`
- [bun-image] `docs/runtime/image.mdx`
- [bun-compat] `docs/runtime/nodejs-compat.mdx`
- [bun-workers] `docs/runtime/workers.mdx`
- [bun-cron] `docs/runtime/cron.mdx`
- [bun-redis] `docs/runtime/redis.mdx`
- [bun-cluster] `docs/guides/http/cluster.mdx`
- [bun-fileio] `docs/runtime/file-io.mdx`
- [bun-upload-guide] `docs/guides/http/file-uploads.mdx`
- [bun-18775] https://github.com/oven-sh/bun/issues/18775
- [bun-28819] https://github.com/oven-sh/bun/issues/28819

**pg-boss** (`timgit/pg-boss`, HEAD d440085 from 2026-10-15; `package.json` 12.38.0; tag 12.38.0 from 2026-10-13)
- [pgboss-pkg] `package.json`
- [pgboss-bun-src] `src/adapters/bun.ts`
- [pgboss-git] commit 60758b2 (2026-09-09), first contained in tag 12.31.0 (2026-09-10)
- [pgboss-ci] `.github/workflows/ci.yml` (`test-bun` job)
- [pgboss-backends] `docs/database-backends.md` (sections "Bun (driver)" and "What the adapters absorb")
- [pgboss-adapters] `docs/api/adapters.md`
- [pgboss-queues] `docs/api/queues.md`
- [pgboss-jobs] `docs/api/jobs.md`
- [pgboss-workers] `docs/api/workers.md`
- [pgboss-ctor] `docs/api/constructor.md`
- [pgboss-pubsub] `docs/api/pubsub.md`
- [pgboss-dashboard] `docs/dashboard.md`

**BullMQ** (`taskforcesh/bullmq`, HEAD 3cd77f9 from 2026-10-21; 6.4.0)
- [bullmq-readme] `README.md`
- [bullmq-changelog] `docs/gitbook/changelog.md` (6.0.0 from 2026-07-30; 6.4.0 from 2026-10-21)
- [bullmq-pg] `docs/gitbook/guide/postgresql.md`
- [bullmq-conn] `docs/gitbook/guide/connections.md`
- [bullmq-cancel] `docs/gitbook/guide/workers/cancelling-jobs.md`
- [bullmq-summary] `docs/gitbook/SUMMARY.md` (BullMQ Pro, Groups)
- [bullmq-ci] `.github/workflows/test.yml` (`postgres` and `bun-redis` jobs)
- [bullmq-bun-config] `vitest.bun.config.ts`

**graphile-worker** (`graphile/worker`, HEAD 7a2405b from 2026-10-20; v0.18.0 from 2026-09-08)
- [gw-pkg] `package.json`
- [gw-req] `website/docs/requirements.md`
- [gw-status] `website/docs/project-status.md`
- [gw-addjob] `website/docs/sql-add-job.md`
- [gw-tasks] `website/docs/tasks.md`
- [gw-faq] `website/docs/faq.md`
- [gw-repo] repo-wide search for "bun" (no hits in docs, README or release notes)

**Hono** (`honojs/hono`, HEAD 5ca49b0 from 2026-10-17; 4.13.13)
- [hono-pkg] `package.json`
- [hono-sse-src] `src/helper/streaming/sse.ts` and `utils.ts`
- [hono-bun-src] `src/adapter/bun/{index,websocket,serve-static}.ts` (deprecation notices)
- [hono-bun-server] `adapters/bun/src/server.ts`
- [hono-bun-pkg] `adapters/bun/package.json` and `README.md` (`@hono/bun` 1.0.1; added in fc2343d / PR #5447 on 2026-09-28; released in 8d0f24b on 2026-10-08)
- [hono-stream-docs] https://hono.dev/docs/helpers/streaming
- [hono-ws-docs] https://hono.dev/docs/helpers/websocket

**Drizzle** (`drizzle-team/drizzle-orm`, tag 0.45.4 at eab8bed from 2026-10-08; tag v1.0.0-rc.5 at 5d71fc4 from 2026-10-21)
- [drizzle-tags] git tags
- [drizzle-045-src] `drizzle-orm/src/bun-sql/*` at 0.45.4
- [drizzle-rc5-src] `drizzle-orm/src/bun-sql/{postgres,mysql}/*` at rc.5
- [drizzle-045-changelog] `changelogs/drizzle-orm/0.45.0.md`
- [drizzle-rc5] `changelogs/drizzle-orm/1.0.0-rc.5.md`
- [drizzle-kit-045] `drizzle-kit/src/cli/connections.ts` at 0.45.4
- [drizzle-kit-rc5] the same file at v1.0.0-rc.5
- [drizzle-license] `LICENSE`
- [drizzle-bunsql-docs] https://orm.drizzle.team/docs/connect-bun-sql
- [drizzle-migrations-docs] https://orm.drizzle.team/docs/migrations

**PostgreSQL** (`postgres/postgres`, master, 2026-10-22)
- [pg-select] `doc/src/sgml/ref/select.sgml` (locking clause)
- [pg-notify] `doc/src/sgml/ref/notify.sgml`

**nginx and Caddy**
- [nginx-proxy] https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- [nginx-src] `nginx/nginx` (HEAD 2026-10-21): `src/http/ngx_http_core_module.c` (`client_max_body_size` 1 MB) and `src/http/modules/ngx_http_proxy_module.c` (buffering 1, `read_timeout` 60000 ms)
- [caddy-rp] https://caddyserver.com/docs/caddyfile/directives/reverse_proxy

**Cloudflare**
- [cf-524] https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/
- [cf-413] https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413
- [cf-ws] https://developers.cloudflare.com/network/websockets/
- [cf-pagerules] https://developers.cloudflare.com/rules/page-rules/reference/settings/ (Response Buffering)
- [cf-compression] https://developers.cloudflare.com/speed/optimization/content/compression/
- [cf-quick-tunnel] https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- [r2-presign] https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- [r2-pricing] https://developers.cloudflare.com/r2/pricing/
- [r2-s3api] https://developers.cloudflare.com/r2/api/s3/api/
- [r2-limits] https://developers.cloudflare.com/r2/platform/limits/

**Self-hosted S3**
- [minio-readme] `minio/minio` `README.md` (HEAD 7aac2a2 from 2026-02-12)
- [seaweedfs] `seaweedfs/seaweedfs` (HEAD 2026-10-21, tag 4.48, `LICENSE` Apache-2.0)
- [rustfs] `rustfs/rustfs` (HEAD 2026-10-22, tag 1.0.3, README: Apache-2.0)

**ffmpeg**
- [fluent-readme] `fluent-ffmpeg/node-fluent-ffmpeg` `README.md` (last commit 2025-05-22, 2.1.3)
- [ffmpeg-doc] https://ffmpeg.org/ffmpeg.html
- [ffmpeg-formats] https://ffmpeg.org/ffmpeg-formats.html

**SSE and browsers**
- [sse-spec] https://html.spec.whatwg.org/multipage/server-sent-events.html
- [mdn-eventsource] https://developer.mozilla.org/en-US/docs/Web/API/EventSource
