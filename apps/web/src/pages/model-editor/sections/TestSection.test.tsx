import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { RenderResult } from "@testing-library/react";
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

// The #266 fixture's own trimmable Video Upload needs the same happy-dom
// stand-in for the media events a real browser fires for a picked file
// that WorkbenchPage.test.tsx's own trim tests register: happy-dom never
// fires a <video>/<audio> element's loadedmetadata or error event for a
// blob: URL, so `readMediaDuration` (chunkedUpload.ts) would hang forever
// reading the picked file's own duration and no upload would ever start.
// Firing `loadedmetadata` (as a real browser would for any file it can at
// least demux) resolves it with happy-dom's own duration (0, since it
// doesn't decode media), which the fixture's own limits tolerate. React
// sets a host element's `src` via `setAttribute`, not the property setter
// below, so the JSX-rendered `<video src=…>` (the Trimmer's own preview)
// gets the same hook too.
{
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "src",
  );
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    get() {
      return descriptor?.get?.call(this) ?? "";
    },
    set(value: string) {
      descriptor?.set?.call(this, value);
      fireMediaLoadEvent(this);
    },
  });
  const originalSetAttribute = HTMLMediaElement.prototype.setAttribute;
  HTMLMediaElement.prototype.setAttribute = function (name, value) {
    originalSetAttribute.call(this, name, value);
    if (name === "src") fireMediaLoadEvent(this);
  };
  function fireMediaLoadEvent(media: HTMLMediaElement) {
    queueMicrotask(() => {
      media.dispatchEvent(new Event("loadedmetadata"));
    });
  }
}

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

  describe("issue #266: the Test form's state lives at the page level", () => {
    const STEPS_INPUT_ID = "steps-input";
    const CLIP_INPUT_ID = "clip-input";
    const CLIP_UPLOAD_ID = "upload-clip";

    /** The #266 fixture's own form: a Number and a trimmable Video Upload, both bound to the Mode's own output node (the same shape the earlier tests' own Inputs use). */
    const FORM_DETAIL = {
      ...MODE_DETAIL,
      inputs: [
        {
          id: STEPS_INPUT_ID,
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
        {
          id: CLIP_INPUT_ID,
          kind: "video_upload",
          group: "describe",
          label: "Clip",
          help: "",
          maxSizeMb: 5,
          maxLongSide: null,
          minDurationMs: 0,
          maxDurationMs: 10_000,
          trimmable: true,
          bindings: [
            {
              nodeId: "2",
              field: "video",
              classType: "SaveImage",
              title: null,
            },
          ],
        },
      ],
    };

    /** The Revisions section's own list, so a leave-and-return lands on a rendered section (the section's own GET, issue #259's revisions list). */
    const REVISIONS = {
      revisions: [
        {
          revisionNumber: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          workflowHash: "hash1",
          modeCount: 1,
          inputCount: 2,
          author: null,
          changed: null,
        },
      ],
    };

    /** `mockBackendsAndTests` plus `detail`, the revisions list, and the clip's own upload/complete (a 2s duration, which is what brings out the Trimmer). */
    function mockFormServer(detail: unknown = FORM_DETAIL) {
      return mockBackendsAndTests((call) => {
        if (
          call.method === "GET" &&
          call.url.endsWith("/api/admin/models/m1")
        ) {
          return Response.json(detail);
        }
        if (call.method === "GET" && call.url.endsWith("/revisions")) {
          return Response.json(REVISIONS);
        }
        if (call.url === "/api/uploads") {
          return Response.json(
            {
              upload: { id: CLIP_UPLOAD_ID, chunkSize: 16 * 1024 * 1024 },
            },
            { status: 201 },
          );
        }
        if (call.url.startsWith(`/api/uploads/${CLIP_UPLOAD_ID}/chunk`)) {
          return Response.json({ offset: 4 });
        }
        if (call.url === `/api/uploads/${CLIP_UPLOAD_ID}/complete`) {
          return Response.json({
            upload: {
              id: CLIP_UPLOAD_ID,
              width: 640,
              height: 480,
              durationMs: 2000,
              browserPlayable: true,
            },
          });
        }
        return null;
      });
    }

    /** Fill the form the way a user would: type a value, pick the 2s clip, move the trim start to 0:00.5, and pick the Backend. Returns the `userEvent` for the caller's own further clicks. */
    async function fillForm(view: RenderResult) {
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      await userEvent.type(await view.findByLabelText("Steps"), "7");
      await userEvent.upload(
        await view.findByLabelText("Clip"),
        new File(["MP4!"], "clip.mp4", { type: "video/mp4" }),
      );
      await view.findByText("clip.mp4");
      const startHandle = await view.findByRole("slider", {
        name: "Trim start",
      });
      startHandle.focus();
      for (let i = 0; i < 5; i++) {
        await userEvent.keyboard("{ArrowRight}");
      }
      await userEvent.click(view.getByRole("combobox", { name: "Backend" }));
      await userEvent.click(view.getByRole("option", { name: "GPU 1" }));
      return userEvent;
    }

    test("a section leave-and-return keeps the form: its values, the Backend pick, the upload and the trim range", async () => {
      mockFormServer();

      const view = renderEditor();
      await openSection(view, "Test");
      await fillForm(view);

      // Leave the section for the Revisions, then come back.
      await openSection(view, "Revisions");
      expect(
        await view.findByRole("heading", { name: "Revisions" }),
      ).toBeTruthy();
      await openSection(view, "Test");

      // The page-level `useTestSection`'s own state, all intact: the typed
      // value, the Backend pick, the completed upload and the trim range.
      expect((view.getByLabelText("Steps") as HTMLInputElement).value).toBe(
        "7",
      );
      expect(
        view.getByRole("combobox", { name: "Backend" }).textContent,
      ).toContain("GPU 1");
      expect(view.queryByText("clip.mp4")).toBeTruthy();
      expect(
        view
          .getByRole("slider", { name: "Trim start" })
          .getAttribute("aria-valuenow"),
      ).toBe("0.5");
      expect(
        view
          .getByRole("slider", { name: "Trim end" })
          .getAttribute("aria-valuenow"),
      ).toBe("2");
    });

    test("picking a different Mode still resets the form: the values, the Backend pick and the upload are gone", async () => {
      mockFormServer({
        ...FORM_DETAIL,
        modes: [
          MODE_DETAIL.modes[0],
          { ...MODE_DETAIL.modes[0], id: "mode-2", name: "Alt" },
        ],
      });

      const view = renderEditor();
      await openSection(view, "Test");
      const userEvent = await fillForm(view);

      // A new Mode pick resets, the way the old per-Mode toggle did.
      await userEvent.click(view.getByRole("combobox", { name: "Mode" }));
      await userEvent.click(view.getByRole("option", { name: "Alt" }));
      expect(
        view.getByRole("combobox", { name: "Mode" }).textContent,
      ).toContain("Alt");

      expect((view.getByLabelText("Steps") as HTMLInputElement).value).toBe("");
      expect(
        view.getByRole("combobox", { name: "Backend" }).textContent,
      ).toContain("Any attached");
      expect(view.queryByText("clip.mp4")).toBeNull();
      expect(view.queryByRole("slider", { name: "Trim start" })).toBeNull();
    });

    /** The g1 test run the Cancel fixtures' own POST/SSE return, in the state asked for (the same shape the earlier "running test" test's own uses). */
    function generation(state: string) {
      const now = new Date().toISOString();
      return {
        id: "g1",
        modelId: "m1",
        modelSlug: "ltx-2-5",
        modelName: "LTX 2.5",
        modeId: "mode-1",
        modeName: "Default",
        submissionId: "sub1",
        state,
        tries: 0,
        error: null,
        submittedAt: now,
        startedAt: state === "queued" ? null : now,
        endedAt: null,
        assets: [],
        removedAt: null,
        isTest: true,
      };
    }

    test("a refused Cancel (a 409) shows the server's own error next to the panel, re-enables the Cancel button and leaves no unhandled rejection", async () => {
      mockBackendsAndTests((call) => {
        if (call.method === "POST" && call.url.endsWith("/m1/test")) {
          return Response.json(
            { generation: generation("queued") },
            { status: 201 },
          );
        }
        if (
          call.method === "POST" &&
          call.url.endsWith("/generations/g1/cancel")
        ) {
          return Response.json(
            { error: "This test has already finished." },
            { status: 409 },
          );
        }
        return null;
      });

      const view = renderEditor();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      await openSection(view, "Test");

      await userEvent.click(
        await view.findByRole("button", { name: /Run test Generation/ }),
      );
      // Both the inline result panel and "Last 5 tests" show this run's pill, hence the two matches.
      expect(await view.findAllByText("Queued")).toHaveLength(2);

      StreamSource.generationsStream().emit("change", generation("running"));
      expect(await view.findAllByText("Running…")).toHaveLength(2);

      // The repo's own e2e pattern for "no unhandled rejection" (scheduler.e2e.test.ts's own): a collector scoped to the claim.
      const unhandled: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandledRejection);
      try {
        await userEvent.click(view.getByRole("button", { name: "Cancel" }));

        // The 409's own `error`, shown next to the panel's own Cancel.
        const alert = await view.findByText("This test has already finished.");
        expect(alert.closest("[role='alert']")).toBeTruthy();

        // The `finally` (not the `catch`) re-enables the button, so a refusal
        // can't leave it stuck disabled.
        await waitFor(() => {
          expect(
            (view.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
              .disabled,
          ).toBe(false);
        });

        // Let any still-unhandled rejection surface before the verdict.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
      }
      expect(unhandled).toEqual([]);
    });

    test("a refused Cancel's alert is tied to its run: a later Run test (a new run) shows no stale alert", async () => {
      // Two queued runs with strictly increasing `submittedAt`, so the
      // second (g2) sorts to the front and becomes the panel's own run.
      const t1 = "2026-01-01T00:00:00.000Z";
      const t2 = "2026-01-01T00:00:01.000Z";
      const run = (id: string, submittedAt: string) => ({
        id,
        modelId: "m1",
        modelSlug: "ltx-2-5",
        modelName: "LTX 2.5",
        modeId: "mode-1",
        modeName: "Default",
        submissionId: "sub1",
        state: "queued",
        tries: 0,
        error: null,
        submittedAt,
        startedAt: null,
        endedAt: null,
        assets: [],
        removedAt: null,
        isTest: true,
      });

      const testPosts: unknown[] = [];
      mockBackendsAndTests((call) => {
        if (call.method === "POST" && call.url.endsWith("/m1/test")) {
          testPosts.push(call);
          // The first Run returns g1; a later Run returns g2 (a later run).
          return Response.json(
            {
              generation:
                testPosts.length === 1 ? run("g1", t1) : run("g2", t2),
            },
            { status: 201 },
          );
        }
        if (
          call.method === "POST" &&
          call.url.endsWith("/generations/g1/cancel")
        ) {
          return Response.json(
            { error: "This test has already finished." },
            { status: 409 },
          );
        }
        return null;
      });

      const view = renderEditor();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      await openSection(view, "Test");

      // First run: g1 (queued). Both the inline result panel and "Last 5
      // tests" show its pill, hence the two matches.
      await userEvent.click(
        await view.findByRole("button", { name: /Run test Generation/ }),
      );
      expect(await view.findAllByText("Queued")).toHaveLength(2);

      // g1 is unfinished, so Cancel shows. Its refused 409 shows the
      // server's own error next to the panel.
      await userEvent.click(view.getByRole("button", { name: "Cancel" }));
      const alert = await view.findByText("This test has already finished.");
      expect(alert.closest("[role='alert']")).toBeTruthy();

      // A later Run test returns g2 (a later run). The panel now shows
      // g2, and the stale g1 alert must not follow it: it's tied to g1,
      // not to the latest run. The inline panel shows only g2 and "Last
      // 5 tests" shows both, hence the three matches; the alert is gone.
      await userEvent.click(
        view.getByRole("button", { name: /Run test Generation/ }),
      );
      await waitFor(() => {
        expect(view.getAllByText("Queued")).toHaveLength(3);
        expect(view.queryByText("This test has already finished.")).toBeNull();
      });
    });
  });
});
