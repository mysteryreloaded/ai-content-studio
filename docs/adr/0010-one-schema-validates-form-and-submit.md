---
status: accepted
---

# One cached zod schema per Model revision and Mode validates both the form and the submit

An Input's rules must match exactly between what the Workbench lets a user type and what the server accepts, or a user hits a submit error the form never warned about. We decided `parseInputValues` builds one zod object schema per (Model revision, Mode), caches it, and the same schema serves as both the Workbench's form resolver and the server's submit validator — so there is only one implementation of the rules to get right.

## Considered Options

- **Separate client and server validation.** Two implementations of the same rules drift: a rule changed on one side but not the other either blocks valid input or lets invalid input reach submit.
- **Validate only on submit, no client-side resolver.** Users would only learn a value is wrong after pressing Generate, instead of as they type.
- **Rebuild the schema on every use instead of caching.** A Model revision's Inputs never change once saved, so rebuilding per request is wasted work; caching by (Model revision, Mode) is safe because that pair is immutable.

## Consequences

- A Model revision's Inputs, once saved, are never read back into a different schema shape; the cache key (Model revision id, Mode) is enough.
- `buildPrompt` only ever sees values `parseInputValues` already validated.
