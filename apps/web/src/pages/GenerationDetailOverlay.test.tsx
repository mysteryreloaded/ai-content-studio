// See ModelEditorPage.test.tsx's header comment: this file registers its
// own happy-dom instance (bun test --isolate gives it a clean process).
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, fireEvent, waitFor } = await import("@testing-library/react");
const { GalleryPage } = await import("./GalleryPage.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "../test/render.js"
);

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
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

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: (event: { data: string }) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }
  close() {}
  dispatch(type: string, data: unknown) {
    for (const handler of this.listeners[type] ?? []) {
      handler({ data: JSON.stringify(data) });
    }
  }
}

interface FetchCall {
  method: string;
  url: string;
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) return Response.json(SIGNED_IN_USER);
    return handler({
      method: (init?.method ?? "GET").toUpperCase(),
      url,
    });
  }) as typeof fetch;
}

function renderAt(initialEntry: string) {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];

  return renderWithProviders(null, {
    route: initialEntry,
    routes: [
      { path: "/gallery", element: <GalleryPage /> },
      { path: "/generations/:id", element: <GalleryPage /> },
    ],
  });
}

const GENERATION_1 = {
  id: "g1",
  state: "succeeded",
  error: null,
  tries: 1,
  submittedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  deletedAt: null,
  removedAt: null,
  modelId: "m1",
  modelSlug: "ltx",
  modelName: "LTX 2.5",
  modelAttribution: "",
  modelDeleted: false,
  modeId: "mode1",
  modeName: "Default",
  assets: [
    {
      id: "a1",
      nodeId: "3",
      sortOrder: 0,
      kind: "image",
      contentType: "image/png",
      size: 100,
      width: 10,
      height: 10,
      durationMs: null,
      fps: null,
    },
  ],
  settings: [],
};

const SUBMISSION_1 = {
  submissionId: "sub1",
  modelId: "m1",
  modelSlug: "ltx",
  modelName: "LTX 2.5",
  modeId: "mode1",
  modeName: "Default",
  submittedAt: GENERATION_1.submittedAt,
  generations: [
    {
      id: "g1",
      modelId: "m1",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "sub1",
      state: "succeeded",
      error: null,
      submittedAt: GENERATION_1.submittedAt,
      assets: GENERATION_1.assets,
    },
    {
      id: "g2",
      modelId: "m1",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "sub1",
      state: "succeeded",
      error: null,
      submittedAt: GENERATION_1.submittedAt,
      assets: GENERATION_1.assets,
    },
  ],
};

const GENERATION_2 = { ...GENERATION_1, id: "g2" };

function galleryHandlers(submissions: unknown[] = [SUBMISSION_1]) {
  return (call: FetchCall) => {
    if (call.url.endsWith("/api/gallery/models")) {
      return Response.json({ models: [] });
    }
    if (call.url.includes("/api/gallery?")) {
      return Response.json({ submissions, hasMore: false });
    }
    return null;
  };
}

