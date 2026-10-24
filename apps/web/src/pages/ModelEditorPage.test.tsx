// A DOM is registered only for this file's run (not a global preload),
// since bun test runs every file in one process and other files (the
// server's, and this workspace's other page tests) must keep their own
// fetch/Response and document untouched. It must be registered before
// @testing-library/react is imported, since that module binds its
// `screen` helper to `document.body` at import time — and since several
// page test files now share one process, this file never uses that
// global `screen` (it would still point at whichever file's document
// happened to import the module first): every query below is bound to
// this render's own result instead.
//
// That's not enough on its own: react-dom's scheduler is also cached
// once per process, bound to whichever happy-dom window was global when
// react-dom first loaded. Once an earlier file's `unregister()` closes
// that window, state updates in every later file's React tree stop
// flushing to the DOM. `bun test --isolate` (root package.json's `test`
// script, and CI) gives every test file its own fresh global object,
// which is what actually fixes that — this file's own register/unregister
// dance only keeps the server's test files free of happy-dom globals.
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { Link, RouterProvider, createMemoryRouter } = await import(
  "react-router-dom"
);
const { ModelEditorPage } = await import("./ModelEditorPage.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const DETAIL = {
  model: {
    id: "m1",
    name: "LTX 2.5",
    slug: "ltx-2-5",
    description: "",
    maxRunTimeMinutes: 30,
    state: "disabled" as const,
    currentRevision: 1,
    version: 1,
  },
  workflowHash: "hash1",
  nodes: [{ id: "1", classType: "LoadImage", title: null }],
  outsideServiceNotes: [],
};

const NO_BACKENDS = { backends: [] };

interface AttachedBackendEntry {
  backend: { id: string; name: string; baseUrl: string };
  reachable: boolean;
  missingNodeTypes: string[] | null;
  note: string | null;
}

interface FetchCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** `/api/admin/models/m1` gets the Model detail; every other GET (the Backends section's own two lookups) gets an empty list. */
function respondGet(url: string): Response {
  if (url.endsWith("/api/admin/models/m1")) return Response.json(DETAIL);
  return Response.json(NO_BACKENDS);
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

/** Mirrors AdminShell's own nav link, alongside the editor, so a blocked click can be exercised. */
function renderEditor() {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/models/:id",
        element: (
          <>
            <Link to="/admin/models">Models</Link>
            <ModelEditorPage />
          </>
        ),
      },
      { path: "/admin/models", element: <p>Models list</p> },
    ],
    { initialEntries: ["/admin/models/m1"] },
  );
  return render(<RouterProvider router={router} />);
}

let originalConfirm: typeof window.confirm;

beforeEach(() => {
  originalConfirm = window.confirm;
});

afterEach(() => {
  window.confirm = originalConfirm;
});

describe("ModelEditorPage", () => {
  test("a taken slug on save shows the server's own message, not the generic reload one", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT") {
        return Response.json(
          { error: "a Model with this slug already exists" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Save"));

    expect(
      await view.findByText("a Model with this slug already exists"),
    ).toBeTruthy();
    expect(view.queryByText("changed by someone else, reload")).toBeNull();
  });

  test("a stale version on save shows the reload message", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT") {
        return Response.json(
          { error: "changed by someone else, reload" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Save"));

    expect(
      await view.findByText("changed by someone else, reload"),
    ).toBeTruthy();
  });

  test("clicking a nav link while dirty asks first, and staying cancels the navigation", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method}`);
    });
    let confirmed = false;
    window.confirm = () => {
      confirmed = true;
      return false;
    };

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Models"));

    expect(confirmed).toBe(true);
    expect(view.queryByText("Models list")).toBeNull();
  });

  test("confirming the nav-link prompt navigates away", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method}`);
    });
    window.confirm = () => true;

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Models"));

    expect(await view.findByText("Models list")).toBeTruthy();
  });

  test("delete with unsaved Details changes confirms exactly once, not a second time for the navigation", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected ${call.method}`);
    });
    let confirmCount = 0;
    window.confirm = () => {
      confirmCount += 1;
      return true;
    };

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await view.findByLabelText("Slug");
    await userEvent.type(view.getByLabelText("Slug"), "x");
    await userEvent.click(view.getByText("Delete"));

    expect(await view.findByText("Models list")).toBeTruthy();
    expect(confirmCount).toBe(1);
    await waitFor(() => {
      const del = calls.find((c) => c.method === "DELETE");
      expect(del?.url).toContain("version=1");
    });
  });

  test("delete shows the server's error on a stale version and stays put", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "DELETE")
        return Response.json(
          { error: "changed by someone else, reload" },
          { status: 409 },
        );
      throw new Error(`unexpected ${call.method}`);
    });
    window.confirm = () => true;

    const view = renderEditor();

    await view.findByText("LTX 2.5");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByText("Delete"));

    expect(
      await view.findByText("changed by someone else, reload"),
    ).toBeTruthy();
    expect(view.queryByText("Models list")).toBeNull();
  });

  test("Backends section lists an attached Backend's missing node types, and attaches another one", async () => {
    const BACKEND_A = { id: "b1", name: "GPU 1", baseUrl: "http://gpu1" };
    const BACKEND_B = { id: "b2", name: "GPU 2", baseUrl: "http://gpu2" };
    let attached: AttachedBackendEntry[] = [
      {
        backend: BACKEND_A,
        reachable: true,
        missingNodeTypes: ["SomeNode"],
        note: null,
      },
    ];

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL);
      if (
        call.method === "GET" &&
        call.url.endsWith("/api/admin/models/m1/backends")
      )
        return Response.json({ backends: attached });
      if (call.method === "GET" && call.url.endsWith("/api/admin/backends"))
        return Response.json({ backends: [BACKEND_A, BACKEND_B] });
      if (call.method === "POST" && call.url.includes("/backends")) {
        attached = [
          ...attached,
          {
            backend: BACKEND_B,
            reachable: false,
            missingNodeTypes: null,
            note: "unreachable; can't check for missing node types",
          },
        ];
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();

    expect(await view.findByText("GPU 1")).toBeTruthy();
    expect(view.getByText("SomeNode")).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.selectOptions(
      view.getByLabelText("Attach a Backend"),
      "b2",
    );
    await userEvent.click(view.getByText("Attach"));

    expect(
      await view.findByText("unreachable; can't check for missing node types"),
    ).toBeTruthy();
    expect(
      calls.some((c) => c.method === "POST" && c.body?.backendId === "b2"),
    ).toBe(true);
  });

  test("detaching the only Backend empties the Backends section", async () => {
    const BACKEND_A = { id: "b1", name: "GPU 1", baseUrl: "http://gpu1" };
    let attached = [
      {
        backend: BACKEND_A,
        reachable: true,
        missingNodeTypes: [],
        note: null,
      },
    ];

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL);
      if (
        call.method === "GET" &&
        call.url.endsWith("/api/admin/models/m1/backends")
      )
        return Response.json({ backends: attached });
      if (call.method === "GET" && call.url.endsWith("/api/admin/backends"))
        return Response.json({ backends: [BACKEND_A] });
      if (call.method === "DELETE" && call.url.includes("/backends/")) {
        attached = [];
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();

    expect(await view.findByText("GPU 1")).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByText("Detach"));

    expect(await view.findByText("No Backends attached.")).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });
});
