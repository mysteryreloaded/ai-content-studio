---
status: accepted
---

# Chunked Uploads resume from the server's offset; nothing survives a reload

An Upload must start on pick and survive a flaky connection (user stories 25–27), without the server re-reading a whole large file when one chunk fails. The protocol is `create` (name, size, type), then `PUT` 16 MB chunks at offsets, then `complete`. A failed chunk is retried; if the connection drops mid-Upload, the client asks the server what it already has and resumes from there.

We decided the server's byte count is the only record of progress, and the client keeps none of its own: no chunk state in local storage or IndexedDB, nothing resumed across a page reload. A reloaded tab starts that Upload over from offset 0 against the same Upload row, which the server still accepts because it is incomplete. This keeps the resume logic in one place, testable as pure client code against a fake server offset, with no risk of a cached client offset drifting from what the server actually wrote to disk.

## Considered Options

- **Persist chunk progress in IndexedDB, keyed by a client-made Upload id.** Would survive a reload, but doubles the sources of truth: a crash between a chunk write and the IndexedDB write, or a server restart that loses an in-progress file, leaves the client believing it is further along than the server. The gain (surviving a reload, not just a network blip) is small next to the Upload's already-generous 24-hour incomplete-Upload lifetime.
- **A resumable-upload protocol with signed resume tokens (tus-style).** Gives the same guarantee with more moving parts than one local disk and a byte count; nothing here needs a third-party protocol or multi-server coordination.

## Consequences

- `create` returns an Upload id; every `PUT` and the `complete` call are keyed by it, and the client only needs to ask the server (not itself) how many bytes it has before retrying or resuming.
- A user who reloads mid-Upload sees it restart from the beginning, not resume; this is acceptable because it is rare next to ordinary chunk failures on a flaky connection, which do resume.
- The chunk-retry and resume-from-offset logic has no browser-storage dependency, so it is unit-tested as pure functions against a fake server offset, per the ticket's acceptance criterion.
