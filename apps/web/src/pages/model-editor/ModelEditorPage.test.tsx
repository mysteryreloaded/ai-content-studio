import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  type AttachedBackendEntry,
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

  test("Backends section lists an attached Backend's missing node types, and attaches another one", async () => {
    const BACKEND_A = { id: "b1", name: "GPU 1", baseUrl: "http://gpu1" };
    const BACKEND_B = { id: "b2", name: "GPU 2", baseUrl: "http://gpu2" };
    let attached: AttachedBackendEntry[] = [
      {
        backend: BACKEND_A,
        reachable: true,
        missingNodeTypes: ["SomeNode"],
        note: null,
      },
    ];

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL);
      if (
        call.method === "GET" &&
        call.url.endsWith("/api/admin/models/m1/backends")
      )
        return Response.json({ backends: attached });
      if (call.method === "GET" && call.url.endsWith("/api/admin/backends"))
        return Response.json({ backends: [BACKEND_A, BACKEND_B] });
      if (call.method === "POST" && call.url.includes("/backends")) {
        attached = [
          ...attached,
          {
            backend: BACKEND_B,
            reachable: false,
            missingNodeTypes: null,
            note: "unreachable; can't check for missing node types",
          },
        ];
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    await openSection(view, "Backends");

    expect(await view.findByText("GPU 1")).toBeTruthy();
    expect(view.getByText("SomeNode")).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.selectOptions(
      view.getByLabelText("Attach a Backend"),
      "b2",
    );
    await userEvent.click(view.getByText("Attach"));

    expect(
      await view.findByText("unreachable; can't check for missing node types"),
    ).toBeTruthy();
    expect(
      calls.some((c) => c.method === "POST" && c.body?.backendId === "b2"),
    ).toBe(true);
  });

  test("detaching the only Backend empties the Backends section", async () => {
    const BACKEND_A = { id: "b1", name: "GPU 1", baseUrl: "http://gpu1" };
    let attached = [
      {
        backend: BACKEND_A,
        reachable: true,
        missingNodeTypes: [],
        note: null,
      },
    ];

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL);
      if (
        call.method === "GET" &&
        call.url.endsWith("/api/admin/models/m1/backends")
      )
        return Response.json({ backends: attached });
      if (call.method === "GET" && call.url.endsWith("/api/admin/backends"))
        return Response.json({ backends: [BACKEND_A] });
      if (call.method === "DELETE" && call.url.includes("/backends/")) {
        attached = [];
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    await openSection(view, "Backends");

    expect(await view.findByText("GPU 1")).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByText("Detach"));

    expect(await view.findByText("No Backends attached.")).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

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
