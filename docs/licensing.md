# Model licenses and AI rules

A Generation's output is only as free to use as the assets the Model
ran on: the base checkpoint, any LoRAs, the Workflow itself, and any
outside service the Workflow calls. The license that matters most is
the base model's — and it binds the **Operator** who offers the Model,
not the user. You answer for the Models you offer.

## The chain of licenses

- **Base checkpoints and LoRAs** each carry their own license (for
  example CreativeML OpenRAIL-M or a vendor-specific license); some
  restrict commercial use or redistribution of generated output. The
  Studio ships no weights — every checkpoint is one you added — so
  finding and reading these licenses is your job before you enable a
  Model.
- **The Workflow.** A Workflow is code, and it is licensed like code.
  A Workflow that is adapted from another graph keeps the notice it
  came with. The example [`workflows/`](../workflows/) in this repo
  currently carries no license notice of its own — an LTX 2.5 all-in-
  one graph; the LTX 2.5 checkpoints it assumes are a separate,
  separately-licensed download, not part of this project.
- **Outside services.** A Workflow that calls an outside service
  (issue #94) is additionally bound by that service's own terms.

Put the authoritative text where your users can reach it: the Model
editor's **License URL** field takes a link to the license text of the
underlying checkpoint(s)/LoRA(s).

## Passing the license on to users

The editor's "Terms and attribution" section is how the Model's
license reaches its users:

- **Model terms**: anything a user must agree to before using this
  Model, in Markdown. Shown in a blocking dialog the first time they
  open the Model, and again whenever you tick "Ask everyone to accept
  again" — see [the consent screen](ops/consent.md).
- **License URL**: a link to the authoritative license text for the
  underlying checkpoint(s)/LoRA(s).
- **Attribution**: a short credit line (such as "Base model by
  Example Corp, CC BY 4.0"), shown atop the Workbench, on the Models
  home and on a Generation's detail, and stamped into finished Assets.

When in doubt, set terms that are at least as restrictive as the most
restrictive asset in the Workflow.

## The AI rules the Studio enforces for you

Some of the "AI rules" around generated media are built into the
Studio rather than left to the Model's license:

- **Every finished video Asset** is written with a comment tag:
  `AI-generated with <Model> on <site>, Generation <id>` — so an
  "AI-generated" marker survives the file being copied and shared.
- **C2PA metadata.** Each finished video Asset also carries a C2PA
  manifest recording that it is algorithmically (AI-)generated, the
  Model's name, the Studio's title and the Generation's id. The
  manifest is signed when you set `C2PA_CERT_PATH`/`C2PA_KEY_PATH` in
  your `.env` (see [server-env.md](server-env.md#c2pa_cert_path));
  unsigned when you don't. C2PA signing is available on `linux/amd64`
  images only and is skipped for webm and ogg/opus containers.
- **The Model's attribution line** is stamped into the Asset alongside
  these, so the credit travels with the file too.

## A note on the MiniMax H3 license

MiniMax's **H3** video model's license contains **territorial
restrictions** — coverage that depends on where you operate. Before
offering a Model built on H3 (or any Model whose license is
territory-specific), read the **current** license text at the Model's
License URL and make sure your territory is covered; license terms of
this kind change, so check the live text, not a summary of it.
