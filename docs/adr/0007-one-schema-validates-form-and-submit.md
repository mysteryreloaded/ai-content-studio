---
status: accepted
---

# One cached zod schema per Model revision and Mode validates both the form and the submit

An Input's rules (lengths, min/max/step, option counts) must match exactly between what the Workbench lets a user type and what the server accepts, or a user hits a submit error the form never warned about. We decided `parseInputValues` builds one zod object schema from a Model revision's Inputs as a Mode shows them, caches it by (Model revision id, Mode), and the same schema serves as the Workbench's form resolver and the server's submit validator.

The schema is strict: a value for an Input the Mode doesn't show is a 400, not a silently dropped field. Numbers must land on `min + k·step`; one-line text collapses line breaks to spaces before length-checking. Errors come back as `400 { error: "invalid", issues: [{ path, code, message }] }`, mapped onto the same fields client and server share.

## Considered Options

- **Separate client and server validation.** Two implementations of the same rules drift: a length bumped on the server but not the client form (or the reverse) either blocks valid input or lets invalid input through to submit.
- **Validate only on submit, no client-side resolver.** Users would only learn a value is wrong after pressing Generate, instead of as they type.
- **Rebuild the schema on every use instead of caching.** A Model revision's Inputs never change once saved, so rebuilding per request is wasted work; caching by (Model revision, Mode) is safe because that pair is immutable.

## Consequences

- A Model revision's Inputs, once saved, are never read back into a different schema shape; the cache key (Model revision id, Mode) is enough.
- Changing what "strict" rejects, or how a number is step-checked, changes behaviour identically on the form and on submit — there is only one place to get it right or wrong.
- `buildPrompt` runs after `parseInputValues` succeeds: it only ever sees already-validated values, and writes them into the bound Node fields, leaving a blank Input's fields at the Workflow's own value.
