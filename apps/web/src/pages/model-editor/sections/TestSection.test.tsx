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
  FakeEventSource,
  NO_BACKENDS,
  cleanup,
  finishFile,
  mockFetch,
  openSection,
  prepareConfirmAndEventSource,
  renderEditor,
  restoreConfirm,
  waitFor,
} from "../testing/harness.js";

/** The Test section's own SSE stream (issue #259): a `FakeEventSource` that remembers its instance, so a test can `emit` a "change"/"progress" on it after the form submits. Mirrors GalleryPage.test.tsx's own. */
class StreamSource extends FakeEventSource {
  static instances: StreamSource[] = [];
  constructor(url: string) {
    super(url);
    StreamSource.instances.push(this);
  }
  static generationsStream(): StreamSource {
    const source = StreamSource.instances.find((instance) =>
      instance.url.includes("/api/generations/stream"),
    );
    if (!source) throw new Error("no Generations EventSource yet");
    return source;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data) });
    }
  }
}

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await finishFile();
});

beforeEach(() => {
  prepareConfirmAndEventSource();
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    StreamSource;
  StreamSource.instances = [];
});

afterEach(() => {
  restoreConfirm();
});

/** A Model with one Mode whose Path is the SaveImage node (issue #259). */
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

const BACKEND_A = { id: "b1", name: "GPU 1", baseUrl: "http://gpu1" };
const BACKEND_B = { id: "b2", name: "GPU 2", baseUrl: "http://gpu2" };
const BACKEND_C = { id: "b3", name: "GPU 3", baseUrl: "http://gpu3" };

/**
 * All three attached and reachable; A can run the Mode (has every node
 * type on its Path) and is enabled; B can't (missing SaveImage); C can
 * (has every node type) but is disabled, so it must be excluded too
 * (CEO fix #2 on #261: `eligibleBackends` ignored `enabled`).
 */
function mockBackendsAndTests(
  extra?: (call: {
    method: string;
    url: string;
    body: Record<string, unknown> | null;
  }) => Response | null,
) {
  return mockFetch((call) => {
    if (extra) {
      const res = extra(call);
      if (res) return res;
    }
    if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
      return Response.json(MODE_DETAIL);
    }
    if (
      call.method === "GET" &&
      call.url.endsWith("/api/admin/models/m1/backends")
    ) {
      return Response.json({
        backends: [
          {
            backend: BACKEND_A,
            reachable: true,
            missingNodeTypes: [],
            note: null,
          },
          {
            backend: BACKEND_B,
            reachable: true,
            missingNodeTypes: ["SaveImage"],
            note: null,
          },
          {
            backend: BACKEND_C,
            reachable: true,
            missingNodeTypes: [],
            note: null,
          },
        ],
      });
    }
    if (call.method === "GET" && call.url.endsWith("/api/admin/backends")) {
      return Response.json({ backends: [BACKEND_A, BACKEND_B, BACKEND_C] });
    }
    if (call.method === "GET" && call.url.endsWith("/object-info")) {
      return Response.json({
        backends: [
          {
            id: "b1",
            name: "GPU 1",
            enabled: true,
            reachable: true,
            nodeTypes: ["LoadImage", "SaveImage"],
            fieldSpecs: {},
          },
          {
            id: "b2",
            name: "GPU 2",
            enabled: true,
            reachable: true,
            nodeTypes: ["LoadImage"],
            fieldSpecs: {},
          },
          {
            id: "b3",
            name: "GPU 3",
            enabled: false,
            reachable: true,
            nodeTypes: ["LoadImage", "SaveImage"],
            fieldSpecs: {},
          },
        ],
      });
    }
    if (
      call.method === "GET" &&
      call.url.endsWith("/api/admin/models/m1/tests")
    ) {
      return Response.json({ tests: [] });
    }
    if (call.method === "GET") return Response.json(NO_BACKENDS);
    throw new Error(`unexpected ${call.method} ${call.url}`);
  });
}

