// A DOM is registered only for this file's run (not a global preload),
// since bun test runs every file in one process and other files (the
// server's) must keep Bun's own fetch/Response untouched. It must be
// registered before @testing-library/react is imported, since that
// module binds its `screen` helper to `document.body` at import time.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render, screen, waitFor } = await import(
  "@testing-library/react"
);
const { BackendsPage } = await import("./BackendsPage.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const BACKEND = {
  id: "b1",
  name: "GPU 1",
  baseUrl: "http://10.0.0.5:8188",
  auth: "none" as const,
  headerName: null,
  version: 1,
  health: {
    reachability: "reachable" as const,
    comfyuiVersion: "0.3.5",
    vramTotal: 24 * 1024 ** 3,
    vramFree: 20 * 1024 ** 3,
    credentialsError: false,
  },
};

interface FetchCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
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

describe("BackendsPage", () => {
  test("lists Backends with health, ComfyUI version and VRAM", async () => {
    mockFetch(() =>
      Response.json({ backends: [BACKEND], disabledBanner: null }),
    );

    render(<BackendsPage />);

    expect(await screen.findByText("GPU 1")).toBeTruthy();
    expect(screen.getByText("reachable")).toBeTruthy();
    expect(screen.getByText("0.3.5")).toBeTruthy();
    expect(screen.getByText("20.0 GiB")).toBeTruthy();
  });

  test("shows the unknown and unreachable states too", async () => {
    mockFetch(() =>
      Response.json({
        backends: [
          {
            ...BACKEND,
            id: "b2",
            name: "Unknown one",
            health: { ...BACKEND.health, reachability: "unknown" },
          },
          {
            ...BACKEND,
            id: "b3",
            name: "Down one",
            health: { ...BACKEND.health, reachability: "unreachable" },
          },
        ],
        disabledBanner: null,
      }),
    );

    render(<BackendsPage />);

    await screen.findByText("Unknown one");
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.getByText("unreachable")).toBeTruthy();
  });

  test("shows a credentials-error Backend as needing re-entry", async () => {
    mockFetch(() =>
      Response.json({
        backends: [
          {
            ...BACKEND,
            health: {
              ...BACKEND.health,
              reachability: "unreachable",
              credentialsError: true,
            },
          },
        ],
        disabledBanner: null,
      }),
    );

    render(<BackendsPage />);

    expect(await screen.findByText("re-enter credentials")).toBeTruthy();
  });

  test("shows the BACKENDS_ENABLED banner when the server sends one", async () => {
    mockFetch(() =>
      Response.json({
        backends: [],
        disabledBanner: "Backend contact is disabled",
      }),
    );

    render(<BackendsPage />);

    expect(await screen.findByText("Backend contact is disabled")).toBeTruthy();
  });

  test("links to the Backend's history endpoint", async () => {
    mockFetch(() =>
      Response.json({ backends: [BACKEND], disabledBanner: null }),
    );

    render(<BackendsPage />);

    const link = (await screen.findByText("History")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/admin/backends/b1/history");
  });

  test("adding a Backend posts the form and reloads the list", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({ backends: [], disabledBanner: null });
      if (call.method === "POST") {
        return Response.json({ ...BACKEND, name: "New GPU" }, { status: 201 });
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    render(<BackendsPage />);

    await screen.findByText("Add Backend");
    await userEvent.click(screen.getByText("Add Backend"));
    await userEvent.type(screen.getByLabelText("Name"), "New GPU");
    await userEvent.type(
      screen.getByLabelText("Base URL"),
      "http://10.0.0.9:8188",
    );
    await userEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post).toBeTruthy();
    });
  });

  test("editing a Backend with blank credential fields sends no credential fields", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({
          backends: [{ ...BACKEND, auth: "basic" as const }],
          disabledBanner: null,
        });
      if (call.method === "PUT") return Response.json(BACKEND);
      throw new Error(`unexpected ${call.method}`);
    });

    render(<BackendsPage />);

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByText("Edit"));
    await userEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put).toBeTruthy();
      expect(put?.body?.basicUser).toBeUndefined();
      expect(put?.body?.basicPass).toBeUndefined();
      expect(put?.body?.version).toBe(1);
    });
  });

  test("a 409 on save shows the reload message", async () => {
    mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({ backends: [BACKEND], disabledBanner: null });
      return Response.json(
        { error: "changed by someone else, reload" },
        { status: 409 },
      );
    });

    render(<BackendsPage />);

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByText("Edit"));
    await userEvent.click(screen.getByText("Save"));

    expect(
      await screen.findByText("changed by someone else, reload"),
    ).toBeTruthy();
  });

  test("delete sends the current version and reloads the list", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({ backends: [BACKEND], disabledBanner: null });
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected ${call.method}`);
    });

    render(<BackendsPage />);

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByText("Delete"));

    await waitFor(() => {
      const del = calls.find((c) => c.method === "DELETE");
      expect(del?.url).toContain("version=1");
    });
  });
});
