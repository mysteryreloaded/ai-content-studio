# Licensing a Model

Each Model's generation output is only as free to use as the Workflow,
checkpoints and LoRAs it runs. Before setting Model terms (in the Model
editor's "Terms and attribution" section), check the license of every
asset the Workflow depends on:

- Base checkpoints and LoRAs each carry their own license (for example
  CreativeML OpenRAIL-M or a vendor-specific license); some restrict
  commercial use or redistribution of generated output.
- A Workflow that calls an outside service (issue #94) is additionally
  bound by that service's own terms.

Use the editor's fields to pass this on to users of the Model:

- **Model terms**: anything a user must agree to before using this
  Model, in Markdown (shown in a blocking dialog the first time they
  open it, and again whenever you tick "Ask everyone to accept
  again").
- **License URL**: a link to the authoritative license text for the
  underlying checkpoint(s)/LoRA(s).
- **Attribution**: a short credit line (such as "Base model by
  Example Corp, CC BY 4.0"), shown atop the Workbench, on the Models
  home and on a Generation's detail.

When in doubt, set terms that are at least as restrictive as the most
restrictive asset in the Workflow.