describe("TestSection", () => {
  test("Test Backend select lists only attached enabled Backends that can run the Mode", async () => {
    mockBackendsAndTests();

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Test");

    await userEvent.click(view.getByRole("combobox", { name: "Backend" }));
    expect(view.getByRole("option", { name: "Any attached" })).toBeTruthy();
    expect(view.getByRole("option", { name: "GPU 1" })).toBeTruthy();
    expect(view.queryByRole("option", { name: "GPU 2" })).toBeNull();
    expect(view.queryByRole("option", { name: "GPU 3" })).toBeNull();
  });

  test("Run test Generation is blocked by the Mode's errors", async () => {
    // A Mode whose own output node id ("9") no longer exists in the
    // Workflow is a `checkModel` error (issue #259's "<Mode> has N
    // error(s) to fix first.").
    const brokenDetail = {
      ...MODE_DETAIL,
      modes: [
        {
          ...MODE_DETAIL.modes[0],
          outputNodes: [
            { nodeId: "9", classType: "Bogus", title: null, kind: null },
          ],
        },
      ],
    };

    mockBackendsAndTests((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(brokenDetail);
      }
      return null;
    });

    const view = renderEditor();
    await openSection(view, "Test");

    const runButton = await view.findByRole("button", {
      name: /Run test Generation/,
    });
    expect((runButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      await view.findByText(/has \d+ error\(s\) to fix first\./),
    ).toBeTruthy();
  });

  test("a running test shows progress and Cancel, then plays its Asset", async () => {
    const calls = mockBackendsAndTests((call) => {
      if (call.method === "POST" && call.url.endsWith("/m1/test")) {
        return Response.json(
          {
            generation: {
              id: "g1",
              modelId: "m1",
              modelSlug: "ltx-2-5",
              modelName: "LTX 2.5",
              modeId: "mode-1",
              modeName: "Default",
              submissionId: "sub1",
              state: "queued",
              tries: 0,
              error: null,
              submittedAt: new Date().toISOString(),
              startedAt: null,
              endedAt: null,
              assets: [],
              removedAt: null,
              isTest: true,
            },
            prompt: null,
          },
          { status: 201 },
        );
      }
      if (
        call.method === "POST" &&
        call.url.endsWith("/generations/g1/cancel")
      ) {
        return new Response(null, { status: 204 });
      }
      return null;
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Test");

    const runButton = await view.findByRole("button", {
      name: /Run test Generation/,
    });
    await userEvent.click(runButton);

    expect(
      calls.some((c) => c.method === "POST" && c.url.endsWith("/m1/test")),
    ).toBe(true);
    // Both the inline result panel and "Last 5 tests" show this run's
    // pill, hence the two matches.
    expect(await view.findAllByText("Queued")).toHaveLength(2);

    const source = StreamSource.generationsStream();
    source.emit("change", {
      id: "g1",
      modelId: "m1",
      modelSlug: "ltx-2-5",
      modelName: "LTX 2.5",
      modeId: "mode-1",
      modeName: "Default",
      submissionId: "sub1",
      state: "running",
      tries: 0,
      error: null,
      submittedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      assets: [],
      removedAt: null,
      isTest: true,
    });

    expect(await view.findAllByText("Running…")).toHaveLength(2);
    const cancelButton = view.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeTruthy();

    await userEvent.click(cancelButton);
    expect(
      calls.some(
        (c) => c.method === "POST" && c.url.endsWith("/generations/g1/cancel"),
      ),
    ).toBe(true);

    source.emit("change", {
      id: "g1",
      modelId: "m1",
      modelSlug: "ltx-2-5",
      modelName: "LTX 2.5",
      modeId: "mode-1",
      modeName: "Default",
      submissionId: "sub1",
      state: "succeeded",
      tries: 0,
      error: null,
      submittedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      assets: [
        {
          id: "a1",
          nodeId: "2",
          sortOrder: 0,
          kind: "image",
          contentType: "image/png",
          size: 1000,
          width: 512,
          height: 512,
          durationMs: null,
        },
      ],
      removedAt: null,
      isTest: true,
    });

    expect(await view.findAllByText("Done")).toHaveLength(2);
    const img = document.querySelector("img[src='/api/assets/a1']");
    expect(img).toBeTruthy();
    expect(view.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("Test runs the unsaved draft Mode, and a failure shows the server's reasons (issue #74)", async () => {
    const calls = mockBackendsAndTests((call) => {
      if (call.method === "POST" && call.url.endsWith("/m1/test")) {
        return Response.json(
          {
            error: "mode_has_errors",
            reasons: ["needs at least one attached Backend"],
          },
          { status: 400 },
        );
      }
      return null;
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Test");

    const runButton = await view.findByRole("button", {
      name: /Run test Generation/,
    });
    await userEvent.click(runButton);

    const sent = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/m1/test"),
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
      ...MODE_DETAIL,
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
              nodeId: "2",
              field: "steps",
              classType: "SaveImage",
              title: null,
            },
          ],
        },
      ],
    };

    const calls = mockBackendsAndTests((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_NUMBER);
      }
      if (call.method === "POST" && call.url.endsWith("/m1/test")) {
        return Response.json(
          {
            generation: {
              id: "g1",
              modelId: "m1",
              modelSlug: "ltx-2-5",
              modelName: "LTX 2.5",
              modeId: "mode-1",
              modeName: "Default",
              submissionId: "sub1",
              state: "queued",
              tries: 0,
              error: null,
              submittedAt: new Date().toISOString(),
              startedAt: null,
              endedAt: null,
              assets: [],
              removedAt: null,
              isTest: true,
            },
          },
          { status: 201 },
        );
      }
      return null;
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Test");

    await userEvent.type(await view.findByLabelText("Steps"), "7");
    await userEvent.click(
      view.getByRole("button", { name: /Run test Generation/ }),
    );

    const sent = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/m1/test"),
    );
    expect(sent?.body?.values).toEqual({ "steps-input": 7 });
  });

  test("an Image Upload Input can be tested: pick, upload, Run test sends its Upload id (issue #74 CEO review)", async () => {
    const UPLOAD_INPUT_ID = "img-input";
    const UPLOAD_ID = "upload-1";
    const DETAIL_UPLOAD = {
      ...MODE_DETAIL,
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
              nodeId: "2",
              field: "image",
              classType: "SaveImage",
              title: null,
            },
          ],
        },
      ],
    };

    const posts: { method: string; url: string; body: unknown }[] = [];
    const calls = mockBackendsAndTests((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_UPLOAD);
      }
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
      if (call.method === "POST" && call.url.endsWith("/m1/test")) {
        posts.push(call);
        return Response.json(
          {
            generation: {
              id: "g1",
              modelId: "m1",
              modelSlug: "ltx-2-5",
              modelName: "LTX 2.5",
              modeId: "mode-1",
              modeName: "Default",
              submissionId: "sub1",
              state: "queued",
              tries: 0,
              error: null,
              submittedAt: new Date().toISOString(),
              startedAt: null,
              endedAt: null,
              assets: [],
              removedAt: null,
              isTest: true,
            },
          },
          { status: 201 },
        );
      }
      return null;
    });
    void calls;

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Test");

    await userEvent.upload(
      await view.findByLabelText("Start frame"),
      new File(["PNG!"], "frame.png", { type: "image/png" }),
    );
    await view.findByText("frame.png");

    await userEvent.click(
      view.getByRole("button", { name: /Run test Generation/ }),
    );

    expect(posts).toHaveLength(1);
    expect(
      (posts[0]?.body as { values?: Record<string, string> })?.values,
    ).toEqual({ [UPLOAD_INPUT_ID]: UPLOAD_ID });
  });

  test('the Backend select sends backendId null for "Any attached" and the picked Backend\'s id when one is chosen', async () => {
    const calls = mockBackendsAndTests((call) => {
      if (call.method === "POST" && call.url.endsWith("/m1/test")) {
        return Response.json(
          {
            generation: {
              id: "g1",
              modelId: "m1",
              modelSlug: "ltx-2-5",
              modelName: "LTX 2.5",
              modeId: "mode-1",
              modeName: "Default",
              submissionId: "sub1",
              state: "queued",
              tries: 0,
              error: null,
              submittedAt: new Date().toISOString(),
              startedAt: null,
              endedAt: null,
              assets: [],
              removedAt: null,
              isTest: true,
            },
          },
          { status: 201 },
        );
      }
      return null;
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Test");

    await userEvent.click(
      view.getByRole("button", { name: /Run test Generation/ }),
    );
    await waitFor(() => {
      const sent = calls.find(
        (c) => c.method === "POST" && c.url.endsWith("/m1/test"),
      );
      expect(sent?.body).toMatchObject({ backendId: null });
    });

    await userEvent.click(view.getByRole("combobox", { name: "Backend" }));
    await userEvent.click(view.getByRole("option", { name: "GPU 1" }));
    await userEvent.click(
      view.getByRole("button", { name: /Run test Generation/ }),
    );

    await waitFor(() => {
      const sent = calls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/m1/test"),
      )[1];
      expect(sent?.body).toMatchObject({ backendId: "b1" });
    });
  });
});
