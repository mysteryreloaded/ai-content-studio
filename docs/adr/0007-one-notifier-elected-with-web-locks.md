---
status: accepted
---

# Tabs share visibility over BroadcastChannel; one elects itself notifier with Web Locks

A browser can have several studio tabs open at once, each running its own SSE stream and watching its own set of Submissions. Only one Notification may fire per Submission, title and favicon Tab cues must reset as soon as *any* tab becomes visible, and a `Notification`'s own cross-tab de-duplication can't be relied on: per the research gathered for issue #58, a shared `tag` only replaces an earlier notification of the same tag in Chrome, Safari ignores `tag` entirely, and Firefox's cross-tab behaviour is unconfirmed.

We decided tabs coordinate themselves instead of trusting the Notification API to do it:

- Every studio tab joins one `BroadcastChannel`, per browser, and posts its own `visible`/`hidden` state on every `visibilitychange`. Each tab derives "is any studio tab visible" from the loudest state it has seen (its own plus the last one posted by every other tab), and resets its Tab cue the moment that becomes true.
- Before raising a Notification, a tab takes a Web Lock (one name, shared by the browser) with `{ifAvailable: true}`. Only the tab that gets the lock proceeds; the others skip. This elects one notifier per browser without the tabs negotiating a leader explicitly, and survives tabs closing mid-flight since an abandoned lock is simply free for the next request.
- A tab tracks, in memory, the ids of Submissions it has seen under way (queued or running). When a later snapshot stops listing one of them, the tab doesn't infer the outcome from its absence: it fetches that Submission's end state by id with one owner-checked request (`GET /submissions/:id`, 404 for anyone but its owner), then feeds the real counts into the same decision logic a live snapshot would have used.

## Considered options

- **Rely on `Notification`'s own `tag` de-duplication.** Rejected: unreliable outside Chrome (see above), and it still wouldn't drive the Tab cue, which needs the same "is any tab visible" fact.
- **A `SharedWorker` as the single owner of SSE and notifying.** Would solve both problems at once, but Safari has never shipped `SharedWorker`, which is one of the four browsers this ticket targets.
- **Pick the notifier by tab id order (e.g. lowest, or first opened).** Needs the tabs to already agree on a shared list and to re-elect on close; Web Locks gives the same guarantee for free and handles a crashed/closed tab automatically.
- **Have the server pick one tab per user to notify (e.g. via the SSE connection list).** Moves client-only decision logic onto the server and needs it to track which connections are "visible", which the server has no way to know.

## Consequences

- The election, the visibility fact, and the decision of whether a given Submission's end should notify or just update the Tab cue are pure functions over small inputs (the tracked ids, the fetched end state, the browser's notification setting, the last-known visibility), so they're unit-testable without a browser. Only three calls stay thin and untested: `new Notification()`, `BroadcastChannel.postMessage`, and `navigator.locks.request`.
- A tab that misses the BroadcastChannel message of a tab that opened or closed a split second earlier briefly double-notifies at most once; this is judged acceptable given the alternative complexity, and Web Locks still prevents two tabs from both firing for the *same* Submission at the *same* instant.
- A Notification's own cancel/Removal exclusions, and "ends while hidden" vs. "ends while visible", are decided from the fetched end state and the tracked visibility fact, never from the dropped-snapshot event itself, so a tab that was briefly backgrounded and missed several snapshots still gets the right call once it resyncs by id.
