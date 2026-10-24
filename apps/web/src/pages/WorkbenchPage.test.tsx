// See ModelEditorPage.test.tsx's header comment: this file registers its
// own happy-dom instance (bun test --isolate gives it a clean process).
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
const { WorkbenchPage } = await import("./WorkbenchPage.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const SIGNED_IN_USER = {
  id: "u1",
  email: "user@example.com",
  name: "A User",
  picture: null,
  role: "user" as const,
  status: "active" as const,
  termsAcceptedVersion: null,
};

const MODEL = {
  id: "m1",
  slug: "ltx",
  name: "LTX 2.5",
  description: "Video generation",
  revision: 2,
  modes: [{ id: "mode1", name: "Default", description: "", inputs: [] }],
};

/** Like `MODEL`, but its Mode holds a bound Seed Input (issue #47's count picker AC). */
const MODEL_WITH_SEED = {
  ...MODEL,
  modes: [
    {
      id: "mode1",
      name: "Default",
      description: "",
      inputs: [
        {
          id: "seed1",
          group: "settings",
          label: "Seed",
          help: "",
          placeholder: null,
          kind: "seed",
          max: 1000,
        },
      ],
    },
  ],
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data) });
    }
  }
}

interface FetchCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) return Response.json(SIGNED_IN_USER);
    const call: FetchCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    return handler(call);
  }) as typeof fetch;
}

