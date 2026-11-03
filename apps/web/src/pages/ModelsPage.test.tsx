// A DOM is registered only for this file's run (not the shared
// ../test/happy-dom-setup.ts, which restores Bun's own File so the
// server's tests keep working): `userEvent.upload` needs happy-dom's
// own `File` class for an `<input type="file">`'s `files` setter to
// accept it, so this file keeps its own register/unregister instead
// (`bun test --isolate` keeps that from colliding with another file's
// registration).
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, within, waitFor } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { Toaster } = await import("../components/ui/sonner.js");
const { ModelsPage } = await import("./ModelsPage.js");
const { renderWithProviders } = await import("../test/render.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

interface FetchCall {
  method: string;
  url: string;
  body: unknown;
}

interface MockModel {
  id: string;
  name: string;
  slug: string;
  state: "enabled" | "disabled";
  sortOrder: number;
  currentRevision: number;
  version: number;
  modeCount: number;
  backends: { usable: number; attached: number };
  modesWithoutBackend: string[];
  queued: number;
  running: number;
}

function model(
  overrides: Partial<MockModel> & { id: string; name: string },
): MockModel {
  return {
    slug: overrides.id,
    state: "enabled",
    sortOrder: 0,
    currentRevision: 1,
    version: 1,
    modeCount: 1,
    backends: { usable: 1, attached: 1 },
    modesWithoutBackend: [],
    queued: 0,
    running: 0,
    ...overrides,
  };
}

function mockFetch(
  handler: (call: FetchCall) => Response | Promise<Response> | undefined,
) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call: FetchCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const result = handler(call);
    if (result === undefined)
      throw new Error(`unexpected ${call.method} ${url}`);
    return result;
  }) as typeof fetch;
  return calls;
}

function renderPage() {
  return renderWithProviders(
    <>
      <Toaster />
      <ModelsPage />
    </>,
    {
      route: "/admin/models",
      routes: [
        {
          path: "/admin/models",
          element: (
            <>
              <Toaster />
              <ModelsPage />
            </>
          ),
        },
        { path: "/admin/models/:id", element: <p>Model editor</p> },
      ],
    },
  );
}

function jsonFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value)], name, {
    type: "application/json",
  });
}

const API_WORKFLOW = { "1": { class_type: "X", inputs: {} } };

async function openNewModelDialog(view: ReturnType<typeof renderPage>) {
  const buttons = await view.findAllByText("New Model");
  await userEvent.click(buttons[0] as HTMLElement);
}

