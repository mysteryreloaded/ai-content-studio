// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { renderWithProviders } = await import("../test/render.js");
const { BackendsPage, isOlderThanTested, TESTED_COMFYUI_VERSION } =
  await import("./BackendsPage.js");

function renderPage() {
  return renderWithProviders(<BackendsPage />);
}

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

const BACKEND = {
  id: "b1",
  name: "GPU 1",
  baseUrl: "http://10.0.0.5:8188",
  auth: "none" as const,
  headerName: null,
  enabled: true,
  draining: false,
  version: 1,
  health: {
    reachability: "reachable" as const,
    comfyuiVersion: "0.26.2",
    vramTotal: 24 * 1024 ** 3,
    vramFree: 20 * 1024 ** 3,
    credentialsError: false,
  },
  unreachableSince: null,
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

describe("isOlderThanTested", () => {
  test(`is false for the tested version itself (${TESTED_COMFYUI_VERSION})`, () => {
    expect(isOlderThanTested(TESTED_COMFYUI_VERSION)).toBe(false);
    expect(isOlderThanTested(`v${TESTED_COMFYUI_VERSION}`)).toBe(false);
  });

  test("is true for an older patch, minor or major version", () => {
    expect(isOlderThanTested("0.26.1")).toBe(true);
    expect(isOlderThanTested("0.25.9")).toBe(true);
    expect(isOlderThanTested("v0.25.9")).toBe(true);
  });

  test("is false for a newer version", () => {
    expect(isOlderThanTested("0.27.0")).toBe(false);
    expect(isOlderThanTested("1.0.0")).toBe(false);
  });
});

describe("BackendsPage", () => {
  test("lists Backends with health, ComfyUI version and VRAM", async () => {
    mockFetch(() =>
      Response.json({ backends: [BACKEND], disabledBanner: null }),
    );

    renderPage();

    expect(await screen.findByText("GPU 1")).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(
      screen.getByText("ComfyUI v0.26.2 · 20.0 of 24.0 GiB free"),
    ).toBeTruthy();
  });

  test("shows the checking and unreachable states too", async () => {
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
            unreachableSince: "2026-01-01T14:02:00.000Z",
          },
        ],
        disabledBanner: null,
      }),
    );

    renderPage();

    await screen.findByText("Unknown one");
    expect(screen.getByText("Checking…")).toBeTruthy();
    expect(screen.getByText(/^Unreachable since /)).toBeTruthy();
  });

  test("shows unreachable since the server's timestamp", async () => {
    mockFetch(() =>
      Response.json({
        backends: [
          {
            ...BACKEND,
            health: { ...BACKEND.health, reachability: "unreachable" },
            unreachableSince: "2026-01-01T14:02:00.000Z",
          },
        ],
        disabledBanner: null,
      }),
    );

    renderPage();

    expect(
      await screen.findByText(
        `Unreachable since ${new Date("2026-01-01T14:02:00.000Z").getHours().toString().padStart(2, "0")}:02`,
      ),
    ).toBeTruthy();
  });

  test("warns when ComfyUI is older than the tested version", async () => {
    mockFetch(() =>
      Response.json({
        backends: [
          {
            ...BACKEND,
            health: { ...BACKEND.health, comfyuiVersion: "0.25.1" },
          },
        ],
        disabledBanner: null,
      }),
    );

    renderPage();

    expect(
      await screen.findByText(
        `ComfyUI v0.25.1 is older than the tested v${TESTED_COMFYUI_VERSION}.`,
      ),
    ).toBeTruthy();
  });

  test("re-enter credentials opens the edit sheet", async () => {
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
            unreachableSince: "2026-01-01T14:02:00.000Z",
          },
        ],
        disabledBanner: null,
      }),
    );

    const { default: userEvent } = await import("@testing-library/user-event");
    renderPage();

    const reenterButton = await screen.findByRole("button", {
      name: "Re-enter credentials",
    });
    await userEvent.click(reenterButton);

    expect(await screen.findByText("Edit GPU 1")).toBeTruthy();
    expect(
      screen.getByText(
        "These credentials no longer decrypt. Enter them again.",
      ),
    ).toBeTruthy();
  });

  test("shows the BACKENDS_ENABLED banner when the server sends one", async () => {
    mockFetch(() =>
      Response.json({
        backends: [],
        disabledBanner: "Backend contact is disabled",
      }),
    );

    renderPage();

    expect(await screen.findByText("Backend contact is disabled")).toBeTruthy();
  });

  test("links to the Audit page, filtered to this Backend", async () => {
    mockFetch(() =>
      Response.json({ backends: [BACKEND], disabledBanner: null }),
    );

    renderPage();

    const link = (await screen.findByText("History")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/admin/audit?targetType=backend&targetId=b1",
    );
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
    renderPage();

    await screen.findByText("New Backend");
    await userEvent.click(screen.getByText("New Backend"));
    await userEvent.type(screen.getByLabelText("Name"), "New GPU");
    await userEvent.type(
      screen.getByLabelText("Address"),
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

    renderPage();

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByText("Edit"));
    await screen.findByText("Edit GPU 1");
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

    renderPage();

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByText("Edit"));
    await screen.findByText("Edit GPU 1");
    await userEvent.click(screen.getByText("Save"));

    expect(
      await screen.findByText("changed by someone else, reload"),
    ).toBeTruthy();
  });

  test("delete shows the server's refusal", async () => {
    mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({ backends: [BACKEND], disabledBanner: null });
      if (call.method === "DELETE") {
        return Response.json(
          { error: "has unfinished Generations" },
          {
            status: 409,
          },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    renderPage();

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByText("Delete"));
    await screen.findByText("Delete GPU 1?");
    await userEvent.click(screen.getAllByText("Delete")[1] as HTMLElement);

    expect(await screen.findByText("has unfinished Generations")).toBeTruthy();
  });

  test("a blank re-enter-credentials save shows field errors and sends no PUT", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({
          backends: [
            {
              ...BACKEND,
              auth: "basic" as const,
              health: {
                ...BACKEND.health,
                reachability: "unreachable",
                credentialsError: true,
              },
            },
          ],
          disabledBanner: null,
        });
      throw new Error(`unexpected ${call.method}`);
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    renderPage();

    const reenterButton = await screen.findByRole("button", {
      name: "Re-enter credentials",
    });
    await userEvent.click(reenterButton);
    await screen.findByText("Edit GPU 1");

    await userEvent.click(screen.getByText("Save"));

    expect(
      await screen.findByText(
        "username and password are required for basic auth",
      ),
    ).toBeTruthy();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  test("drain switch patches draining", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({ backends: [BACKEND], disabledBanner: null });
      if (call.method === "PATCH") return Response.json(BACKEND);
      throw new Error(`unexpected ${call.method}`);
    });

    renderPage();

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByLabelText("Drain"));

    await waitFor(() => {
      const patch = calls.find(
        (c) => c.method === "PATCH" && c.url.includes("/draining"),
      );
      expect(patch).toBeTruthy();
      expect(patch?.body?.draining).toBe(true);
      expect(patch?.body?.version).toBe(1);
    });
  });

  test("a 409 on the Enabled switch shows the reload message", async () => {
    mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({ backends: [BACKEND], disabledBanner: null });
      if (call.method === "PATCH") {
        return Response.json(
          { error: "changed by someone else, reload" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    renderPage();

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByLabelText("Enabled"));

    expect(
      await screen.findByText("changed by someone else, reload"),
    ).toBeTruthy();
  });

  test("a non-409 error on the Drain switch shows a generic error", async () => {
    mockFetch((call) => {
      if (call.method === "GET")
        return Response.json({ backends: [BACKEND], disabledBanner: null });
      if (call.method === "PATCH") {
        return Response.json({ error: "boom" }, { status: 500 });
      }
      throw new Error(`unexpected ${call.method}`);
    });

    renderPage();

    await screen.findByText("GPU 1");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByLabelText("Drain"));

    expect(await screen.findByText("could not update")).toBeTruthy();
  });
});