function renderWorkbench() {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];

  const router = createMemoryRouter(
    [{ path: "/models/:slug", element: <WorkbenchPage /> }],
    { initialEntries: ["/models/ltx"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("WorkbenchPage", () => {
  test("shows the Model's name, description, Mode heading and this Model's Submissions", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx")) {
        return Response.json({ model: MODEL });
      }
      if (call.url.endsWith("/api/models/ltx/generations")) {
        return Response.json({
          submissions: [
            {
              submissionId: "s1",
              modeId: "mode1",
              modeName: "Default",
              submittedAt: "2026-01-01T00:00:00.000Z",
              generations: [],
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();

    expect(await view.findByRole("heading", { name: "LTX 2.5" })).toBeTruthy();
    expect(view.getByText("Video generation")).toBeTruthy();
    expect(await view.findByRole("heading", { name: "Default" })).toBeTruthy();
    expect(
      await view.findByText("Default", { selector: "strong" }),
    ).toBeTruthy();
    expect(view.getByRole("button", { name: "Generate" })).toBeTruthy();
  });

  test("404s when the Model doesn't exist or isn't enabled", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx")) {
        return new Response(null, { status: 404 });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();

    expect(await view.findByText("Model not found.")).toBeTruthy();
  });

  test("shows the live under-way count from the SSE snapshot", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx")) {
        return Response.json({ model: MODEL });
      }
      if (call.url.endsWith("/api/models/ltx/generations")) {
        return Response.json({ submissions: [] });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();
    await view.findByRole("heading", { name: "LTX 2.5" });

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const source = FakeEventSource.instances[0] as FakeEventSource;
    source.emit("snapshot", { generations: [{ id: "g1" }, { id: "g2" }] });

    expect(await view.findByText("2 under way")).toBeTruthy();
  });

  test("reloads the Model and shows a message on 409 model_changed", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx") && call.method === "GET") {
        return Response.json({ model: MODEL });
      }
      if (
        call.url.endsWith("/api/models/ltx/generations") &&
        call.method === "GET"
      ) {
        return Response.json({ submissions: [] });
      }
      if (
        call.url.endsWith("/api/models/ltx/generations") &&
        call.method === "POST"
      ) {
        return Response.json(
          {
            error: "model_changed",
            model: { ...MODEL, revision: 3 },
          },
          { status: 409 },
        );
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();
    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByRole("button", { name: "Generate" });
    await userEvent.click(view.getByRole("button", { name: "Generate" }));

    expect(await view.findByText(/This Model changed; reloaded/)).toBeTruthy();
  });

  test("adds a Queued card to Submissions when a change event arrives for this Model", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx")) {
        return Response.json({ model: MODEL });
      }
      if (call.url.endsWith("/api/models/ltx/generations")) {
        return Response.json({ submissions: [] });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();
    await view.findByRole("heading", { name: "LTX 2.5" });
    expect(view.getByText("No Submissions yet.")).toBeTruthy();

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const source = FakeEventSource.instances[0] as FakeEventSource;
    source.emit("change", {
      id: "g1",
      modelId: "m1",
      modelSlug: "ltx",
      modelName: "LTX 2.5",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "s1",
      state: "queued",
      submittedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(await view.findByText("Queued")).toBeTruthy();
    expect(view.getByText("Default", { selector: "strong" })).toBeTruthy();
    expect(view.queryByText("No Submissions yet.")).toBeNull();
  });

  test('shows "no server available for this Model" on a 400 no_backend', async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx") && call.method === "GET") {
        return Response.json({ model: MODEL });
      }
      if (
        call.url.endsWith("/api/models/ltx/generations") &&
        call.method === "GET"
      ) {
        return Response.json({ submissions: [] });
      }
      if (
        call.url.endsWith("/api/models/ltx/generations") &&
        call.method === "POST"
      ) {
        return Response.json(
          {
            error: "no_backend",
            message: "no server available for this Model",
          },
          { status: 400 },
        );
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();
    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByRole("button", { name: "Generate" });
    await userEvent.click(view.getByRole("button", { name: "Generate" }));

    expect(
      await view.findByText("no server available for this Model"),
    ).toBeTruthy();
  });

  test("shows the count picker only when the Mode has a bound Seed Input (issue #47)", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx")) {
        return Response.json({ model: MODEL });
      }
      if (call.url.endsWith("/api/models/ltx/generations")) {
        return Response.json({ submissions: [] });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();
    await view.findByRole("heading", { name: "LTX 2.5" });

    expect(view.queryByLabelText("How many (1-4)")).toBeNull();
  });

  test("sends the picked count in the POST when the Mode has a bound Seed Input (issue #47)", async () => {
    const posts: Array<Record<string, unknown> | null> = [];
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx") && call.method === "GET") {
        return Response.json({ model: MODEL_WITH_SEED });
      }
      if (
        call.url.endsWith("/api/models/ltx/generations") &&
        call.method === "GET"
      ) {
        return Response.json({ submissions: [] });
      }
      if (
        call.url.endsWith("/api/models/ltx/generations") &&
        call.method === "POST"
      ) {
        posts.push(call.body);
        return Response.json(
          { generations: [], prompt: null },
          { status: 201 },
        );
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByLabelText("How many (1-4)");
    await userEvent.selectOptions(view.getByLabelText("How many (1-4)"), "3");
    await userEvent.click(view.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]?.count).toBe(3);
  });

  test("shows a Submission's prompt, prefixed when it's the Workflow's own unset value", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/models/ltx")) {
        return Response.json({ model: MODEL });
      }
      if (call.url.endsWith("/api/models/ltx/generations")) {
        return Response.json({
          submissions: [
            {
              submissionId: "s1",
              modeId: "mode1",
              modeName: "Default",
              submittedAt: "2026-01-01T00:00:00.000Z",
              prompt: "Default prompt: a cat",
              generations: [],
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();

    expect(await view.findByText("Default prompt: a cat")).toBeTruthy();
  });

  describe("Model terms and Attribution (issue #61)", () => {
    const MODEL_WITH_TERMS = {
      ...MODEL,
      attribution: "Model by Example Corp",
      terms: {
        version: 1,
        body: "Be nice.",
        licenseUrl: "https://example.com/license",
        accepted: false,
      },
    };

    test("shows Attribution atop the Workbench and a blocking dialog when terms aren't accepted", async () => {
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx") && call.method === "GET") {
          return Response.json({ model: MODEL_WITH_TERMS });
        }
        if (call.url.endsWith("/api/models/ltx/generations")) {
          return Response.json({ submissions: [] });
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();

      expect(await view.findByText("Model by Example Corp")).toBeTruthy();
      expect(await view.findByText("Be nice.")).toBeTruthy();
    });

    test("accepting closes the dialog; the Workbench links the Model terms afterwards", async () => {
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx") && call.method === "GET") {
          return Response.json({ model: MODEL_WITH_TERMS });
        }
        if (call.url.endsWith("/api/models/ltx/generations")) {
          return Response.json({ submissions: [] });
        }
        if (call.url.endsWith("/api/models/ltx/terms/accept")) {
          return Response.json({ ok: true, version: 1 });
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Be nice.");
      await userEvent.click(view.getByRole("button", { name: "Accept" }));

      await waitFor(() => expect(view.queryByText("Be nice.")).toBeNull());
      expect(view.getByRole("button", { name: "Model terms" })).toBeTruthy();
    });

    test("409 model_terms_required reopens the blocking dialog without queuing anything", async () => {
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx") && call.method === "GET") {
          return Response.json({ model: MODEL_WITH_TERMS });
        }
        if (
          call.url.endsWith("/api/models/ltx/generations") &&
          call.method === "GET"
        ) {
          return Response.json({ submissions: [] });
        }
        if (call.url.endsWith("/api/models/ltx/terms/accept")) {
          return Response.json({ ok: true, version: 1 });
        }
        if (
          call.url.endsWith("/api/models/ltx/generations") &&
          call.method === "POST"
        ) {
          return Response.json(
            { error: "model_terms_required" },
            { status: 409 },
          );
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      // Accept once (closing the initial blocking dialog) to reach
      // Generate; the server still reports the version unaccepted, as a
      // re-ask would, so submitting re-opens the dialog.
      await view.findByText("Be nice.");
      await userEvent.click(view.getByRole("button", { name: "Accept" }));
      await waitFor(() => expect(view.queryByText("Be nice.")).toBeNull());

      await userEvent.click(view.getByRole("button", { name: "Generate" }));

      expect(await view.findByText("Be nice.")).toBeTruthy();
      expect(
        view.getByText("Accept this Model's terms to continue."),
      ).toBeTruthy();
    });
  });

  describe("Image Upload Inputs (issue #50)", () => {
    const UPLOAD_INPUT_ID = "66666666-6666-4666-8666-666666666666";
    const UPLOAD_ID = "77777777-7777-4777-8777-777777777777";
    // Its own Mode id: parseInputValues caches by (revision, Mode).
    const UPLOAD_MODEL = {
      ...MODEL,
      modes: [
        {
          id: "mode-upload",
          name: "Default",
          description: "",
          inputs: [
            {
              id: UPLOAD_INPUT_ID,
              kind: "image_upload",
              group: "describe",
              label: "Start frame",
              help: "",
              placeholder: null,
              maxSizeMb: 5,
              maxLongSide: null,
            },
          ],
        },
      ],
    };

    /** Holds the chunk PUT open until `release()`, so Generate can be pressed mid-upload. */
    function uploadServer() {
      let release = () => {};
      const chunkGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const posts: FetchCall[] = [];
      const calls: string[] = [];
      mockFetch(async (call) => {
        if (call.url.endsWith("/api/models/ltx")) {
          return Response.json({ model: UPLOAD_MODEL });
        }
        if (
          call.url.endsWith("/api/models/ltx/generations") &&
          call.method === "GET"
        ) {
          return Response.json({ submissions: [] });
        }
        if (call.url.endsWith("/api/models/ltx/generations")) {
          posts.push(call);
          return Response.json({ generation: { id: "g1" } }, { status: 201 });
        }
        if (call.url === "/api/uploads") {
          calls.push("create");
          expect(call.body).toMatchObject({
            name: "frame.png",
            type: "image/png",
            modelId: "m1",
            inputId: UPLOAD_INPUT_ID,
          });
          return Response.json(
            { upload: { id: UPLOAD_ID, chunkSize: 16 * 1024 * 1024 } },
            { status: 201 },
          );
        }
        if (call.url.startsWith(`/api/uploads/${UPLOAD_ID}/chunk`)) {
          calls.push("chunk");
          await chunkGate;
          return Response.json({ offset: 4 });
        }
        if (call.url === `/api/uploads/${UPLOAD_ID}/complete`) {
          calls.push("complete");
          return Response.json({
            upload: { id: UPLOAD_ID, width: 10, height: 10 },
          });
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });
      return { release: () => release(), posts, calls };
    }

    test("uploads on pick under Your files; Generate waits for it, then submits its id", async () => {
      const server = uploadServer();
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      expect(await view.findByText("Your files")).toBeTruthy();
      await userEvent.upload(
        view.getByLabelText("Start frame"),
        new File(["PNG!"], "frame.png", { type: "image/png" }),
      );
      expect(
        await view.findByRole("progressbar", { name: "Uploading frame.png" }),
      ).toBeTruthy();

      await userEvent.click(view.getByRole("button", { name: "Generate" }));
      expect(
        await view.findByText("Waiting for your files to finish…"),
      ).toBeTruthy();
      expect(view.getByRole("button", { name: "Don't start" })).toBeTruthy();
      expect(server.posts).toHaveLength(0);

      server.release();
      await waitFor(() => expect(server.posts).toHaveLength(1));
      expect(server.posts[0]?.body).toMatchObject({
        modeId: "mode-upload",
        values: { [UPLOAD_INPUT_ID]: UPLOAD_ID },
      });
      expect(server.calls).toEqual(["create", "chunk", "complete"]);
    });

    test("Don't start cancels the waiting submit; the Upload still finishes", async () => {
      const server = uploadServer();
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Your files");
      await userEvent.upload(
        view.getByLabelText("Start frame"),
        new File(["PNG!"], "frame.png", { type: "image/png" }),
      );
      await userEvent.click(view.getByRole("button", { name: "Generate" }));
      await userEvent.click(
        await view.findByRole("button", { name: "Don't start" }),
      );
      expect(view.getByRole("button", { name: "Generate" })).toBeTruthy();

      server.release();
      await waitFor(() => expect(server.calls).toContain("complete"));
      expect(await view.findByText("frame.png")).toBeTruthy();
      expect(server.posts).toHaveLength(0);
    });

    test("refuses the wrong kind on pick, sending nothing", async () => {
      const server = uploadServer();
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Your files");
      const input = view.getByLabelText("Start frame") as HTMLInputElement;
      // `accept` would filter this out in a real picker; a drop can still deliver it.
      input.removeAttribute("accept");
      await userEvent.upload(
        input,
        new File(["GIF89a"], "anim.gif", { type: "image/gif" }),
      );
      expect(
        await view.findByText("anim.gif isn't a PNG, JPEG or WebP image."),
      ).toBeTruthy();
      expect(server.calls).toEqual([]);
    });
  });
});
