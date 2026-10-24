// A DOM is registered only for this file's run (not a global preload),
// since bun test runs every file in one process and other files (the
// server's, and this workspace's other page tests) must keep their own
// fetch/Response and document untouched. It must be registered before
// @testing-library/react is imported, since that module binds its
// `screen` helper to `document.body` at import time — and since several
// page test files now share one process, this file never uses that
// global `screen` (it would still point at whichever file's document
// happened to import the module first): every query below is bound to
// this render's own result instead.
//
// That's not enough on its own: react-dom's scheduler is also cached
// once per process, bound to whichever happy-dom window was global when
// react-dom first loaded. Once an earlier file's `unregister()` closes
// that window, state updates in every later file's React tree stop
// flushing to the DOM. `bun test --isolate` (root package.json's `test`
// script, and CI) gives every test file its own fresh global object,
// which is what actually fixes that — this file's own register/unregister
// dance only keeps the server's test files free of happy-dom globals.
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { Link, RouterProvider, createMemoryRouter } = await import(
  "react-router-dom"
);
const { ModelEditorPage } = await import("./ModelEditorPage.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const DETAIL = {
  model: {
    id: "m1",
    name: "LTX 2.5",
    slug: "ltx-2-5",
    description: "",
    maxRunTimeMinutes: 30,
    state: "disabled" as const,
    currentRevision: 1,
    version: 1,
    termsBody: "",
    licenseUrl: "",
    attribution: "",
    termsVersion: null,
    termsVersionCreatedAt: null,
    termsRevision: 1,
  },
  workflowHash: "hash1",
  workflow: {
    "1": { class_type: "LoadImage", inputs: {} },
  },
  nodes: [{ id: "1", classType: "LoadImage", title: null }],
  outsideServiceNotes: [],
  modes: [],
};

const NO_BACKENDS = { backends: [] };

interface AttachedBackendEntry {
  backend: { id: string; name: string; baseUrl: string };
  reachable: boolean;
  missingNodeTypes: string[] | null;
  note: string | null;
}

interface FetchCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** `/api/admin/models/m1` gets the Model detail; every other GET (the Backends section's own two lookups) gets an empty list. */
function respondGet(url: string): Response {
  if (url.endsWith("/api/admin/models/m1")) return Response.json(DETAIL);
  return Response.json(NO_BACKENDS);
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      url: typeof input === "string" ? input : input.toString(),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

/** Mirrors AdminShell's own nav link, alongside the editor, so a blocked click can be exercised. */
function renderEditor() {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/models/:id",
        element: (
          <>
            <Link to="/admin/models">Models</Link>
            <ModelEditorPage />
          </>
        ),
      },
      { path: "/admin/models", element: <p>Models list</p> },
    ],
    { initialEntries: ["/admin/models/m1"] },
  );
  return render(<RouterProvider router={router} />);
}

let originalConfirm: typeof window.confirm;

beforeEach(() => {
  originalConfirm = window.confirm;
});

afterEach(() => {
  window.confirm = originalConfirm;
});

