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
  restoreConfirm,
} from "../testing/harness.js";

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

/** A Model with one Mode whose Path is both Workflow nodes (issue #217). */
const MODE_DETAIL = {
  ...DETAIL,
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

describe("BackendsSection", () => {
  test("Backend rows show health, version and Runs all N Modes", async () => {
    const BACKEND = { id: "b1", name: "GPU 1", baseUrl: "http://gpu1" };
    const attached = {
      backends: [
        { backend: BACKEND, reachable: true, missingNodeTypes: [], note: null },
      ],
    };
    const allBackends = {
      backends: [
        {
          ...BACKEND,
          enabled: true,
          health: {
            reachability: "reachable",
            comfyuiVersion: "1.2.3",
            credentialsError: false,
          },
        },
      ],
    };
    const objectInfo = {
      backends: [
        {
          id: "b1",
          name: "GPU 1",
          enabled: true,
          reachable: true,
          nodeTypes: ["LoadImage", "SaveImage"],
          fieldSpecs: {},
        },
      ],
    };
    mockFetch((call) => {
      if (call.method !== "GET") throw new Error(`unexpected ${call.method}`);
      if (call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(MODE_DETAIL);
      }
      if (call.url.endsWith("/object-info")) return Response.json(objectInfo);
      if (call.url.endsWith("/api/admin/models/m1/backends")) {
        return Response.json(attached);
      }
      if (call.url.endsWith("/api/admin/backends")) {
        return Response.json(allBackends);
      }
      return Response.json({ backends: [] });
    });

    const view = renderEditor();
    await openSection(view, "Backends");

    expect(await view.findByText("GPU 1")).toBeTruthy();
    expect(await view.findByText("Healthy")).toBeTruthy();
    expect(await view.findByText("ComfyUI 1.2.3")).toBeTruthy();
    expect(await view.findByText("Runs all 1 Mode")).toBeTruthy();
  });

  test("an unreachable Backend shows the warning", async () => {
    const BACKEND = { id: "b1", name: "GPU 1", baseUrl: "http://gpu1" };
    const attached = {
      backends: [
        {
          backend: BACKEND,
          reachable: false,
          missingNodeTypes: null,
          note: "unreachable; can't check for missing node types",
        },
      ],
    };
    const objectInfo = {
      backends: [
        {
          id: "b1",
          name: "GPU 1",
          enabled: true,
          reachable: false,
          nodeTypes: [],
          fieldSpecs: {},
        },
      ],
    };
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(MODE_DETAIL);
      }
      if (call.url.endsWith("/object-info")) return Response.json(objectInfo);
      if (call.url.endsWith("/api/admin/models/m1/backends")) {
        return Response.json(attached);
      }
      return Response.json({ backends: [] });
    });

    const view = renderEditor();
    await openSection(view, "Backends");

    expect(
      await view.findByText("Unreachable: its nodes can't be checked."),
    ).toBeTruthy();
  });

  test("Other Backends can be attached", async () => {
    const BACKEND_B = { id: "b2", name: "GPU 2", baseUrl: "http://gpu2" };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(MODE_DETAIL);
      }
      if (
        call.method === "GET" &&
        call.url.endsWith("/api/admin/models/m1/backends")
      ) {
        return Response.json({ backends: [] });
      }
      if (call.method === "GET" && call.url.endsWith("/api/admin/backends")) {
        return Response.json({
          backends: [
            {
              ...BACKEND_B,
              enabled: true,
              health: {
                reachability: "unknown",
                comfyuiVersion: null,
                credentialsError: false,
              },
            },
          ],
        });
      }
      if (call.method === "GET") return Response.json({ backends: [] });
      if (call.method === "POST" && call.url.includes("/backends")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    await openSection(view, "Backends");

    expect(
      await view.findByText("No Backends yet. Attach one below."),
    ).toBeTruthy();
    expect(await view.findByText("GPU 2")).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByRole("button", { name: "Attach" }));

    expect(
      calls.some((c) => c.method === "POST" && c.body?.backendId === "b2"),
    ).toBe(true);
  });

  test("detaching the only Backend empties the Backends section", async () => {
    const BACKEND = { id: "b1", name: "GPU 1", baseUrl: "http://gpu1" };
    let attached = [
      { backend: BACKEND, reachable: true, missingNodeTypes: [], note: null },
    ];

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(MODE_DETAIL);
      }
      if (
        call.method === "GET" &&
        call.url.endsWith("/api/admin/models/m1/backends")
      ) {
        return Response.json({ backends: attached });
      }
      if (call.method === "GET") return Response.json({ backends: [] });
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

    expect(
      await view.findByText("No Backends yet. Attach one below."),
    ).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });
});
