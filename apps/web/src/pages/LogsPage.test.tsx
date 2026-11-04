// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { renderWithProviders } = await import("../test/render.js");
const { LogsPage } = await import("./LogsPage.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

interface FetchCall {
  method: string;
  url: string;
}

const BACKENDS = [{ id: "b1", name: "GPU One" }];
const MODELS = [{ id: "m1", name: "LTX 2.5" }];

const ERROR_ENTRY = {
  id: "l1",
  level: "error",
  source: "backend",
  message: "ComfyUI raised an error",
  details: "Traceback...\nnode_errors: {}",
  backendId: "b1",
  backendName: "GPU One",
  userId: "u1",
  userEmail: "alice@example.com",
  modelId: "m1",
  generationId: "g1",
  createdAt: "2026-01-02T00:00:00.000Z",
};

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const call: FetchCall = {
      method: "GET",
      url: typeof input === "string" ? input : input.toString(),
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

function defaultHandler(entries: unknown[] = [ERROR_ENTRY]) {
  return (call: FetchCall): Response => {
    if (call.url.includes("/api/admin/backends")) {
      return Response.json({ backends: BACKENDS, disabledBanner: null });
    }
    if (call.url.includes("/api/admin/models")) {
      return Response.json({ models: MODELS });
    }
    if (call.url.includes("/api/admin/users/")) {
      return Response.json({ id: "u1", name: "Alice" });
    }
    return Response.json({ entries });
  };
}

describe("LogsPage", () => {
  test("reads filters from the URL", async () => {
    const calls = mockFetch(defaultHandler([]));

    renderWithProviders(<LogsPage />, {
      route: "/admin/logs?level=error&backendId=b1",
    });

    await waitFor(() => {
      const logsCall = calls.find((call) =>
        call.url.includes("/api/admin/logs?"),
      );
      expect(logsCall?.url).toContain("level=error");
      expect(logsCall?.url).toContain("backendId=b1");
    });
  });

  test("expanding shows details and links", async () => {
    mockFetch(defaultHandler());

    renderWithProviders(<LogsPage />, { route: "/admin/logs" });

    const row = await screen.findByText("ComfyUI raised an error");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(row);

    expect(await screen.findByText(/Traceback/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Generation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Model" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Backend" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "User" })).toBeTruthy();
    expect(screen.getByText("alice@example.com")).toBeTruthy();
  });

  test("Source lists the app and each Backend", async () => {
    mockFetch(defaultHandler([]));

    renderWithProviders(<LogsPage />, { route: "/admin/logs" });
    await screen.findByText("No Log entries match these filters.");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByLabelText("Source"));

    expect(await screen.findByRole("option", { name: "App" })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Backend: GPU One" }),
    ).toBeTruthy();
  });

  test("Refresh refetches with the same filters", async () => {
    const calls = mockFetch(defaultHandler([]));

    renderWithProviders(<LogsPage />, {
      route: "/admin/logs?level=warning",
    });

    await waitFor(() => {
      expect(
        calls.filter((call) => call.url.includes("/api/admin/logs?")).length,
      ).toBe(1);
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      const logsCalls = calls.filter((call) =>
        call.url.includes("/api/admin/logs?"),
      );
      expect(logsCalls.length).toBe(2);
      expect(logsCalls[1]?.url).toContain("level=warning");
    });
  });

  test("a request id in the URL filters the list and shows as a removable chip", async () => {
    const calls = mockFetch(defaultHandler([]));

    renderWithProviders(<LogsPage />, {
      route: "/admin/logs?requestId=req-42&level=error",
    });

    await waitFor(() => {
      const logsCall = calls.find((call) =>
        call.url.includes("/api/admin/logs?"),
      );
      expect(logsCall?.url).toContain("requestId=req-42");
      expect(logsCall?.url).toContain("level=error");
    });

    expect(screen.getByText("req-42")).toBeTruthy();
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(
      screen.getByRole("button", { name: "Clear request id filter" }),
    );

    await waitFor(() => {
      const logsCalls = calls.filter((call) =>
        call.url.includes("/api/admin/logs?"),
      );
      const last = logsCalls[logsCalls.length - 1]?.url ?? "";
      expect(last).not.toContain("requestId");
      expect(last).toContain("level=error");
    });
    expect(screen.queryByText("req-42")).toBeNull();
  });

  test("an expanded entry shows the request it was written in", async () => {
    mockFetch(defaultHandler([{ ...ERROR_ENTRY, requestId: "req-42" }]));

    renderWithProviders(<LogsPage />, { route: "/admin/logs" });

    const row = await screen.findByText("ComfyUI raised an error");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(row);

    expect(screen.getByText("request req-42")).toBeTruthy();
  });

  test("the end of the list says that is everything", async () => {
    mockFetch((call) => {
      if (call.url.includes("/api/admin/backends")) {
        return Response.json({ backends: BACKENDS, disabledBanner: null });
      }
      if (call.url.includes("/api/admin/models")) {
        return Response.json({ models: MODELS });
      }
      return Response.json({ entries: [ERROR_ENTRY], hasMore: false });
    });

    renderWithProviders(<LogsPage />, { route: "/admin/logs" });

    await screen.findByText("ComfyUI raised an error");
    expect(screen.getByText("That's everything.")).toBeTruthy();
  });

  test("Load older fetches the next page with a keyset cursor and appends", async () => {
    const OLDER_ENTRY = {
      ...ERROR_ENTRY,
      id: "l2",
      message: "An older error",
      details: null,
      userId: null,
      userEmail: null,
      modelId: null,
      generationId: null,
      requestId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const calls = mockFetch((call) => {
      if (call.url.includes("/api/admin/backends")) {
        return Response.json({ backends: BACKENDS, disabledBanner: null });
      }
      if (call.url.includes("/api/admin/models")) {
        return Response.json({ models: MODELS });
      }
      if (call.url.includes("/api/admin/users/")) {
        return Response.json({ id: "u1", name: "Alice" });
      }
      if (!call.url.includes("beforeCreatedAt")) {
        return Response.json({ entries: [ERROR_ENTRY], hasMore: true });
      }
      return Response.json({ entries: [OLDER_ENTRY], hasMore: false });
    });

    renderWithProviders(<LogsPage />, { route: "/admin/logs" });

    await screen.findByText("ComfyUI raised an error");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByText("Load older"));

    expect(await screen.findByText("An older error")).toBeTruthy();
    expect(screen.queryByText("Load older")).toBeNull();
    expect(screen.getByText("That's everything.")).toBeTruthy();
    // No filters set, so the first call's URL carries no "?".
    const secondCall = calls.filter((call) =>
      call.url.includes("/api/admin/logs"),
    )[1]?.url;
    expect(secondCall).toContain(
      `beforeCreatedAt=${encodeURIComponent(ERROR_ENTRY.createdAt)}`,
    );
    expect(secondCall).toContain("beforeId=l1");
  });
});
