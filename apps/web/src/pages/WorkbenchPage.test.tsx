// See ModelEditorPage.test.tsx's header comment: this file registers its
// own happy-dom instance (bun test --isolate gives it a clean process).
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

// happy-dom never fires a <video>/<audio> element's loadedmetadata or
// error event for a blob: URL, so `readMediaDuration` (chunkedUpload.ts)
// would hang forever reading a picked file's own duration. Firing
// `error` (as a real browser would for a file it truly can't decode)
// resolves it to `null`, which is exactly how the client already
// handles "the browser couldn't tell": skip the client-side duration
// check and let the server's own probe at complete decide.
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
      queueMicrotask(() => this.dispatchEvent(new Event("error")));
    },
  });
}

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
      // issue #48 CEO review: read off this flag, not `inputs`, since a
      // hidden Seed still sets it but isn't in `inputs`.
      hasSeed: true,
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
  /** The Workbench also opens `usePauseNotice`'s shared stream; tests target the Generations one by its URL. */
  static generationsStream(): FakeEventSource {
    const source = FakeEventSource.instances.find((instance) =>
      instance.url.includes("/api/generations/stream"),
    );
    if (!source) throw new Error("no Generations EventSource yet");
    return source;
  }
  static noticeStream(): FakeEventSource {
    const source = FakeEventSource.instances.find((instance) =>
      instance.url.includes("/api/site-settings/notice-stream"),
    );
    if (!source) throw new Error("no notice EventSource yet");
    return source;
  }
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

const DEFAULT_CAPS_STATUS = {
  dailyCap: 30,
  dailyUsed: 8,
  concurrentCap: 4,
  concurrentUsed: 2,
  oldestCountedSubmittedAt: null,
};

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) return Response.json(SIGNED_IN_USER);
    const call: FetchCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    try {
      return await handler(call);
    } catch (err) {
      // Most tests don't care about the Caps footer (issue #53); one
      // that does overrides `/api/generations/caps` in its own handler.
      if (url.endsWith("/api/generations/caps")) {
        return Response.json(DEFAULT_CAPS_STATUS);
      }
      throw err;
    }
  }) as typeof fetch;
}

