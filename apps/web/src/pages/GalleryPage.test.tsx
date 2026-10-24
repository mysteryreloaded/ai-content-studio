// See ModelEditorPage.test.tsx's header comment: this file registers its
// own happy-dom instance (bun test --isolate gives it a clean process).
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
const { GalleryPage, dayLabel } = await import("./GalleryPage.js");

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
  /** The Gallery also opens `usePauseNotice`'s shared stream; tests target the Generations one by its URL. */
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

function renderGallery(initialEntry = "/gallery") {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];

  const router = createMemoryRouter(
    [{ path: "/gallery", element: <GalleryPage /> }],
    { initialEntries: [initialEntry] },
  );
  return render(<RouterProvider router={router} />);
}

const SUBMISSION_1 = {
  submissionId: "sub1",
  modelId: "m1",
  modelSlug: "ltx",
  modelName: "LTX 2.5",
  modeId: "mode1",
  modeName: "Default",
  submittedAt: new Date().toISOString(),
  generations: [
    {
      id: "g1",
      modelId: "m1",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "sub1",
      state: "succeeded",
      error: null,
      submittedAt: new Date().toISOString(),
      assets: [
        {
          id: "a1",
          nodeId: "3",
          sortOrder: 0,
          kind: "image",
          contentType: "image/png",
        },
      ],
    },
  ],
};

