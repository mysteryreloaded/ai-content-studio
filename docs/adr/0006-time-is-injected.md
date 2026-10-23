---
status: accepted
---

# Time is injected; queries never decide with `now()`

Much of the studio's behaviour hangs on time:
- Backend health every 30 s, and unreachable after 3 failures;
- a lost try after 2 minutes unreachable, and 10 minutes allowed for `starting`;
- 15 minutes waiting for a usable Backend, and each Model's max run time;
- the rolling 24-hour daily Cap and the 12-hour freshness of `HEAD /view`;
- the 24-hour cleanup of unused Uploads, and the retention days;
- the Problems' 5-minute delays and the dispatcher's 10 s backstop.

We decided that every module reads time from one clock, passed in where the process starts. Any SQL that decides behaviour takes the clock's time as a parameter instead of calling Postgres `now()`. Tests use a fake clock and advance it, so every timeout can be tested in milliseconds without sleeping.

## Considered Options

- **Shorter timeouts set through env vars in tests.** Timings would differ from production, and tests would still sleep. The variables would also spread into the Operator's configuration.
- **Real sleeps.** These are slow, flaky under load, and can't reach the 24-hour rules.
- **Bun's fake timers** (`useFakeTimers`, Bun ≥ 1.3.4). They replace timers for the whole process and freeze `Date.now()`, `performance.now()` and `process.hrtime`. As of October 2026 they ignore `toFake`/`doNotFake`. So the timers of the Postgres driver, the `/ws` client and Hono would stop too, while Postgres `now()` would keep reading the real clock.

## Consequences

- Queries such as the daily Cap or "unreachable for more than 2 minutes" take `$now`. A reviewer rejects `now()` in any condition or computed deadline.
- Timestamps that are later compared are also written from the clock. Examples: when a Generation was submitted or started running, when an Upload was last used, and when a Log entry was written (Log pruning compares it). Only timestamps that nothing compares against, such as an Audit entry's `created_at`, may default to `now()`.
- Intervals and timeouts are scheduled through the clock, never with `setTimeout` directly.
- Production always uses the real clock. No env var changes it.
