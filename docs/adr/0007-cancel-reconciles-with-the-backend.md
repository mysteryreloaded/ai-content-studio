---
status: accepted
---

# Cancel reconciles with the Backend; it never trusts a flag alone

A user cancels one Generation, or a whole Submission (which cancels each of its Generations). There is no Admin cancel. A queued Generation never reached a Backend, so it cancels at once. A starting or running Generation calls ComfyUI's `POST /api/jobs/{id}/cancel` and moves to cancelling, shown until ComfyUI reports the interrupt or the job is no longer in `/api/jobs`; the Backend counts as busy the whole time, so the dispatcher (ADR 0002) does not hand it a second Generation while the first is still being interrupted.

If the Backend is unreachable, the user's Generation is cancelled immediately regardless — an outage must not hold their slot or Cap hostage. The Backend is not trusted to have stopped, though: it is marked for a re-cancel, and the dispatcher sends that cancel before the Backend is next given any Generation, queued or test. A Backend with a pending re-cancel is not eligible for dispatch.

## Considered Options

- **Free the Backend as soon as the cancel request is sent**, without waiting for confirmation or the job to disappear. Rejected: ComfyUI may still run the interrupted prompt to completion and emit a Generation's Assets after the studio already queued different work on that Backend.
- **Hold the user's slot open until an unreachable Backend is confirmed cancelled.** Rejected: an outage would then block the user from submitting again, which is the opposite of what cancel is for.
- **Let the next dispatch attempt discover the stale job itself**, instead of a standing re-cancel mark. Rejected: nothing then re-sends the interrupt if that Backend sits idle and undispatched for a while; the mark makes the re-cancel unconditional on the next contact, not on the next successful pairing.

## Consequences

- The dispatch-eligibility query (ADR 0002) also excludes a Backend with a pending re-cancel.
- The fake ComfyUI needs to hang a prompt indefinitely until a cancel for it arrives, so tests can exercise the cancelling state and the re-cancel-before-reuse path.
