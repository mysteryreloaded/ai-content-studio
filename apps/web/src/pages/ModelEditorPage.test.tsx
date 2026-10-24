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
      if (call.method === "GET") return Response.json(DETAIL);
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
      if (call.method === "GET") return Response.json(DETAIL);
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
      if (call.method === "GET") return Response.json(DETAIL);
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
      if (call.method === "GET") return Response.json(DETAIL);
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
      if (call.method === "GET") return Response.json(DETAIL);
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
      if (call.method === "GET") return Response.json(DETAIL);
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
});
