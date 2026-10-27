# Releasing

How a maintainer turns a green `main` into a published release: a release
**candidate** that passes the full gate and a manual GPU checklist, then a
**final** release that re-tags a passing candidate's digest without
rebuilding anything. See [deploy.md](deploy.md) for how an Operator installs
and upgrades a published version.

## The shape of a release

1. **Cut a candidate.** When `main` is the state you'd ship, tag it
   `vX.Y.Z-rc.N` (the first candidate of a version is `-rc.1`). The release
   workflow runs the entire gate — everything a PR runs, plus the three
   path-triggered jobs unconditionally, plus native amd64/arm64 boots of the
   built image — and the [upgrade check](#the-upgrade-check), which only
   v1.0.0 skips (any later candidate without a final release below it fails
   the gate, so the check can never be silently skipped). It then pushes
   the multi-arch image as
   `ghcr.io/mysteryreloaded/ai-content-studio:X.Y.Z-rc.N`.
2. **Tick the Release issue.** Open one from the
   [Release issue template](https://github.com/mysteryreloaded/ai-content-studio/new/choose)
   and work through its GPU checklist on the 2×3090 test Backend
   ([the checklist](#the-manual-gpu-checklist), kept there in full). A
   failure means a new `rc.N+1` — fix on `main`, re-cut, re-tick.
3. **Cut the final.** When the Release issue is fully ticked, tag
   `vX.Y.Z`. The release workflow first verifies that the candidate's own
   gate ran green — the upgrade check and the native boots run *after* the
   image is pushed, so a pushed image alone is not a passing candidate —
   and then re-tags the latest `X.Y.Z-rc.N`'s digest as `X.Y.Z` and
   `latest`: same image, same digest, no rebuild. If the latest candidate
   is not the one you checked, re-cut it as a higher `rc.N` first so the
   highest number is the passing one.

A **patch** release runs the reduced checklist (one Mode per launch Model
plus whatever changed); a **minor or major** runs every box. The checklist
lives in two places and must be kept in sync: this document and the Release
issue template (`.github/ISSUE_TEMPLATE/release.yml`).

## The gate in detail

A candidate tag runs, in parallel:

- **The PR gate**: the frozen install, Biome, `tsc -b`, the consistency
  checks (migrations vs schema, `.env.example` vs the env schema, Compose
  config, ShellCheck, doc links), `bun test` and the Vite build — the same
  checks a PR runs on `main`.
- **The upgrade check** (below; only v1.0.0 skips it — any later candidate
  without a final release below it fails the gate instead, so the check can
  never be silently skipped).
- **The backup round-trip**: the same job the path trigger runs in CI — a
  canary row survives a dropped database and a wiped `/data`, and
  `check-storage` is clean afterwards.
- **The ComfyUI contract run**: the same suite, against the pinned
  CPU-only ComfyUI (docs/ops/backend-kit.md's "ComfyUI version").
- **Native boots**: the built image booted on a native-architecture runner
  for `linux/amd64` and, when a self-hosted ARM64 runner is registered,
  `linux/arm64` — the container must reach a healthy `/healthz` against a
  fresh Postgres.

All of it must be green before the Release issue's "gate" section can be
ticked. The whole flow keeps a PR's CI under ~10 minutes; the heavy jobs
(ComfyUI, the round-trip, the upgrade check) only add minutes to a release
run, which has no such budget.

## The upgrade check

`scripts/upgrade-check.sh` is the automated half of "an upgrade never
breaks what was already installed". A v1.0.0 candidate skips it — there is
nothing to upgrade *from* — and any later candidate without a final
release below it fails the gate instead, so the check can never be
silently skipped. Given a previous release image and a candidate image,
it:

1. starts the **previous** release with a fresh Postgres and a fresh
   `/data` volume, and seeds it through its own API
   (`scripts/seed.ts`, over the in-repo mock OIDC issuer): an Admin
   signing in, the Site settings with a logo, one registered (fake)
   Backend, one enabled Model with one Mode, and one complete Upload —
   rows in `users`, `sessions`, `site_settings`, `backends`, `models`,
   `model_revisions`, `workflows`, `uploads` and real files under `/data`.
2. stops it, then boots the **candidate** image on the same database and
   the same `/data`.
3. checks that the candidate is **healthy** (`/healthz` 200 — migrations
   ran at boot, or the container is down), **migrated** (the database's
   `drizzle.__drizzle_migrations` rows match the candidate's migration
   files — the table the pinned drizzle-orm version uses by default) and
   that **`check-storage`** reports nothing left to fix.

It runs path-triggered in a PR (when the image, the migrations, the env
schema or the storage layout changes) and unconditionally in a candidate
tag, always against the latest *final* release on GHCR.

## The manual GPU checklist

Run against the candidate image on the 2×3090 test Backend (one ComfyUI
per GPU, the Backend kit's cleanup timer running), with real sample
Uploads — a short clip with sound and one person in it, plus a character
image. Tick one box per run; a failed run fails the release.

**Minor / major — every launch Mode with its shipped defaults:**

- LTX 2.5: Text to Video, Audio to Video, Image to Video, First/Last
  Frame, Lipsync, First/Last Frame Lipsync, First–Middle–Last (your
  audio), First–Middle–Last (generated audio), Style Transfer, Reference
  sheet, Outpaint — each with every Input left at its shipped default.
- Wan 2.2: Character replace with the default size.

**And the edge cases:**

- A **cancel** mid-run: the card reports cancelled and the Backend frees.
- A **ComfyUI restart mid-run**: kill the GPU machine's ComfyUI while a
  run is under way; the try is lost and retried on the other Backend, and
  the Generation finishes.
- **Both Backends busy** at once: a third queued Generation waits and
  starts when a Backend frees (no error, no double run).
- A finished **Asset's tag and C2PA manifest**: the file's "AI-generated
  with …" tag survives, and a C2PA reader shows the manifest's
  `c2pa.created`, `trainedAlgorithmicMedia`, Model, site title and
  Generation id.
- A **keyboard-only pass**: sign in, pick a Mode, submit, watch the card,
  open the detail dialog, download — without touching a mouse.
- **One Notification from a hidden tab**: a Submission ends while the
  tab is hidden; the browser shows exactly one notification for it.

**Patch — the reduced subset:** one Mode per launch Model (LTX 2.5 and
Wan 2.2) with its shipped defaults, plus whatever this patch changed.

## Notes

- **arm64 boots**: GitHub's hosted runners are amd64-only, so the arm64
  boot job runs on a self-hosted runner labelled `ARM64` (any Linux arm64
  box with Docker — a Graviton or a Raspberry Pi will do). Register one
  under Settings → Actions → Runners and set the repository variable
  `ARM64_RUNNER` to its runner label; until then the job skips itself and
  the amd64 boot still gates every release.
- **Branch protection**: every check the PR workflow
  (`.github/workflows/ci.yml`) can report must be *required* on `main` —
  Settings → Branches → the `main` rule. Skipped path-triggered jobs count
  as passing, so the required list is simply every job in that workflow.
- **Renovate** keeps the image's pinned dependencies current between
  releases; a release is still a deliberate tag, never a rebuild of
  `latest`.
- **The `latest` tag** is updated on every final release for browsing the
  GHCR package page; Operators must always pin `STUDIO_VERSION` to a
  numbered version, never `latest` (deploy.md).