function renderWorkbench(initialEntry = "/models/ltx") {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];

  const router = createMemoryRouter(
    [{ path: "/models/:slug", element: <WorkbenchPage /> }],
    { initialEntries: [initialEntry] },
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

    await waitFor(() => FakeEventSource.generationsStream());
    const source = FakeEventSource.generationsStream();
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

  describe("Value carrying across Modes and model_changed (issue #48 AC6)", () => {
    const PROMPT_ID = "p1";
    const ASPECT_ID = "a1";

    const promptInput = {
      id: PROMPT_ID,
      group: "describe" as const,
      label: "Prompt",
      help: "",
      required: false,
      placeholder: null,
      kind: "text" as const,
      multiline: false,
      maxLength: 2000,
      default: "",
    };

    const MODEL_TWO_MODES = {
      ...MODEL,
      // A revision/mode id pair distinct from every other test's, since
      // `parseInputValues` caches its schema by that pair for the
      // process's lifetime (immutable revisions): reusing one here
      // would reuse another test's cached shape instead of this Mode's.
      revision: 201,
      modes: [
        {
          id: "tm-mode1",
          name: "Default",
          description: "",
          inputs: [promptInput],
          menuGroup: "prompt" as const,
        },
        {
          id: "tm-mode2",
          name: "Other",
          description: "",
          inputs: [promptInput],
          menuGroup: "prompt" as const,
        },
      ],
    };

    test("switching Mode keeps the value of an Input the new Mode also shows", async () => {
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx") && call.method === "GET") {
          return Response.json({ model: MODEL_TWO_MODES });
        }
        if (call.url.endsWith("/api/models/ltx/generations")) {
          return Response.json({ submissions: [] });
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      const promptField = await view.findByLabelText("Prompt");
      await userEvent.type(promptField, "a dog");
      await userEvent.click(view.getByRole("radio", { name: "Other" }));

      expect((view.getByLabelText("Prompt") as HTMLInputElement).value).toBe(
        "a dog",
      );
    });

    const ASPECT_INPUT = {
      id: ASPECT_ID,
      group: "settings" as const,
      label: "Aspect",
      help: "",
      required: false,
      placeholder: null,
      kind: "select" as const,
      options: [
        { id: "square", label: "Square" },
        { id: "wide", label: "Wide" },
        { id: "tall", label: "Tall" },
      ],
      default: null,
    };

    const MODEL_WITH_ASPECT = {
      ...MODEL,
      revision: 202,
      modes: [
        {
          id: "wa-mode1",
          name: "Default",
          description: "",
          inputs: [promptInput, ASPECT_INPUT],
          menuGroup: "prompt" as const,
        },
      ],
    };

    test("409 model_changed keeps a value that still parses, drops one that doesn't", async () => {
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx") && call.method === "GET") {
          return Response.json({ model: MODEL_WITH_ASPECT });
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
              model: {
                ...MODEL_WITH_ASPECT,
                revision: 203,
                modes: [
                  {
                    id: "wa-mode1",
                    name: "Default",
                    description: "",
                    inputs: [
                      promptInput,
                      {
                        ...ASPECT_INPUT,
                        options: [{ id: "square", label: "Square" }],
                      },
                    ],
                    menuGroup: "prompt" as const,
                  },
                ],
              },
            },
            { status: 409 },
          );
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await userEvent.type(await view.findByLabelText("Prompt"), "a dog");
      await userEvent.selectOptions(view.getByLabelText("Aspect"), "wide");

      await userEvent.click(view.getByRole("button", { name: "Generate" }));
      await view.findByText(/This Model changed; reloaded/);

      expect((view.getByLabelText("Prompt") as HTMLInputElement).value).toBe(
        "a dog",
      );
      expect((view.getByLabelText("Aspect") as HTMLSelectElement).value).toBe(
        "",
      );
    });
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

    await waitFor(() => FakeEventSource.generationsStream());
    const source = FakeEventSource.generationsStream();
    source.emit("change", {
      id: "g1",
      modelId: "m1",
      modelSlug: "ltx",
      modelName: "LTX 2.5",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "s1",
      state: "queued",
      tries: 0,
      submittedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(await view.findByText("Waiting for a GPU…")).toBeTruthy();
    expect(view.getByText("Default", { selector: "strong" })).toBeTruthy();
    expect(view.queryByText("No Submissions yet.")).toBeNull();
  });

  test("shows a removed Generation as a dismissable-looking card, not its own state (issue #68's AC)", async () => {
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
              generations: [
                {
                  id: "g1",
                  modelId: "m1",
                  modelSlug: "ltx",
                  modelName: "LTX 2.5",
                  modeId: "mode1",
                  modeName: "Default",
                  submissionId: "s1",
                  state: "cancelled",
                  tries: 0,
                  error: null,
                  submittedAt: "2026-01-01T00:00:00.000Z",
                  assets: [],
                  removedAt: "2026-01-02T00:00:00.000Z",
                },
              ],
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderWorkbench();
    expect(await view.findByText("Removed by an administrator")).toBeTruthy();
    expect(view.queryByText("Cancelled")).toBeNull();
  });

  describe("Cancel a Submission (issue #54)", () => {
    const QUEUED_SUBMISSION = {
      submissionId: "s1",
      modeId: "mode1",
      modeName: "Default",
      submittedAt: "2026-01-01T00:00:00.000Z",
      generations: [
        {
          id: "g1",
          modelId: "m1",
          modelSlug: "ltx",
          modelName: "LTX 2.5",
          modeId: "mode1",
          modeName: "Default",
          submissionId: "s1",
          state: "queued",
          tries: 0,
          error: null,
          submittedAt: "2026-01-01T00:00:00.000Z",
          assets: [],
        },
      ],
    };

    test("posts to the cancel route and disables the button meanwhile", async () => {
      let cancelCalls = 0;
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx")) {
          return Response.json({ model: MODEL });
        }
        if (call.url.endsWith("/api/models/ltx/generations")) {
          return Response.json({ submissions: [QUEUED_SUBMISSION] });
        }
        if (call.url.endsWith("/api/submissions/s1/cancel")) {
          cancelCalls += 1;
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      const cancelButton = await view.findByRole("button", {
        name: "Cancel",
      });
      await userEvent.click(cancelButton);

      expect(cancelCalls).toBe(1);
      await waitFor(() =>
        expect(
          (view.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
    });

    test("shows an error and leaves the button enabled when the cancel request fails", async () => {
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx")) {
          return Response.json({ model: MODEL });
        }
        if (call.url.endsWith("/api/models/ltx/generations")) {
          return Response.json({ submissions: [QUEUED_SUBMISSION] });
        }
        if (call.url.endsWith("/api/submissions/s1/cancel")) {
          return new Response(null, { status: 500 });
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      const cancelButton = await view.findByRole("button", {
        name: "Cancel",
      });
      await userEvent.click(cancelButton);

      expect(
        await view.findByText("Could not cancel. Please try again."),
      ).toBeTruthy();
      expect(
        (view.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
  });

  test("disables Generate and shows the Pause message only while Paused (issue #59)", async () => {
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
    await view.findByRole("button", { name: "Generate" });

    await waitFor(() => FakeEventSource.noticeStream());
    const source = FakeEventSource.noticeStream();
    const generateButton = () =>
      view.getByRole("button", { name: "Generate" }) as HTMLButtonElement;

    source.emit("notice", { paused: false, notice: "" });
    await waitFor(() => expect(generateButton().disabled).toBe(false));
    expect(view.queryByRole("status")).toBeNull();

    source.emit("notice", { paused: true, notice: "" });
    expect(
      await view.findByText("Generating is paused for maintenance.", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(generateButton().disabled).toBe(true);

    source.emit("notice", { paused: false, notice: "" });
    await waitFor(() => expect(generateButton().disabled).toBe(false));
    expect(view.queryByRole("status")).toBeNull();
  });

  test('shows a queued Generation as "Queued · paused" while Paused (issue #59)', async () => {
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

    await waitFor(() => FakeEventSource.noticeStream());
    FakeEventSource.noticeStream().emit("notice", {
      paused: true,
      notice: "",
    });

    await waitFor(() => FakeEventSource.generationsStream());
    FakeEventSource.generationsStream().emit("change", {
      id: "g1",
      modelId: "m1",
      modelSlug: "ltx",
      modelName: "LTX 2.5",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "s1",
      state: "queued",
      tries: 0,
      submittedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(await view.findByText("Queued · paused")).toBeTruthy();
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

  describe("Caps (issue #53)", () => {
    test("the Workbench foot shows this user's Caps and usage", async () => {
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx")) {
          return Response.json({ model: MODEL });
        }
        if (call.url.endsWith("/api/models/ltx/generations")) {
          return Response.json({ submissions: [] });
        }
        if (call.url.endsWith("/api/generations/caps")) {
          return Response.json(DEFAULT_CAPS_STATUS);
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();

      expect(
        await view.findByText("22 of 30 left today · 2 more at once"),
      ).toBeTruthy();
    });

    test("names when the next daily slot frees once the remaining count is low", async () => {
      mockFetch((call) => {
        if (call.url.endsWith("/api/models/ltx")) {
          return Response.json({ model: MODEL });
        }
        if (call.url.endsWith("/api/models/ltx/generations")) {
          return Response.json({ submissions: [] });
        }
        if (call.url.endsWith("/api/generations/caps")) {
          return Response.json({
            dailyCap: 20,
            dailyUsed: 19,
            concurrentCap: 4,
            concurrentUsed: 1,
            oldestCountedSubmittedAt: new Date(
              Date.now() - 20 * 60 * 60 * 1000,
            ).toISOString(),
          });
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();

      expect(await view.findByText(/next slot frees in/)).toBeTruthy();
    });

    test("shows a friendly message and refreshes Caps on a 409 daily_cap_exceeded", async () => {
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
            { error: "daily_cap_exceeded", cap: 30, remaining: 0 },
            { status: 409 },
          );
        }
        throw new Error(`unexpected fetch ${call.url}`);
      });

      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      await view.findByRole("button", { name: "Generate" });
      await userEvent.click(view.getByRole("button", { name: "Generate" }));

      expect(
        await view.findByText("You've reached today's Cap of 30."),
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

  describe("Video Upload Inputs: trimming before Generate (issue #51's AC)", () => {
    const VIDEO_INPUT_ID = "88888888-8888-4888-8888-888888888888";
    const UPLOAD_ID = "99999999-9999-4999-8999-999999999999";
    const TRIMMED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const VIDEO_MODEL = {
      ...MODEL,
      modes: [
        {
          id: "mode-video",
          name: "Default",
          description: "",
          inputs: [
            {
              id: VIDEO_INPUT_ID,
              kind: "video_upload",
              group: "describe",
              label: "Clip",
              help: "",
              placeholder: null,
              maxSizeMb: 50,
              maxLongSide: null,
              minDurationMs: 0,
              maxDurationMs: 10_000,
              trimmable: true,
            },
          ],
        },
      ],
    };

    /** The uploaded file completes at a 2s duration; `trim` returns a distinct Upload id. */
    function videoServer() {
      const posts: FetchCall[] = [];
      const trimCalls: FetchCall[] = [];
      mockFetch(async (call) => {
        if (call.url.endsWith("/api/models/ltx")) {
          return Response.json({ model: VIDEO_MODEL });
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
              durationMs: 2000,
              browserPlayable: true,
            },
          });
        }
        if (call.url === `/api/uploads/${UPLOAD_ID}/trim`) {
          trimCalls.push(call);
          return Response.json(
            {
              upload: {
                id: TRIMMED_ID,
                durationMs: 1500,
                browserPlayable: true,
              },
            },
            { status: 201 },
          );
        }
        throw new Error(`unexpected fetch ${call.method} ${call.url}`);
      });
      return { posts, trimCalls };
    }

    test("changing Start, then Generate: trims once and submits the trimmed Upload's id", async () => {
      const server = videoServer();
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Your media");
      await userEvent.upload(
        view.getByLabelText("Clip"),
        new File(["MP4!"], "clip.mp4", { type: "video/mp4" }),
      );

      const startInput = await view.findByLabelText("Start (s)");
      await userEvent.clear(startInput);
      await userEvent.type(startInput, "0.5");

      await userEvent.click(view.getByRole("button", { name: "Generate" }));

      await waitFor(() => expect(server.trimCalls).toHaveLength(1));
      expect(server.trimCalls[0]?.body).toEqual({
        startMs: 500,
        endMs: 2000,
      });

      await waitFor(() => expect(server.posts).toHaveLength(1));
      expect(server.posts[0]?.body).toMatchObject({
        modeId: "mode-video",
        values: { [VIDEO_INPUT_ID]: TRIMMED_ID },
      });
    });

    test("an untouched range isn't trimmed: Generate submits the uploaded Upload's own id", async () => {
      const server = videoServer();
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Your media");
      await userEvent.upload(
        view.getByLabelText("Clip"),
        new File(["MP4!"], "clip.mp4", { type: "video/mp4" }),
      );
      await view.findByLabelText("Start (s)");

      await userEvent.click(view.getByRole("button", { name: "Generate" }));

      await waitFor(() => expect(server.posts).toHaveLength(1));
      expect(server.trimCalls).toHaveLength(0);
      expect(server.posts[0]?.body).toMatchObject({
        modeId: "mode-video",
        values: { [VIDEO_INPUT_ID]: UPLOAD_ID },
      });
    });

    test("a trimmed Generate, then the range set back to the whole clip, submits the Upload's own id, not the stale trimmed one (Dule's round 6 review)", async () => {
      const server = videoServer();
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Your media");
      await userEvent.upload(
        view.getByLabelText("Clip"),
        new File(["MP4!"], "clip.mp4", { type: "video/mp4" }),
      );

      const startInput = await view.findByLabelText("Start (s)");
      await userEvent.clear(startInput);
      await userEvent.type(startInput, "0.5");
      await userEvent.click(view.getByRole("button", { name: "Generate" }));

      await waitFor(() => expect(server.trimCalls).toHaveLength(1));
      await waitFor(() => expect(server.posts).toHaveLength(1));
      expect(server.posts[0]?.body).toMatchObject({
        values: { [VIDEO_INPUT_ID]: TRIMMED_ID },
      });

      await userEvent.clear(startInput);
      await userEvent.type(startInput, "0");
      await userEvent.click(view.getByRole("button", { name: "Generate" }));

      await waitFor(() => expect(server.posts).toHaveLength(2));
      expect(server.trimCalls).toHaveLength(1);
      expect(server.posts[1]?.body).toMatchObject({
        values: { [VIDEO_INPUT_ID]: UPLOAD_ID },
      });
    });
  });

  describe("Points Inputs (issue #52)", () => {
    const VIDEO_INPUT_ID = "88888888-8888-4888-8888-888888888888";
    const POINTS_INPUT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const UPLOAD_ID = "99999999-9999-4999-8999-999999999999";
    const WIDTH_INPUT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    function pointsModelWithDefaultSize() {
      return {
        ...MODEL,
        modes: [
          {
            id: "mode-points",
            name: "Default",
            description: "",
            inputs: [
              {
                id: VIDEO_INPUT_ID,
                kind: "video_upload",
                group: "describe",
                label: "Clip",
                help: "",
                placeholder: null,
                maxSizeMb: 50,
                maxLongSide: null,
                minDurationMs: 0,
                maxDurationMs: 10_000,
                trimmable: true,
              },
              {
                id: POINTS_INPUT_ID,
                kind: "points",
                group: "describe",
                label: "Who to replace",
                help: "",
                placeholder: null,
                videoInputId: VIDEO_INPUT_ID,
                widthInputId: null,
                heightInputId: null,
                defaultWidth: 512,
                defaultHeight: 512,
              },
            ],
          },
        ],
      };
    }

    /** Like {@link pointsModelWithDefaultSize}, but the crop/scale target width comes from a shown Number Input instead of a literal. */
    function pointsModelWithBoundWidth() {
      const model = pointsModelWithDefaultSize();
      const pointsInput = model.modes[0]?.inputs[1];
      if (!pointsInput || pointsInput.kind !== "points") throw new Error();
      return {
        ...model,
        modes: [
          {
            ...model.modes[0],
            inputs: [
              model.modes[0]?.inputs[0],
              {
                id: WIDTH_INPUT_ID,
                kind: "number",
                group: "settings",
                label: "Width",
                help: "",
                placeholder: null,
                numberMode: "integer",
                min: 64,
                max: 2048,
                step: 8,
                default: 256,
              },
              {
                ...pointsInput,
                widthInputId: WIDTH_INPUT_ID,
                defaultWidth: null,
              },
            ],
          },
        ],
      };
    }

    const SIZE_SELECT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const SMALL_OPTION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const BIG_OPTION_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    /** Like {@link pointsModelWithDefaultSize}, but the crop/scale target width comes from a shown Select Input's chosen option, not a literal or a Number Input (issue #52 CEO review round 2 point 4). */
    function pointsModelWithBoundSelectWidth() {
      const model = pointsModelWithDefaultSize();
      const pointsInput = model.modes[0]?.inputs[1];
      if (!pointsInput || pointsInput.kind !== "points") throw new Error();
      return {
        ...model,
        modes: [
          {
            ...model.modes[0],
            inputs: [
              model.modes[0]?.inputs[0],
              {
                id: SIZE_SELECT_ID,
                kind: "select",
                group: "settings",
                label: "Size",
                help: "",
                placeholder: null,
                options: [
                  { id: SMALL_OPTION_ID, label: "Small" },
                  { id: BIG_OPTION_ID, label: "Big" },
                ],
                default: BIG_OPTION_ID,
              },
              {
                ...pointsInput,
                widthInputId: SIZE_SELECT_ID,
                widthOptionValues: {
                  [SMALL_OPTION_ID]: 256,
                  [BIG_OPTION_ID]: 1024,
                },
                defaultWidth: null,
              },
            ],
          },
        ],
      };
    }

    function pointsServer(model: unknown) {
      const posts: FetchCall[] = [];
      mockFetch(async (call) => {
        if (call.url.endsWith("/api/models/ltx")) {
          return Response.json({ model });
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
            upload: { id: UPLOAD_ID, durationMs: 2000, browserPlayable: true },
          });
        }
        throw new Error(`unexpected fetch ${call.method} ${call.url}`);
      });
      return { posts };
    }

    test("asks for a video before showing the picker", async () => {
      pointsServer(pointsModelWithDefaultSize());
      const view = renderWorkbench();

      await view.findByText("Points");
      expect(view.getByText("Pick a video above first.")).toBeTruthy();
    });

    test("shows the point counter once a video is uploaded and a target size is known", async () => {
      pointsServer(pointsModelWithDefaultSize());
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Your media");
      await userEvent.upload(
        view.getByLabelText("Clip"),
        new File(["MP4!"], "clip.mp4", { type: "video/mp4" }),
      );
      await view.findByLabelText("Start (s)");

      expect(await view.findByText(/0\/10 points picked/)).toBeTruthy();
    });

    test("resolves the crop's target size from a bound Number Input, not just the literal default", async () => {
      pointsServer(pointsModelWithBoundWidth());
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Your media");
      await userEvent.upload(
        view.getByLabelText("Clip"),
        new File(["MP4!"], "clip.mp4", { type: "video/mp4" }),
      );
      await view.findByLabelText("Start (s)");

      // No literal `defaultWidth` on this fixture: the picker only shows
      // once *some* target width is known, here from the Width Input.
      expect(await view.findByText(/0\/10 points picked/)).toBeTruthy();
    });

    test("resolves the crop's target size from a bound Select Input's chosen option value, not Number() of its option id", async () => {
      pointsServer(pointsModelWithBoundSelectWidth());
      const view = renderWorkbench();
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );

      await view.findByText("Your media");
      await userEvent.upload(
        view.getByLabelText("Clip"),
        new File(["MP4!"], "clip.mp4", { type: "video/mp4" }),
      );
      await view.findByLabelText("Start (s)");

      // `Size` defaults to the Big option: `Number(optionId)` is NaN,
      // so before the fix this fell back to `defaultWidth` (null here),
      // showing "Set a size first." instead of the picker.
      expect(await view.findByText(/0\/10 points picked/)).toBeTruthy();
    });
  });

  describe("Reuse these settings (issue #57)", () => {
    const VIDEO_INPUT_ID = "11111111-1111-4111-8111-111111111111";
    const POINTS_INPUT_ID = "22222222-2222-4222-8222-222222222222";

    function reuseModel() {
      return {
        ...MODEL,
        modes: [
          {
            id: "mode-points",
            name: "Default",
            description: "",
            inputs: [
              {
                id: VIDEO_INPUT_ID,
                kind: "video_upload",
                group: "describe",
                label: "Clip",
                help: "",
                placeholder: null,
                maxSizeMb: 50,
                maxLongSide: null,
                minDurationMs: 0,
                maxDurationMs: 10_000,
                trimmable: true,
              },
              {
                id: POINTS_INPUT_ID,
                kind: "points",
                group: "describe",
                label: "Who to replace",
                help: "",
                placeholder: null,
                videoInputId: VIDEO_INPUT_ID,
                widthInputId: null,
                heightInputId: null,
                defaultWidth: 512,
                defaultHeight: 512,
              },
            ],
          },
        ],
      };
    }

    function reuseServer(detail: Record<string, unknown>) {
      mockFetch(async (call) => {
        if (call.url.endsWith("/api/models/ltx")) {
          return Response.json({ model: reuseModel() });
        }
        if (
          call.url.endsWith("/api/models/ltx/generations") &&
          call.method === "GET"
        ) {
          return Response.json({ submissions: [] });
        }
        if (call.url === "/api/generations/g0") {
          return Response.json(detail);
        }
        throw new Error(`unexpected fetch ${call.method} ${call.url}`);
      });
    }

    test("carries Points over when the video Upload it was drawn on also carries over", async () => {
      reuseServer({
        modelId: "m1",
        modelDeleted: false,
        modeId: "mode-points",
        settings: [
          {
            inputId: VIDEO_INPUT_ID,
            label: "Clip",
            kind: "upload",
            display: "clip.mp4",
            upload: {
              id: "upload-1",
              name: "clip.mp4",
              size: 100,
              durationMs: 2000,
              width: 640,
              height: 480,
              thumbnailKey: null,
              trimmedFromName: null,
            },
          },
          {
            inputId: POINTS_INPUT_ID,
            label: "Who to replace",
            kind: "points",
            display: "1 point",
            points: [{ x: 300, y: 200 }],
            frameWidth: 512,
            frameHeight: 512,
          },
        ],
      });

      const view = renderWorkbench("/models/ltx?reuse=g0");
      expect(
        await view.findByText("Reused that Generation's settings."),
      ).toBeTruthy();
      // The effect's own cleanup (dropping `?reuse=` from the URL) runs
      // in a `.finally()` after the notice is set; let it settle before
      // the test's own cleanup unmounts, so it doesn't fire afterwards.
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    test("drops Points, noting it, when the video Upload it was drawn on is gone", async () => {
      reuseServer({
        modelId: "m1",
        modelDeleted: false,
        modeId: "mode-points",
        settings: [
          {
            inputId: VIDEO_INPUT_ID,
            label: "Clip",
            kind: "upload",
            display: "None",
            upload: null,
          },
          {
            inputId: POINTS_INPUT_ID,
            label: "Who to replace",
            kind: "points",
            display: "1 point",
            points: [{ x: 300, y: 200 }],
            frameWidth: 512,
            frameHeight: 512,
          },
        ],
      });

      const view = renderWorkbench("/models/ltx?reuse=g0");
      const notice = await view.findByText(/Not carried over/);
      expect(notice.textContent).toContain("Clip (its Upload is gone)");
      expect(notice.textContent).toContain(
        "Who to replace (redraw the points)",
      );
      // See the previous test's comment: let the effect's own `.finally()` settle first.
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    test("refuses a removed Generation instead of reusing its settings (issue #68's AC)", async () => {
      reuseServer({
        modelId: "m1",
        modelDeleted: false,
        modeId: "mode-points",
        removedAt: new Date().toISOString(),
        settings: [
          {
            inputId: POINTS_INPUT_ID,
            label: "Who to replace",
            kind: "points",
            display: "1 point",
            points: [{ x: 300, y: 200 }],
            frameWidth: 512,
            frameHeight: 512,
          },
        ],
      });

      const view = renderWorkbench("/models/ltx?reuse=g0");
      expect(
        await view.findByText(
          "That Generation was removed by an administrator; its settings can't be reused.",
        ),
      ).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });
});
