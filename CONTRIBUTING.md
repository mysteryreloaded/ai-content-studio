# Contributing

AI Content Studio is an open-source project under the [MIT
license](LICENSE). Contributions are welcome as pull requests on GitHub;
this document is the short version of how this repository works.

## Ground rules

- **One issue, one pull request.** Every change traces back to an issue in
  the [tracker](https://github.com/mysteryreloaded/ai-content-studio/issues);
  the issue's acceptance criteria are the definition of done. Read the
  issue, then the spec: the project's spec lives in
  [CONTEXT.md](CONTEXT.md) and its decisions in [docs/adr/](docs/adr/).
  When a later issue amended an earlier one, the later one wins.
- **Write the test first.** The test conventions are settled in the spec's
  "Testing Decisions" section: one module driven through its public
  interface at the lowest level that holds the behaviour, a fake clock
  (never sleeps), the fake ComfyUI for Backend calls, a fresh database per
  test file. A flaky test is fixed or deleted (with an issue) in the same
  pull request that broke it.
- **Keep the language's language.** CONTEXT.md is a glossary with
  "avoid" lists — a *Backend* is a ComfyUI server, a *Generation* is not
  a "job", a *Tombstone* is not a "soft delete". Code, messages and
  comments use those terms.
- **English only**, one message per error shape, written once (the shared
  package).

## The workspace

Bun workspaces, four packages:

| Package | What it is |
|---|---|
| `apps/web` | the React + Vite single-page app |
| `apps/server` | the Bun + Hono process: API, SSE, dispatcher, periodic jobs |
| `packages/shared` | zod schemas, types, the pure Workflow logic, the English messages |
| `apps/fake-comfyui` | the fake ComfyUI the tests (and the CI contract suite) drive |

`ops/` holds the Operator's files (the Compose file's Caddyfile, the
Backend kit, the backup scripts, `upgrade.sh`); `docs/` is Markdown only —
no docs site, no wizard; `scripts/` holds the maintainer tools the release
gate runs (the upgrade check, the seed, the doc-link check); `workflows/`
holds the launch Models' exported Workflow files.

## Day-to-day

```sh
bun install            # one lockfile (bun.lock) for the whole workspace
docker compose up -d postgres   # the only external service the tests need
bun run dev            # server + web together (mock Google issuer on localhost)
```

Before pushing, run what CI runs (`.github/workflows/ci.yml`):

```sh
bun run lint           # Biome, the only formatter and linter
bun run typecheck      # tsc -b
bun run db:check       # migrations match the schema
bun run --filter @ai-content-studio/server env:check   # .env.example matches
bun test --isolate
bun run build          # the Vite build
```

There is no branch to push to first: open a pull request against `main`
from your fork (or, for maintainers, from a `swarm/…` branch). Every check
in `ci.yml` is required on `main`, and a pull request's CI must stay
under about ten minutes — path-triggered jobs (the ComfyUI contract run,
the backup round-trip, the upgrade check) exist so the heavy ones don't
run on every push. Release process: [docs/ops/releasing.md](docs/ops/releasing.md).

## Reporting problems and security

Bugs go to the issue tracker. Vulnerabilities go through the security
process in [SECURITY.md](SECURITY.md), not to a public issue.
