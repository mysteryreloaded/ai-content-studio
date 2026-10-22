# PROTOTYPE: Model editor (throwaway)

Three variants of the Admin's Model editor, switchable from a floating bar, for the ticket [How does an Admin build a Model in the browser?](https://github.com/mysteryreloaded/ai-content-studio/issues/19). This branch is the prototype's record; nothing here merges to `main`.

## Run it

- Open `index.html` in a browser (React loads from cdnjs), or
- rebuild after editing `src/`: `bun prototypes/model-editor/build.ts`

Switch variants with the bar's arrows, the ← / → keys, or `?variant=a|b|c`. The bar's menu switches scenarios: editing LTX 2.5 (enabled, revision 7), a new Model with no Workflow, and a re-uploaded Workflow that broke two bindings.

## The variants

- **A · Sections and a Mode grid.** Classic admin form: section nav, one section at a time, live checks in a right rail. Modes are edited in one Input × Mode grid.
- **B · Workflow inspector.** Starts from the graph: pick a node, see its Node fields, turn a field into an Input. A Mode bar dims nodes outside that Mode's Path.
- **C · Guided, Mode by Mode.** Six steps in build order. Inputs come with suggestions mined from the Workflow; each Mode is set up beside a live preview of the form users see.

All three share one in-memory draft, so a change made in one shows in the others. Nothing is saved.

## What is mock

- The reshaped LTX 2.5 API export doesn't exist yet. `src/data.js` builds a stand-in from the real node classes, titles, files and values in `workflows/ltx-2-5-all-in-one.ui.json`; node ids above 6000 are invented.
- The Inputs × Modes table is a draft until "What Inputs and Mode states does the LTX 2.5 Model ship with?" settles it.
- `/object_info`, Backends, health and the test Generation are simulated. `src/logic.js` holds a simplified `computePath` and `checkModel` following ADR 0001 and the binding and validation decisions.
