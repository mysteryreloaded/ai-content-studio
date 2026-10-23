---
status: accepted
---

# Lost tries are retried, up to 2; other failures end the Generation

A Try can end for many reasons. We decided to retry only the ones that say nothing about whether the request itself was good: the Backend was unreachable while starting or for more than 2 minutes while running, the job 404s, or ComfyUI's own rejection was only a missing node (which also refetches that Backend's node list, in case it was just installed). Those are Lost tries: retried on any Backend, capped at 2 Tries total, logged as a warning. Boot recovery reattaches to a running job via `/api/jobs/{id}` instead of assuming every in-flight Try was lost, so a Backend that kept working through a studio restart isn't retried needlessly.

Every other ending — any other rejection, `execution_error`, no outputs, a Backend 413, or hitting the Model's max run time — fails the Generation immediately with a plain reason, keeping ComfyUI's raw error in an `error` Log entry. Retrying a bad graph or a bad input would waste GPU time and the user's patience without fixing anything.

## Consequences

- Saving the finished Assets isn't a Try: it already succeeded on the Backend, so it retries with its own 15-minute backoff before failing, instead of counting against the Generation's 2 Tries.
- A draining Backend finishes its current Try normally; draining only stops new Tries from landing there.
- A queued Generation with no usable Backend for its Mode isn't a Lost try either: it waits (15 minutes) and then fails on its own, since no Try was ever made.