describe("GalleryPage", () => {
  test("shows the empty state when there are no Submissions", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    expect(await view.findByText("Nothing here yet")).toBeTruthy();
  });

  test("groups Submissions under a Today header and shows the Model link", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({
          models: [{ id: "m1", slug: "ltx", name: "LTX 2.5", deleted: false }],
        });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [SUBMISSION_1], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    expect(await view.findByText("Today")).toBeTruthy();
    expect(view.getByRole("link", { name: "LTX 2.5" })).toBeTruthy();
    expect(view.getByText("That's everything.")).toBeTruthy();
  });

  test('shows a queued Generation as "Queued · paused" while Paused (issue #59)', async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({
          submissions: [
            {
              ...SUBMISSION_1,
              generations: [
                { ...SUBMISSION_1.generations[0], state: "queued" },
              ],
            },
          ],
          hasMore: false,
        });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    await view.findByText("Queued");

    await waitFor(() => FakeEventSource.noticeStream());
    FakeEventSource.noticeStream().emit("notice", {
      paused: true,
      notice: "",
    });

    expect(await view.findByText("Queued · paused")).toBeTruthy();
  });

  test("filters by Model via the URL and shows Clear filters on no match", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({
          models: [{ id: "m1", slug: "ltx", name: "LTX 2.5", deleted: false }],
        });
      }
      if (call.url.includes("/api/gallery?")) {
        expect(call.url).toContain("model=m1");
        return Response.json({ submissions: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery("/gallery?model=m1");
    expect(await view.findByText("No Generations match.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Clear filters" })).toBeTruthy();
  });

  test("a new change event for an unseen Submission prepends it when it matches no filter", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    await view.findByText("Nothing here yet");

    await waitFor(() => FakeEventSource.generationsStream());
    const source = FakeEventSource.generationsStream();
    source.emit("change", {
      id: "g2",
      modelId: "m2",
      modelSlug: "wan",
      modelName: "Wan",
      modeId: "mode2",
      modeName: "Default",
      submissionId: "sub2",
      state: "queued",
      error: null,
      submittedAt: new Date().toISOString(),
      assets: [],
    });

    expect(await view.findByRole("link", { name: "Wan" })).toBeTruthy();
  });

  test("an SSE event for an older unseen Submission inserts below a newer one, not on top", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [SUBMISSION_1], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    await view.findByRole("link", { name: "LTX 2.5" });

    await waitFor(() => FakeEventSource.generationsStream());
    const source = FakeEventSource.generationsStream();
    const olderSubmittedAt = new Date(
      new Date(SUBMISSION_1.submittedAt).getTime() - 60_000,
    ).toISOString();
    source.emit("change", {
      id: "g-older",
      modelId: "m2",
      modelSlug: "wan",
      modelName: "Wan",
      modeId: "mode2",
      modeName: "Default",
      submissionId: "sub-older",
      state: "queued",
      error: null,
      submittedAt: olderSubmittedAt,
      assets: [],
    });

    await view.findByRole("link", { name: "Wan" });
    const links = view
      .getAllByRole("link")
      .filter((link) => ["LTX 2.5", "Wan"].includes(link.textContent ?? ""));
    expect(links.map((link) => link.textContent)).toEqual(["LTX 2.5", "Wan"]);
  });

  test("an SSE event for an unseen Submission older than the last loaded page is dropped, not inserted", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        // hasMore: true — an older unseen Submission belongs on a page
        // this tab hasn't fetched yet, not spliced into what's shown.
        return Response.json({ submissions: [SUBMISSION_1], hasMore: true });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    await view.findByRole("link", { name: "LTX 2.5" });

    await waitFor(() => FakeEventSource.generationsStream());
    const source = FakeEventSource.generationsStream();
    const olderSubmittedAt = new Date(
      new Date(SUBMISSION_1.submittedAt).getTime() - 60_000,
    ).toISOString();
    source.emit("change", {
      id: "g-older",
      modelId: "m2",
      modelSlug: "wan",
      modelName: "Wan",
      modeId: "mode2",
      modeName: "Default",
      submissionId: "sub-older",
      state: "queued",
      error: null,
      submittedAt: olderSubmittedAt,
      assets: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(view.queryByRole("link", { name: "Wan" })).toBeNull();
  });

  test("an unrecognised ?state= reads as All instead of crashing on the next SSE event", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        expect(call.url).not.toContain("state=");
        return Response.json({ submissions: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery("/gallery?state=bogus");
    await view.findByText("Nothing here yet");

    await waitFor(() => FakeEventSource.generationsStream());
    const source = FakeEventSource.generationsStream();
    source.emit("change", {
      id: "g2",
      modelId: "m2",
      modelSlug: "wan",
      modelName: "Wan",
      modeId: "mode2",
      modeName: "Default",
      submissionId: "sub2",
      state: "queued",
      error: null,
      submittedAt: new Date().toISOString(),
      assets: [],
    });

    expect(await view.findByRole("link", { name: "Wan" })).toBeTruthy();
  });

  test("Load more sends the cursor from the last loaded Submission and appends the next page", async () => {
    const submissionCalls: string[] = [];
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        submissionCalls.push(call.url);
        if (!call.url.includes("afterSubmissionId")) {
          return Response.json({
            submissions: [SUBMISSION_1],
            hasMore: true,
          });
        }
        return Response.json({
          submissions: [{ ...SUBMISSION_1, submissionId: "sub2" }],
          hasMore: false,
        });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    await view.findByRole("button", { name: "Load more" });

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(submissionCalls.length).toBe(2));
    expect(submissionCalls[1]).toContain(
      `afterSubmittedAt=${encodeURIComponent(SUBMISSION_1.submittedAt)}`,
    );
    expect(submissionCalls[1]).toContain(
      `afterSubmissionId=${SUBMISSION_1.submissionId}`,
    );

    await waitFor(() =>
      expect(view.getByText("That's everything.")).toBeTruthy(),
    );
    expect(view.getAllByRole("link", { name: "LTX 2.5" }).length).toBe(2);
  });
});

describe("dayLabel", () => {
  const now = new Date("2026-10-24T12:00:00");

  test("Today for the same calendar day", () => {
    expect(dayLabel(new Date("2026-10-24T01:00:00"), now)).toBe("Today");
  });

  test("Yesterday for one calendar day back", () => {
    expect(dayLabel(new Date("2026-10-23T23:00:00"), now)).toBe("Yesterday");
  });

  test("a weekday and date for an older day this year", () => {
    expect(dayLabel(new Date("2026-10-21T10:00:00"), now)).toBe(
      "Wednesday 21 October",
    );
  });

  test("appends the year for a day in a different year", () => {
    expect(dayLabel(new Date("2025-12-31T10:00:00"), now)).toBe(
      "Wednesday 31 December 2025",
    );
  });
});
