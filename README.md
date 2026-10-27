# AI Content Studio

An open-source studio for AI image and video generation, run on your own
GPUs. One small server — the **Studio** — that you host yourself, with your
own users, your own [Models](docs/ops/model-building.md) and your own
brand. Users sign in with their own Google account; you decide who may
use the Studio.

## What ships

- **No model weights.** The `studio` image contains no checkpoints, LoRAs
  or weights of any kind. Every Model you offer is one you add, and the
  license that comes with its base model binds the **Operator** (you) —
  not the user. See [Model licenses and AI rules](docs/licensing.md).
- **MIT-licensed code.** The Studio's code is MIT, "AI Content Studio
  contributors" (see [LICENSE](LICENSE)). A Workflow that is adapted from
  another graph keeps the notice it came with; the example
  [`workflows/`](workflows/) in this repo currently carries none of its
  own.
- **Provenance by default.** Every finished video Asset is written with a
  C2PA manifest and a comment tag naming the Model, the Studio and the
  Generation that produced it, so provenance survives sharing.
- **Privacy by construction.** No analytics, no cookies beyond a session
  cookie, no third-party scripts — see
  [Privacy](docs/ops/privacy.md).

## Getting started

[Deploying the Studio](docs/ops/deploy.md) walks the whole path: one
Compose file, one `.env`, one Google OAuth client, then your Backends and
your first Model.

| You want to… | Read |
|---|---|
| Deploy the Studio (Compose, `.env`, Caddy, the OAuth client) | [Deploying](docs/ops/deploy.md) |
| Attach your ComfyUI machines as Backends | [GPU Backends](docs/ops/backend-kit.md) |
| Build, test and enable a Model | [Building a Model](docs/ops/model-building.md) |
| Back up, and drill your restores | [Backups](docs/ops/backup.md) |
| Watch it, and get paged when something is wrong | [Monitoring](docs/ops/monitoring.md) |
| Upgrade to a new release (back up first) | [Upgrading](docs/ops/deploy.md#upgrading) |
| Know what a user sees when they consent | [The consent screen](docs/ops/consent.md) |
| Write your site terms | [Site terms](docs/ops/site-terms.md) |
| Know exactly what data the Studio keeps | [Privacy](docs/ops/privacy.md) |
| License a Model's output, and the AI rules around it | [Model licenses and AI rules](docs/licensing.md) |
| Cut a new release (maintainers) | [Releasing](docs/ops/releasing.md) |
| Look up an environment variable | [server-env](docs/server-env.md) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) — "AI Content Studio contributors". A Model's own license
(its License URL) binds the Operator who offers it; see
[Model licenses and AI rules](docs/licensing.md).
