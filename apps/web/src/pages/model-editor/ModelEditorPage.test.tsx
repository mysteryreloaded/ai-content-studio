import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  DETAIL,
  cleanup,
  finishFile,
  mockFetch,
  openSection,
  prepareConfirmAndEventSource,
  renderEditor,
  respondGet,
  restoreConfirm,
  waitFor,
} from "./testing/harness.js";

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await finishFile();
});

beforeEach(() => {
  prepareConfirmAndEventSource();
});

afterEach(() => {
  restoreConfirm();
});

describe("ModelEditorPage", () => {
  // issue #213: the leave prompt is a `Dialog` now (not `window.confirm`),
  // and Delete moved into Details behind its own confirm `Dialog` — both
  // moved to frame/EditorFrame.test.tsx ("the leave dialog stays or
  // discards", "delete refused with unfinished Generations"). The
  // success/stale-version delete cases live there too now.
  //
  // PR #241 QA round 1: the two Save-409 cases ("a taken slug on save
  // shows the server's own message, not the generic reload one", "a
  // stale version on save shows the reload message") are header/save
  // behaviour, not a section's own — moved to frame/EditorFrame.test.tsx
  // alongside the rest of the Save-sequence tests.

  // Issue #217: the Backends section's own tests (attach, detach, health,
  // "Runs all N Modes", the severity rule) moved to
  // sections/BackendsSection.test.tsx, updated for the new "Runs
  // on"/"Other Backends" layout.

  test("Enable shows the server's reasons when the Model isn't ready", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "POST" && call.url.endsWith("/enable")) {
        return Response.json(
          { error: "not ready", reasons: ["needs at least one Mode"] },
          { status: 400 },
        );
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await userEvent.click(await view.findByRole("switch"));

    expect(await view.findByText("needs at least one Mode")).toBeTruthy();
  });

  // issue #213: "Save Modes becomes 'Save and disable'..." moved to
  // frame/EditorFrame.test.tsx ("Save and disable sends disable:true"),
  // now against the header's one Save.

  test("Enable stays disabled once checkModel has errors, without asking the server", async () => {
    const detail = {
      ...DETAIL,
      inputs: [],
      modes: [],
    };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    const enableSwitch = (await view.findByRole("switch")) as HTMLButtonElement;
    await waitFor(() => expect(enableSwitch.disabled).toBe(true));
    await userEvent.click(enableSwitch);

    expect(calls.some((c) => c.url.endsWith("/enable"))).toBe(false);
  });

  // Issue #259: the Revisions section's own tests (every revision listed
  // newest first with the "current" pill and "Workflow changed", the
  // confirm dialog, "Discard and restore" while dirty, and "Restore and
  // disable" after the server's refusal) moved to
  // sections/RevisionsSection.test.tsx.
});
