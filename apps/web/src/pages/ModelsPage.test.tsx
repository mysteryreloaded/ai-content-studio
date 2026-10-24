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
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { MemoryRouter } = await import("react-router-dom");
const { ModelsPage } = await import("./ModelsPage.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

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

function renderPage() {
  return render(
    <MemoryRouter>
      <ModelsPage />
    </MemoryRouter>,
  );
}

async function createWithFile(
  view: ReturnType<typeof renderPage>,
  name: string,
) {
  const { default: userEvent } = await import("@testing-library/user-event");
  await view.findByText("New Model");
  await userEvent.click(view.getByText("New Model"));
  await userEvent.type(view.getByLabelText("Name"), name);
  const file = new File(['{"1":{"class_type":"X","inputs":{}}}'], "wf.json", {
    type: "application/json",
  });
  await userEvent.upload(
    view.getByLabelText("Workflow (API format JSON)"),
    file,
  );
  await userEvent.click(view.getByText("Create"));
}

describe("ModelsPage", () => {
  test("a create error from the server is shown", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return Response.json({ models: [] });
      if (call.method === "POST") {
        return Response.json(
          { error: "a Model with this name already exists" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderPage();
    await createWithFile(view, "LTX 2.5");

    expect(
      await view.findByText("a Model with this name already exists"),
    ).toBeTruthy();
  });

  test("an empty-key outside-service note is shown after creating", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return Response.json({ models: [] });
      if (call.method === "POST") {
        return Response.json(
          {
            model: {
              id: "m1",
              name: "LTX 2.5",
              slug: "ltx-2-5",
              state: "disabled",
              sortOrder: 0,
              currentRevision: 1,
              version: 1,
            },
            outsideServiceNotes: [
              { nodeId: "4", classType: "GemmaAPITextEncode", keySet: false },
            ],
          },
          { status: 201 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderPage();
    await createWithFile(view, "LTX 2.5");

    expect(
      await view.findByText(
        "GemmaAPITextEncode has no key set in the Workflow; set it on the Backend instead",
      ),
    ).toBeTruthy();
  });
});