describe("ModelEditorPage", () => {
  test("a taken slug on save shows the server's own message, not the generic reload one", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT") {
        return Response.json(
          { error: "a Model with this slug already exists" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Save"));

    expect(
      await view.findByText("a Model with this slug already exists"),
    ).toBeTruthy();
    expect(view.queryByText("changed by someone else, reload")).toBeNull();
  });

  test("a stale version on save shows the reload message", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT") {
        return Response.json(
          { error: "changed by someone else, reload" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Save"));

    expect(
      await view.findByText("changed by someone else, reload"),
    ).toBeTruthy();
  });

  test("clicking a nav link while dirty asks first, and staying cancels the navigation", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method}`);
    });
    let confirmed = false;
    window.confirm = () => {
      confirmed = true;
      return false;
    };

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Models"));

    expect(confirmed).toBe(true);
    expect(view.queryByText("Models list")).toBeNull();
  });

  test("confirming the nav-link prompt navigates away", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method}`);
    });
    window.confirm = () => true;

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Models"));

    expect(await view.findByText("Models list")).toBeTruthy();
  });

  test("delete with unsaved Details changes confirms exactly once, not a second time for the navigation", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected ${call.method}`);
    });
    let confirmCount = 0;
    window.confirm = () => {
      confirmCount += 1;
      return true;
    };

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Delete"));

    expect(await view.findByText("Models list")).toBeTruthy();
    expect(confirmCount).toBe(1);
    await waitFor(() => {
      const del = calls.find((c) => c.method === "DELETE");
      expect(del?.url).toContain("version=1");
    });
  });

  test("delete shows the server's error on a stale version and stays put", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "DELETE")
        return Response.json(
          { error: "changed by someone else, reload" },
          { status: 409 },
        );
      throw new Error(`unexpected ${call.method}`);
    });
    window.confirm = () => true;

    const view = renderEditor();

    await view.findByText("LTX 2.5");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByText("Delete"));

    expect(
      await view.findByText("changed by someone else, reload"),
    ).toBeTruthy();
    expect(view.queryByText("Models list")).toBeNull();
  });

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

    expect(await view.findByText("GPU 1")).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByText("Detach"));

    expect(await view.findByText("No Backends attached.")).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  test("adds a Mode, picks an output node in the Workflow table, and saves it", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/modes")) {
        return Response.json({
          record: { ...DETAIL.model, currentRevision: 2, version: 2 },
          modes: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await userEvent.click(view.getByText("Add Mode"));
    await userEvent.type(view.getByLabelText("Mode name"), "Default");
    await userEvent.click(view.getByRole("button", { name: "Add" }));

    await userEvent.click(view.getByText("Save Modes"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/modes"),
    );
    expect(saved?.body).toEqual({
      version: 1,
      modes: [
        {
          name: "Default",
          description: "",
          outputNodeIds: ["1"],
          inputSettings: [],
        },
      ],
    });
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

    await userEvent.click(await view.findByText("Enable"));

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

  test("dims Workflow rows off the currently-picked Mode's Path", async () => {
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
          id: "mode-b",
          sortOrder: 0,
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

    await userEvent.click(
      await view.findByText("Pick output nodes in the Workflow below"),
    );

    const rowFor = (nodeId: string) =>
      view.getByText(nodeId, { selector: "td" }).closest("tr") as HTMLElement;

    // Off Mode B's Path (1, 2): dimmed. On its Path (3, 4): not dimmed.
    expect(rowFor("1").style.opacity).toBe("0.35");
    expect(rowFor("2").style.opacity).toBe("0.35");
    expect(rowFor("3").style.opacity).toBe("");
    expect(rowFor("4").style.opacity).toBe("");
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

    await view.findByDisplayValue("Mode 1");
    await userEvent.click(view.getByText("Duplicate Mode"));

    expect(view.getAllByDisplayValue("Mode 1 copy")).toHaveLength(1);
    const names = view
      .getAllByLabelText("Mode name")
      .map((el) => (el as HTMLInputElement).value);
    expect(names).toEqual(["Mode 1", "Mode 1 copy"]);
  });

  test("adds an Image upload Input bound to a loader's file field and saves it (issue #50)", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
      },
      inputs: [],
    };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/inputs")) {
        return Response.json({
          record: { ...DETAIL.model, currentRevision: 2, version: 2 },
          inputs: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await userEvent.selectOptions(
      view.getByLabelText("New Input kind"),
      "image_upload",
    );
    await userEvent.click(view.getByText("Add Input"));
    await userEvent.type(view.getByLabelText("Label"), "Photo");
    const maxSize = view.getByLabelText("Max size (MB)");
    await userEvent.clear(maxSize);
    await userEvent.type(maxSize, "10");
    await userEvent.type(
      view.getByLabelText("Max long side (px, optional)"),
      "2048",
    );
    await userEvent.click(view.getByRole("button", { name: "Add" }));
    await userEvent.click(view.getByText("Save Inputs"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/inputs"),
    );
    expect(saved?.body?.inputs).toEqual([
      {
        id: expect.any(String),
        kind: "image_upload",
        group: "describe",
        label: "Photo",
        help: "",
        maxSizeMb: 10,
        maxLongSide: 2048,
        bindings: [
          { nodeId: "1", field: "image", classType: "LoadImage", title: null },
        ],
      },
    ]);
  });

  test("adds a Points Input: picks its video Input, Width/Height fields and its own bound field, then saves it (issue #52)", async () => {
    const videoInput = {
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
          field: "video",
          classType: "VHS_LoadVideo",
          title: null,
        },
      ],
    };
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "VHS_LoadVideo", inputs: { video: "example.mp4" } },
        "2": {
          class_type: "EmptyLatentImage",
          inputs: { width: 512, height: 512 },
        },
        "3": { class_type: "PointsEditor", inputs: { points: "" } },
      },
      nodes: [
        { id: "1", classType: "VHS_LoadVideo", title: null },
        { id: "2", classType: "EmptyLatentImage", title: null },
        { id: "3", classType: "PointsEditor", title: null },
      ],
      inputs: [videoInput],
    };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/inputs")) {
        return Response.json({
          record: { ...DETAIL.model, currentRevision: 2, version: 2 },
          inputs: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await userEvent.selectOptions(
      view.getByLabelText("New Input kind"),
      "points",
    );
    await userEvent.click(view.getByText("Add Input"));
    const labelFields = view.getAllByLabelText("Label");
    await userEvent.type(
      labelFields[labelFields.length - 1] as HTMLElement,
      "Who to replace",
    );

    await userEvent.selectOptions(
      view.getByLabelText("Video Upload Input"),
      "video-input",
    );
    await userEvent.selectOptions(
      view.getByLabelText("Width field"),
      "2::width",
    );
    await userEvent.selectOptions(
      view.getByLabelText("Height field"),
      "2::height",
    );

    // `addInput` already opens field-picking for the newly added Input.
    const pointsRow = (await view.findByText("points")).closest(
      "tr",
    ) as HTMLElement;
    await userEvent.click(
      pointsRow.querySelector("button") as HTMLButtonElement,
    );

    await userEvent.click(view.getByText("Save Inputs"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/inputs"),
    );
    expect(saved?.body?.inputs).toEqual([
      videoInput,
      {
        id: expect.any(String),
        kind: "points",
        group: "describe",
        label: "Who to replace",
        help: "",
        videoInputId: "video-input",
        widthField: { nodeId: "2", field: "width" },
        heightField: { nodeId: "2", field: "height" },
        bindings: [
          {
            nodeId: "3",
            field: "points",
            classType: "PointsEditor",
            title: null,
          },
        ],
      },
    ]);
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

  test("Save Modes becomes 'Save and disable' and sends disable:true once checkModel has errors (issue #49 CEO review)", async () => {
    const detail = {
      ...DETAIL,
      model: { ...DETAIL.model, state: "enabled" as const },
      inputs: [],
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Default",
          description: "",
          outputNodes: [
            { nodeId: "1", classType: "LoadImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
      ],
    };
    // No attached Backend (respondGet's default NO_BACKENDS) means
    // checkModel flags "needs at least one attached Backend" once
    // object-info loads, so saving the enabled Model must disable it.
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/modes")) {
        return Response.json({
          record: { ...detail.model, state: "disabled", version: 2 },
          modes: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await userEvent.click(await view.findByText("Duplicate Mode"));

    // Both the Modes and Inputs sections read "Save and disable" once
    // checkModel has errors; only the Modes one is enabled here (Modes is
    // dirty, Inputs isn't).
    const saveButtons = await view.findAllByText("Save and disable");
    const saveButton = saveButtons.find(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    if (!saveButton) throw new Error("no enabled 'Save and disable' button");
    await userEvent.click(saveButton);

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/modes"),
    );
    expect(saved?.body?.disable).toBe(true);
  });

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

    const enableButton = (await view.findByText("Enable")) as HTMLButtonElement;
    await waitFor(() => expect(enableButton.disabled).toBe(true));
    await userEvent.click(enableButton);

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

  test("Replace Workflow and Restore stay disabled while another section is dirty (issue #71 CEO review)", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("2 (current)");
    await userEvent.type(view.getByLabelText("Slug"), "x");

    const restoreButtons = await view.findAllByText("Restore");
    expect((restoreButtons[1] as HTMLButtonElement).disabled).toBe(true);

    const file = new File(
      ['{"1":{"class_type":"LoadImage","inputs":{}}}'],
      "wf.json",
      { type: "application/json" },
    );
    await userEvent.upload(
      view.getByLabelText("Replace Workflow (API format JSON)"),
      file,
    );
    const replaceButton = await view.findByText("Replace Workflow");
    expect((replaceButton as HTMLButtonElement).disabled).toBe(true);
  });

  test("the rebind picker repoints a broken output node, and Replace Workflow sends it", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      if (call.method === "PUT" && call.url.endsWith("/workflow")) {
        return Response.json({
          record: { ...MODE_DETAIL.model, currentRevision: 2, version: 2 },
          modes: [],
          inputs: [],
          outsideServiceNotes: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("2 (current)");

    // Node "2" keeps its id but turns into a VHS_VideoCombine; node "3"
    // is a genuine SaveImage the rebind picker can repoint the Mode's
    // output node onto instead (CEO review: the VHS_VideoCombine bug).
    const file = new File(
      [
        JSON.stringify({
          "1": { class_type: "LoadImage", inputs: {} },
          "2": { class_type: "VHS_VideoCombine", inputs: { images: ["1", 0] } },
          "3": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
        }),
      ],
      "wf2.json",
      { type: "application/json" },
    );
    await userEvent.upload(
      view.getByLabelText("Replace Workflow (API format JSON)"),
      file,
    );

    expect(await view.findByText(/rebind it/)).toBeTruthy();

    await userEvent.selectOptions(view.getByLabelText('Rebind node "2"'), "3");
    await userEvent.click(view.getByText("Replace Workflow"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/workflow"),
    );
    expect(saved?.body?.rebind).toEqual([{ nodeId: "2", newNodeId: "3" }]);
  });
});