describe("ModelsPage", () => {
  test("a create error from the server is shown", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return Response.json({ models: [] });
      if (call.method === "POST" && call.url.endsWith("/api/admin/models")) {
        return Response.json(
          { error: "a Model with this name already exists" },
          { status: 409 },
        );
      }
      return undefined;
    });

    const view = renderPage();
    await openNewModelDialog(view);
    await userEvent.type(view.getByLabelText("Name"), "LTX 2.5");
    await userEvent.upload(
      view.getByLabelText("Workflow file"),
      jsonFile("wf.json", API_WORKFLOW),
    );
    await userEvent.click(view.getByText("Create"));

    expect(
      await view.findByText("a Model with this name already exists"),
    ).toBeTruthy();
  });

  test("creating navigates to the new Model's editor", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return Response.json({ models: [] });
      if (call.method === "POST" && call.url.endsWith("/api/admin/models")) {
        return Response.json(
          { model: { id: "m1" }, outsideServiceNotes: [] },
          { status: 201 },
        );
      }
      return undefined;
    });

    const view = renderPage();
    await openNewModelDialog(view);
    await userEvent.type(view.getByLabelText("Name"), "LTX 2.5");
    await userEvent.upload(
      view.getByLabelText("Workflow file"),
      jsonFile("wf.json", API_WORKFLOW),
    );
    await userEvent.click(view.getByText("Create"));

    expect(await view.findByText("Model editor")).toBeTruthy();
  });

  test("a UI save is refused before upload", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return Response.json({ models: [] });
      return undefined;
    });

    const view = renderPage();
    await openNewModelDialog(view);
    await userEvent.type(view.getByLabelText("Name"), "LTX 2.5");
    await userEvent.upload(
      view.getByLabelText("Workflow file"),
      jsonFile("wf.json", { nodes: [], links: [] }),
    );
    await userEvent.click(view.getByText("Create"));

    expect(
      await view.findByText("This is a UI save; export it with Export (API)"),
    ).toBeTruthy();
  });

  test("a Workflow holding a key is refused with the agreed message", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return Response.json({ models: [] });
      return undefined;
    });

    const view = renderPage();
    await openNewModelDialog(view);
    await userEvent.type(view.getByLabelText("Name"), "LTX 2.5");
    await userEvent.upload(
      view.getByLabelText("Workflow file"),
      jsonFile("wf.json", {
        "4": {
          class_type: "GemmaAPITextEncode",
          inputs: { api_key: "secret" },
          _meta: { title: "Gemma" },
        },
      }),
    );
    await userEvent.click(view.getByText("Create"));

    expect(
      await view.findByText(
        "Gemma holds an API key; clear it in ComfyUI and export again",
      ),
    ).toBeTruthy();
  });

  test("import shows the toast and the new row", async () => {
    let imported = false;
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models")) {
        return Response.json({
          models: imported ? [model({ id: "m1", name: "Imported Model" })] : [],
        });
      }
      if (call.method === "POST" && call.url.endsWith("/import")) {
        imported = true;
        return Response.json(
          {
            model: { id: "m1", name: "Imported Model" },
            outsideServiceNotes: [],
          },
          { status: 201 },
        );
      }
      return undefined;
    });

    const view = renderPage();
    await userEvent.click(await view.findByText("Import"));
    await userEvent.upload(
      view.getByLabelText("Exported Model file (JSON)"),
      jsonFile("export.json", { model: {}, revision: {} }),
    );
    const dialog = view.getByRole("dialog");
    await userEvent.click(within(dialog).getByText("Import"));

    expect(
      await view.findByText("Imported Imported Model as a disabled Model."),
    ).toBeTruthy();
    expect(
      await within(view.getByTestId("models-table-desktop")).findByText(
        "Imported Model",
      ),
    ).toBeTruthy();
  });

  test("rows show Mode count, usable Backends and queued/running links", async () => {
    mockFetch((call) => {
      if (call.method === "GET") {
        return Response.json({
          models: [
            model({
              id: "m1",
              name: "Alpha",
              modeCount: 3,
              backends: { usable: 2, attached: 2 },
              queued: 3,
              running: 1,
            }),
          ],
        });
      }
      return undefined;
    });

    const view = renderPage();
    await view.findAllByText("Alpha");
    const table = within(view.getByTestId("models-table-desktop"));

    expect(table.getByText("3 Modes")).toBeTruthy();
    expect(table.getByText("2 of 2")).toBeTruthy();
    expect(
      table.getByRole("link", { name: "3 queued" }).getAttribute("href"),
    ).toBe("/admin/generations?model=m1&status=queued");
    expect(
      table.getByRole("link", { name: "1 running" }).getAttribute("href"),
    ).toBe("/admin/generations?model=m1&status=running");
  });

  test("a Mode with no usable Backend is flagged", async () => {
    mockFetch((call) => {
      if (call.method === "GET") {
        return Response.json({
          models: [
            model({
              id: "m1",
              name: "Alpha",
              modesWithoutBackend: ["Upscale"],
            }),
          ],
        });
      }
      return undefined;
    });

    const view = renderPage();
    await view.findAllByText("Alpha");

    expect(
      within(view.getByTestId("models-table-desktop")).getByText(
        "Upscale has no usable Backend",
      ),
    ).toBeTruthy();
  });

  test("moves a Model down and shows the new order", async () => {
    let order = ["m1", "m2"];
    const byId: Record<string, MockModel> = {
      m1: model({ id: "m1", name: "Alpha", sortOrder: 0 }),
      m2: model({ id: "m2", name: "Beta", sortOrder: 1 }),
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models")) {
        return Response.json({ models: order.map((id) => byId[id]) });
      }
      if (call.method === "POST" && call.url.endsWith("/move-down")) {
        order = ["m2", "m1"];
        return Response.json({
          models: order.map((id) => {
            const {
              modeCount,
              backends,
              modesWithoutBackend,
              queued,
              running,
              ...rest
            } = byId[id] as MockModel;
            void [modeCount, backends, modesWithoutBackend, queued, running];
            return rest;
          }),
        });
      }
      return undefined;
    });

    function namesInOrder() {
      return within(view.getByTestId("models-table-desktop"))
        .getAllByRole("link")
        .map((link) => link.textContent)
        .filter((text) => text === "Alpha" || text === "Beta");
    }

    const view = renderPage();
    await view.findAllByText("Alpha");
    expect(namesInOrder()).toEqual(["Alpha", "Beta"]);

    const table = within(view.getByTestId("models-table-desktop"));
    await userEvent.click(table.getByLabelText("Move Alpha down"));

    await waitFor(() => expect(namesInOrder()).toEqual(["Beta", "Alpha"]));
  });
});
