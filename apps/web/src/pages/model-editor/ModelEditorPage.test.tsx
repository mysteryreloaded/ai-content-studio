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
  NO_BACKENDS,
  cleanup,
  finishFile,
  fireEvent,
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

  const MODE_DETAIL = {
    ...DETAIL,
    model: { ...DETAIL.model, currentRevision: 2, version: 1 },
    workflow: {
      "1": { class_type: "LoadImage", inputs: {} },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    },
    nodes: [
      { id: "1", classType: "LoadImage", title: null },
      { id: "2", classType: "SaveImage", title: null },
    ],
    modes: [
      {
        id: "mode-1",
        sortOrder: 0,
        name: "Default",
        description: "",
        outputNodes: [
          { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
        ],
        inputSettings: [],
      },
    ],
    inputs: [],
  };

  const REVISIONS = {
    revisions: [
      {
        revisionNumber: 2,
        createdAt: "2026-01-02T00:00:00.000Z",
        workflowHash: "hash2",
        modeCount: 1,
        inputCount: 0,
      },
      {
        revisionNumber: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        workflowHash: "hash1",
        modeCount: 0,
        inputCount: 0,
      },
    ],
  };

  function respondGetWithRevisions(url: string): Response {
    if (url.endsWith("/api/admin/models/m1")) return Response.json(MODE_DETAIL);
    if (url.endsWith("/revisions")) return Response.json(REVISIONS);
    return Response.json(NO_BACKENDS);
  }

  test("Revisions lists every revision and Restore posts the current version", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      if (call.method === "POST" && call.url.endsWith("/revisions/1/restore")) {
        return Response.json({
          record: { ...MODE_DETAIL.model, currentRevision: 3, version: 2 },
          modes: [],
          inputs: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Revisions");

    await view.findByText("2 (current)");

    const restoreButtons = await view.findAllByText("Restore");
    expect(restoreButtons).toHaveLength(2);
    // Row order is newest first; revision 1's row is the second one, and
    // revision 2 (current)'s own Restore button stays disabled.
    await userEvent.click(restoreButtons[1] as HTMLElement);

    const restored = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/revisions/1/restore"),
    );
    expect(restored?.body).toEqual({ version: 1 });
  });

  test("Restore shows the server's reasons on an enabled Model with errors, and 'Restore and disable' sends disable:true", async () => {
    const enabledDetail = {
      ...MODE_DETAIL,
      model: { ...MODE_DETAIL.model, state: "enabled" as const },
    };

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(enabledDetail);
      }
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      if (call.method === "POST" && call.url.endsWith("/revisions/1/restore")) {
        const body = call.body as { disable?: boolean };
        if (!body.disable) {
          return Response.json(
            {
              error:
                "has errors; restore and disable this Model to save it anyway",
              reasons: ["needs at least one attached Backend"],
            },
            { status: 400 },
          );
        }
        return Response.json({
          record: { ...enabledDetail.model, state: "disabled", version: 2 },
          modes: [],
          inputs: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    await openSection(view, "Revisions");

    await view.findByText("2 (current)");
    const restoreButtons = await view.findAllByText("Restore");
    // fireEvent, not userEvent: these buttons' own click handlers
    // synchronously disable/replace them (restoringRevision, then the
    // Restore-and-disable row), and userEvent's multi-step pointer
    // dispatch doesn't cope with its target changing mid-sequence.
    fireEvent.click(restoreButtons[1] as HTMLElement);

    expect(
      await view.findByText(
        "has errors; restore and disable this Model to save it anyway",
      ),
    ).toBeTruthy();

    const disableButton = await view.findByText("Restore and disable");
    fireEvent.click(disableButton);

    await waitFor(() => {
      const disabledCall = calls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/revisions/1/restore"),
      )[1];
      expect(disabledCall?.body).toEqual({ version: 1, disable: true });
    });
  });

  test("Restore stays disabled while another section is dirty (issue #71 CEO review)", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Revisions");
    await view.findByText("2 (current)");

    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("URL slug"), "x");

    await openSection(view, "Revisions");
    const restoreButtons = await view.findAllByText("Restore");
    expect((restoreButtons[1] as HTMLButtonElement).disabled).toBe(true);
  });
});