describe("GenerationDetailOverlay (issue #57/#199)", () => {
  test("404s when the Generation is missing or not this user's own", async () => {
    mockFetch((call) => {
      const base = galleryHandlers([])(call);
      if (base) return base;
      if (call.url === "/api/generations/missing") {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/missing");
    expect(await view.findByText("Not found.")).toBeTruthy();
  });

  test("←/→ navigates between the Gallery's loaded Generations", async () => {
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1")
        return Response.json(GENERATION_1);
      if (call.url === "/api/generations/g2")
        return Response.json(GENERATION_2);
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    await waitFor(() => expect(view.getByText("Generation")).toBeTruthy());

    expect(
      view.getByRole("button", { name: "Previous Generation" }),
    ).toHaveProperty("disabled", true);
    const next = view.getByRole("button", { name: "Next Generation" });
    expect(next).toHaveProperty("disabled", false);

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(next);

    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Next Generation" }),
      ).toHaveProperty("disabled", true),
    );
  });

  test("→ is disabled when the open Generation isn't loaded", async () => {
    mockFetch((call) => {
      const base = galleryHandlers([])(call);
      if (base) return base;
      if (call.url === "/api/generations/stray") {
        return Response.json({ ...GENERATION_1, id: "stray" });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/stray");
    await waitFor(() => expect(view.getByText("Generation")).toBeTruthy());

    expect(
      view.getByRole("button", { name: "Previous Generation" }),
    ).toHaveProperty("disabled", true);
    expect(
      view.getByRole("button", { name: "Next Generation" }),
    ).toHaveProperty("disabled", true);
  });

  test("ArrowRight on a focused video doesn't change Generation", async () => {
    const VIDEO_GENERATION = {
      ...GENERATION_1,
      assets: [
        {
          id: "a1",
          nodeId: "3",
          sortOrder: 0,
          kind: "video",
          contentType: "video/mp4",
          size: 100,
          width: 1280,
          height: 720,
          durationMs: 5000,
          fps: 24,
        },
      ],
    };
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1")
        return Response.json(VIDEO_GENERATION);
      if (call.url === "/api/generations/g2")
        return Response.json(GENERATION_2);
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    await waitFor(() => expect(view.getByText("Generation")).toBeTruthy());

    const video = document.body.querySelector("video");
    expect(video).toBeTruthy();
    fireEvent.keyDown(video as Element, { key: "ArrowRight" });

    await drainMacrotasks(1);
    expect(
      view.getByRole("button", { name: "Next Generation" }),
    ).toHaveProperty("disabled", false);
    // Still on g1: its Model link is still the one rendered.
    expect(view.getAllByText("LTX 2.5").length).toBeGreaterThan(0);
  });

  test("Delete tombstones the Generation and closes the dialog", async () => {
    let deleted = false;
    mockFetch((call) => {
      const base = galleryHandlers(deleted ? [] : [SUBMISSION_1])(call);
      if (base) return base;
      if (call.url === "/api/generations/g1" && call.method === "DELETE") {
        deleted = true;
        return Response.json({ ok: true });
      }
      if (call.url === "/api/generations/g1")
        return Response.json(GENERATION_1);
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    await waitFor(() => expect(view.getByText("Generation")).toBeTruthy());

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(
      view.getByRole("button", { name: "Delete this Generation" }),
    );
    await userEvent.click(view.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(view.queryByText("Generation")).toBeNull());
  });

  test("a removed Generation shows Dismiss, no Reuse or Delete (issue #68's AC)", async () => {
    let dismissed = false;
    const REMOVED_GENERATION = {
      ...GENERATION_1,
      removedAt: new Date().toISOString(),
    };
    mockFetch((call) => {
      const base = galleryHandlers(dismissed ? [] : [SUBMISSION_1])(call);
      if (base) return base;
      if (
        call.url === "/api/generations/g1/dismiss-removed" &&
        call.method === "POST"
      ) {
        dismissed = true;
        return Response.json({ ok: true });
      }
      if (call.url === "/api/generations/g1") {
        return Response.json(REMOVED_GENERATION);
      }
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    expect(await view.findByText("Removed by an administrator.")).toBeTruthy();
    expect(
      view.queryByRole("button", { name: "Reuse these settings" }),
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Delete this Generation" }),
    ).toBeNull();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(dismissed).toBe(true));
    await waitFor(() =>
      expect(view.queryByText("Removed by an administrator.")).toBeNull(),
    );
  });

  test("a deleted Model's Generation has no Reuse and no Model link", async () => {
    const DELETED_MODEL_GENERATION = { ...GENERATION_1, modelDeleted: true };
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1") {
        return Response.json(DELETED_MODEL_GENERATION);
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    await waitFor(() => expect(view.getByText("Generation")).toBeTruthy());

    expect(
      view.queryByRole("button", { name: "Reuse these settings" }),
    ).toBeNull();
    expect(view.queryByRole("link", { name: "LTX 2.5" })).toBeNull();
    expect(view.getAllByText("LTX 2.5").length).toBeGreaterThan(0);
  });

  test("settings are grouped under Your files, Describe it and Settings", async () => {
    const GENERATION_WITH_SETTINGS = {
      ...GENERATION_1,
      settings: [
        {
          inputId: "prompt",
          label: "Prompt",
          kind: "text",
          display: "a line\nanother line",
          value: "a line\nanother line",
        },
        {
          inputId: "duration",
          label: "Duration (s)",
          kind: "number",
          display: "5",
          value: 5,
        },
        {
          inputId: "image",
          label: "Image",
          kind: "upload",
          display: "None",
          upload: null,
        },
      ],
    };
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1") {
        return Response.json(GENERATION_WITH_SETTINGS);
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    await waitFor(() => expect(view.getByText("Prompt")).toBeTruthy());

    const yourFiles = view.getByText("Your files");
    const describeIt = view.getByText("Describe it");
    const settingsHeading = view.getByText("Settings");
    expect(yourFiles).toBeTruthy();
    expect(describeIt).toBeTruthy();
    expect(settingsHeading).toBeTruthy();
    expect(view.getByText("Image")).toBeTruthy();
    expect(view.getByText("Duration (s)")).toBeTruthy();
  });

  test("a removed Upload reads Removed by an administrator", async () => {
    const GENERATION_WITH_REMOVED_UPLOAD = {
      ...GENERATION_1,
      settings: [
        {
          inputId: "image",
          label: "Image",
          kind: "upload",
          display: "Removed by an administrator",
          upload: {
            id: "u1",
            name: "cat.png",
            size: 100,
            durationMs: null,
            width: 10,
            height: 10,
            thumbnailKey: "k1",
            trimmedFromName: null,
            trimStartMs: null,
            trimEndMs: null,
            removed: true,
          },
        },
      ],
    };
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1") {
        return Response.json(GENERATION_WITH_REMOVED_UPLOAD);
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    expect(await view.findByText("Removed by an administrator")).toBeTruthy();
    // Only the main Asset's own player image, inside the dialog — no Upload thumbnail.
    const dialog = document.body.querySelector("[role='dialog']") as Element;
    expect(dialog.querySelectorAll("img[alt='']").length).toBe(1);
  });

  test("a multi-line prompt keeps its line breaks", async () => {
    const GENERATION_WITH_PROMPT = {
      ...GENERATION_1,
      settings: [
        {
          inputId: "prompt",
          label: "Prompt",
          kind: "text",
          display: "line one\nline two",
          value: "line one\nline two",
        },
      ],
    };
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1") {
        return Response.json(GENERATION_WITH_PROMPT);
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    const value = await view.findByText((text) => text.includes("line one"));
    expect(value.className).toContain("whitespace-pre-wrap");
    expect(value.textContent).toBe("line one\nline two");
  });

  test("facts read 1280×720 · 5.0 s · 24 fps · 12.3 MB", async () => {
    const VIDEO_GENERATION = {
      ...GENERATION_1,
      assets: [
        {
          id: "a1",
          nodeId: "3",
          sortOrder: 0,
          kind: "video",
          contentType: "video/mp4",
          size: 12_897_792,
          width: 1280,
          height: 720,
          durationMs: 5000,
          fps: 24,
        },
      ],
    };
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1") {
        return Response.json(VIDEO_GENERATION);
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    expect(
      await view.findByText("1280×720 · 5.0 s · 24 fps · 12.3 MB"),
    ).toBeTruthy();
  });

  test("points draw on the video Upload's thumbnail", async () => {
    const GENERATION_WITH_POINTS = {
      ...GENERATION_1,
      settings: [
        {
          inputId: "video",
          label: "Video",
          kind: "upload",
          display: "clip.mp4",
          upload: {
            id: "u1",
            name: "clip.mp4",
            size: 100,
            durationMs: 5000,
            width: 640,
            height: 360,
            thumbnailKey: "k1",
            trimmedFromName: null,
            trimStartMs: null,
            trimEndMs: null,
            removed: false,
          },
        },
        {
          inputId: "points",
          label: "Who to replace",
          kind: "points",
          display: "1 point",
          points: [{ x: 320, y: 180 }],
          frameWidth: 640,
          frameHeight: 360,
          videoInputId: "video",
        },
      ],
    };
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1") {
        return Response.json(GENERATION_WITH_POINTS);
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    await waitFor(() => expect(view.getByText("Who to replace")).toBeTruthy());
    const dots = document.body.querySelectorAll(
      "[style*='left'][style*='top']",
    );
    expect(dots.length).toBeGreaterThan(0);
  });

  test("Copy writes the full Generation id", async () => {
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1")
        return Response.json(GENERATION_1);
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    const view = renderAt("/generations/g1");
    const copyButton = await view.findByRole("button", {
      name: "Copy Generation id",
    });
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(copyButton);

    await waitFor(() => expect(written).toEqual(["g1"]));
  });

  test("a change event for the open Generation refetches it", async () => {
    let succeeded = false;
    mockFetch((call) => {
      const base = galleryHandlers()(call);
      if (base) return base;
      if (call.url === "/api/generations/g1") {
        return Response.json(
          succeeded
            ? GENERATION_1
            : { ...GENERATION_1, state: "running", assets: [] },
        );
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    expect(await view.findByText("Running")).toBeTruthy();

    succeeded = true;
    await waitFor(() =>
      expect(FakeEventSource.instances.length).toBeGreaterThan(0),
    );
    FakeEventSource.instances[0]?.dispatch("change", { ...GENERATION_1 });

    await waitFor(() =>
      expect(document.body.querySelector("img[alt='']")).toBeTruthy(),
    );
  });
});
