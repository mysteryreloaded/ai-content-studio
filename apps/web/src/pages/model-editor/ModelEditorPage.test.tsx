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
  type FetchCall,
  NO_BACKENDS,
  cleanup,
  findModeTestToggle,
  finishFile,
  fireEvent,
  mockFetch,
  openSection,
  pickOutputNodeInWorkflow,
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

  test("adds a Mode, picks an output node in the Workflow table, and saves it", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json(DETAIL);
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await view.findByText("LTX 2.5");
    await userEvent.click(view.getByText("Add Mode"));
    await userEvent.type(view.getByLabelText("Mode name"), "Default");

    // Picking the output node lives in the Workflow section's node
    // inspector now (issue #214): pick the Mode in the Mode picker,
    // select the output-class node, then "Use as an output of ...".
    await pickOutputNodeInWorkflow(view, "Default", "2");
    await openSection(view, "Modes");

    await userEvent.click(view.getByText("Save"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/draft"),
    );
    const body = saved?.body as { modes?: unknown } | null;
    expect(body?.modes).toEqual([
      {
        name: "Default",
        description: "",
        outputNodeIds: ["2"],
        inputSettings: [],
      },
    ]);
  });

  test("Test runs the unsaved draft Mode, and a failure shows the server's reasons (issue #74)", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "POST" && call.url.endsWith("/test")) {
        return Response.json(
          {
            error: "mode_has_errors",
            reasons: ["needs at least one attached Backend"],
          },
          { status: 400 },
        );
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await view.findByText("LTX 2.5");
    await userEvent.click(view.getByText("Add Mode"));
    await userEvent.type(view.getByLabelText("Mode name"), "Default");

    await pickOutputNodeInWorkflow(view, "Default", "2");
    await openSection(view, "Modes");

    await userEvent.click(await findModeTestToggle(view));
    await userEvent.click(view.getByText("Run test"));

    const sent = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/test"),
    );
    expect(sent?.body).toEqual({
      mode: {
        name: "Default",
        description: "",
        outputNodeIds: ["2"],
        inputSettings: [],
      },
      inputs: [],
      values: {},
      backendId: null,
    });
    expect(
      await view.findByText("needs at least one attached Backend"),
    ).toBeTruthy();
  });

  test("typing into a Number Input sends a number in the Test POST body, not the typed string (CEO review round 2)", async () => {
    const DETAIL_NUMBER = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "1", classType: "LoadImage", title: null, kind: null },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: "steps-input",
          kind: "number",
          group: "describe",
          label: "Steps",
          help: "",
          numberMode: "integer",
          min: 1,
          max: 100,
          step: 1,
          default: null,
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_NUMBER);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      if (call.method === "POST" && call.url.endsWith("/test")) {
        return Response.json({
          generation: {
            id: "g1",
            submissionId: "s1",
            modeId: "mode-1",
            modeName: "Mode 1",
            state: "queued",
            error: null,
            submittedAt: new Date().toISOString(),
            isTest: true,
            assets: [],
          },
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await userEvent.click(await findModeTestToggle(view));
    await userEvent.type(view.getByLabelText("Steps"), "5");
    await userEvent.click(view.getByText("Run test"));

    const sent = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/test"),
    );
    expect(sent?.body?.values).toEqual({ "steps-input": 5 });
  });

  test("an Image Upload Input can be tested: pick, upload, Run test sends its Upload id (issue #74 CEO review)", async () => {
    const UPLOAD_INPUT_ID = "img-input";
    const UPLOAD_ID = "upload-1";
    const DETAIL_UPLOAD = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "1", classType: "LoadImage", title: null, kind: null },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: UPLOAD_INPUT_ID,
          kind: "image_upload",
          group: "describe",
          label: "Start frame",
          help: "",
          maxSizeMb: 5,
          maxLongSide: null,
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    const posts: FetchCall[] = [];
    mockFetch(async (call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_UPLOAD);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      if (call.url === "/api/uploads") {
        return Response.json(
          { upload: { id: UPLOAD_ID, chunkSize: 16 * 1024 * 1024 } },
          { status: 201 },
        );
      }
      if (call.url.startsWith(`/api/uploads/${UPLOAD_ID}/chunk`)) {
        return Response.json({ offset: 4 });
      }
      if (call.url === `/api/uploads/${UPLOAD_ID}/complete`) {
        return Response.json({
          upload: {
            id: UPLOAD_ID,
            width: 10,
            height: 10,
            durationMs: null,
            browserPlayable: null,
          },
        });
      }
      if (call.method === "POST" && call.url.endsWith("/test")) {
        posts.push(call);
        return Response.json({
          generation: {
            id: "g1",
            submissionId: "s1",
            modeId: "mode-1",
            modeName: "Mode 1",
            state: "queued",
            error: null,
            submittedAt: new Date().toISOString(),
            isTest: true,
            assets: [],
          },
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await userEvent.click(await findModeTestToggle(view));
    expect(await view.findByText("Your files")).toBeTruthy();
    await userEvent.upload(
      view.getByLabelText("Start frame"),
      new File(["PNG!"], "frame.png", { type: "image/png" }),
    );
    await view.findByText("frame.png");

    await userEvent.click(view.getByText("Run test"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body?.values).toEqual({ [UPLOAD_INPUT_ID]: UPLOAD_ID });
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

  test("Remove on one Mode's output node doesn't affect another Mode being picked", async () => {
    const DETAIL_TWO_MODES = {
      model: DETAIL.model,
      workflowHash: "hash1",
      workflow: {
        "1": { class_type: "LoadImage", inputs: {} },
        "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
        "3": { class_type: "SaveImage", inputs: { image: ["4", 0] } },
        "4": { class_type: "LoadImage", inputs: {} },
      },
      nodes: [
        { id: "1", classType: "LoadImage", title: null },
        { id: "2", classType: "SaveImage", title: null },
        { id: "3", classType: "SaveImage", title: null },
        { id: "4", classType: "LoadImage", title: null },
      ],
      outsideServiceNotes: [],
      modes: [
        {
          id: "mode-a",
          sortOrder: 0,
          name: "Mode A",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
        },
        {
          id: "mode-b",
          sortOrder: 1,
          name: "Mode B",
          description: "",
          outputNodes: [
            { nodeId: "3", classType: "SaveImage", title: null, kind: "image" },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_TWO_MODES);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    const { within } = await import("@testing-library/react");
    await openSection(view, "Modes");

    const modeAInput = await view.findByDisplayValue("Mode A");
    const modeAFieldset = modeAInput.closest("fieldset") as HTMLElement;
    const modeBInput = view.getByDisplayValue("Mode B");
    const modeBFieldset = modeBInput.closest("fieldset") as HTMLElement;

    // Start picking output nodes for Mode B, then remove Mode A's own node.
    await userEvent.click(
      within(modeBFieldset).getByText(
        "Pick output nodes in the Workflow below",
      ),
    );
    await userEvent.click(within(modeAFieldset).getByText("Remove"));

    expect(modeAFieldset.querySelector("ol")?.textContent).not.toContain("2");
    expect(modeBFieldset.querySelector("ol")?.textContent).toContain("3");
  });

  test("the Mode × Input grid keeps both of a visible switch's branches on the Path (issue #48)", async () => {
    const STRENGTH_ID = "44444444-4444-4444-4444-444444444444";
    const FLAG_ID = "55555555-5555-5555-5555-555555555555";
    const DETAIL_SWITCH = {
      model: DETAIL.model,
      workflowHash: "hash1",
      workflow: {
        prim: { class_type: "PrimitiveBoolean", inputs: { value: true } },
        switch: {
          class_type: "ComfySwitchNode",
          inputs: {
            switch: ["prim", 0],
            on_true: ["a", 0],
            on_false: ["b", 0],
          },
        },
        a: { class_type: "LoadImage", inputs: {} },
        b: { class_type: "LoadImage", inputs: { strength: 1 } },
        out: { class_type: "SaveImage", inputs: { image: ["switch", 0] } },
      },
      nodes: [
        { id: "prim", classType: "PrimitiveBoolean", title: null },
        { id: "switch", classType: "ComfySwitchNode", title: null },
        { id: "a", classType: "LoadImage", title: null },
        { id: "b", classType: "LoadImage", title: null },
        { id: "out", classType: "SaveImage", title: null },
      ],
      outsideServiceNotes: [],
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            {
              nodeId: "out",
              classType: "SaveImage",
              title: null,
              kind: "image",
            },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: FLAG_ID,
          kind: "select",
          group: "settings",
          label: "Flag",
          help: "",
          default: null,
          options: [
            { id: "off", label: "Off", values: [false] },
            { id: "on", label: "On", values: [true] },
          ],
          bindings: [
            {
              nodeId: "prim",
              field: "value",
              classType: "PrimitiveBoolean",
              title: null,
            },
          ],
        },
        {
          id: STRENGTH_ID,
          kind: "number",
          group: "settings",
          label: "Strength",
          help: "",
          default: null,
          numberMode: "integer",
          min: 0,
          max: 10,
          step: 1,
          bindings: [
            {
              nodeId: "b",
              field: "strength",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_SWITCH);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();

    const row = (await view.findByText("Strength", { selector: "th" })).closest(
      "tr",
    ) as HTMLElement;
    const cell = row.querySelector("td") as HTMLElement;
    // "strength" sits on the "on_false" branch, only reachable because
    // the switch is steered by a field no visible Input hides: both
    // branches stay on the Path, so this cell isn't dimmed.
    expect(cell.style.opacity).toBe("");
  });

  test("the Mode x Input grid's State select never offers 'fixed' for a Video or Audio Upload Input (issue #51: always a real Upload id)", async () => {
    const DETAIL_UPLOADS = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "1", classType: "LoadImage", title: null, kind: null },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: "video-input",
          kind: "video_upload",
          group: "describe",
          label: "Clip",
          help: "",
          maxSizeMb: 50,
          maxLongSide: null,
          minDurationMs: 0,
          maxDurationMs: 10_000,
          trimmable: true,
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
        {
          id: "audio-input",
          kind: "audio_upload",
          group: "describe",
          label: "Narration",
          help: "",
          maxSizeMb: 20,
          minDurationMs: 0,
          maxDurationMs: 10_000,
          trimmable: true,
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_UPLOADS);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();

    for (const label of ["Clip", "Narration"]) {
      const row = (await view.findByText(label, { selector: "th" })).closest(
        "tr",
      ) as HTMLElement;
      const select = row.querySelector("select") as HTMLSelectElement;
      const options = [...select.options].map((o) => o.value);
      expect(options).not.toContain("fixed");
      expect(options).toContain("optional");
    }
  });

  test("Duplicate Mode adds a copy right after the original, named '… copy'", async () => {
    const DETAIL_ONE_MODE = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "1", classType: "LoadImage", title: null, kind: null },
          ],
          inputSettings: [],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_ONE_MODE);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await view.findByDisplayValue("Mode 1");
    await userEvent.click(view.getByText("Duplicate Mode"));

    expect(view.getAllByDisplayValue("Mode 1 copy")).toHaveLength(1);
    const names = view
      .getAllByLabelText("Mode name")
      .map((el) => (el as HTMLInputElement).value);
    expect(names).toEqual(["Mode 1", "Mode 1 copy"]);
  });

  test("the Mode x Input grid's State select never offers 'fixed' for a Points Input (issue #52)", async () => {
    const DETAIL_POINTS = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "1", classType: "LoadImage", title: null, kind: null },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: "points-input",
          kind: "points",
          group: "describe",
          label: "Who to replace",
          help: "",
          videoInputId: "video-input",
          widthField: { nodeId: "1", field: "width" },
          heightField: { nodeId: "1", field: "height" },
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_POINTS);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();

    const row = (
      await view.findByText("Who to replace", { selector: "th" })
    ).closest("tr") as HTMLElement;
    const select = row.querySelector("select") as HTMLSelectElement;
    const options = [...select.options].map((o) => o.value);
    expect(options).not.toContain("fixed");
    expect(options).toContain("optional");
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
