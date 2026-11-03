## Agent skills

### Issue tracker

Issues live in GitHub Issues for `mysteryreloaded/ai-content-studio`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## UI sizes

The web app's type, control, padding and rhythm sizes are specified in
`docs/ui-sizes.md` (issue #222). They override the prototype's compact
sizes: take layout, colours and components from the prototype, and sizes
from there. New pages use the shared components and the named rhythm
classes instead of per-page size values.
