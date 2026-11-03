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
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { QueryClient } from "@tanstack/react-query";
import type { RenderResult } from "@testing-library/react";

await GlobalRegistrator.register();

export const { cleanup, fireEvent, waitFor, within } = await import(
  "@testing-library/react"
);
const { Link } = await import("react-router-dom");
const { ModelEditorPage } = await import("../ModelEditorPage.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "../../../test/render.js"
);

export const DETAIL = {
  model: {
    id: "m1",
    name: "LTX 2.5",
    slug: "ltx-2-5",
    description: "",
    maxRunTimeMinutes: 30,
    state: "disabled" as const,
    currentRevision: 1,
    version: 1,
    termsBody: "",
    licenseUrl: "",
    attribution: "",
    termsVersion: null,
    termsVersionCreatedAt: null,
    termsRevision: 1,
  },
  workflowHash: "hash1",
  workflow: {
    "1": { class_type: "LoadImage", inputs: {} },
    "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
  },
  nodes: [
    { id: "1", classType: "LoadImage", title: null },
    { id: "2", classType: "SaveImage", title: null },
  ],
  outsideServiceNotes: [],
  modes: [],
};

export const NO_BACKENDS = { backends: [] };

export interface AttachedBackendEntry {
  backend: { id: string; name: string; baseUrl: string };
  reachable: boolean;
  missingNodeTypes: string[] | null;
  note: string | null;
}

export interface FetchCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** `/api/admin/models/m1` gets the Model detail; every other GET (the Backends section's own two lookups) gets an empty list. */
export function respondGet(url: string): Response {
  if (url.endsWith("/api/admin/models/m1")) return Response.json(DETAIL);
  return Response.json(NO_BACKENDS);
}

export function mockFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
) {
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
export function renderEditor(): RenderResult & { queryClient: QueryClient } {
  return renderWithProviders(null, {
    route: "/admin/models/m1",
    routes: [
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
  });
}

/**
 * Issue #214's new flow for picking a Mode's output node: open the
 * Workflow section, pick the Mode in the Mode picker, select the node
 * row, then check "Use as an output of <mode>" in its inspector.
 */
export async function pickOutputNodeInWorkflow(
  view: RenderResult,
  modeName: string,
  nodeId: string,
) {
  const { default: userEvent } = await import("@testing-library/user-event");
  await openSection(view, "Workflow");
  const modePill = view.getByRole("button", {
    name: new RegExp(`^${modeName}`),
  });
  // Adding a Mode already picks it (editingModeIndex), so the pill may
  // already be pressed; only click it when it isn't.
  if (modePill.getAttribute("aria-pressed") !== "true") {
    await userEvent.click(modePill);
  }
  await userEvent.click(
    view.getByText(`#${nodeId}`).closest("button") as HTMLElement,
  );
  await userEvent.click(
    view.getByLabelText(new RegExp(`^Use as an output of ${modeName}`)),
  );
}

/** Issue #74: the editor opens the same per-user Generations stream the Workbench/Gallery do, to keep a Test's progress live. */
export class FakeEventSource {
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  constructor(public url: string) {}
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  close() {}
}

export let originalConfirm: typeof window.confirm;

export function prepareConfirmAndEventSource() {
  originalConfirm = window.confirm;
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
}

export function restoreConfirm() {
  window.confirm = originalConfirm;
}

/** Issue #213: sections render one at a time now, behind the section nav — tests switch to the one they need first. */
export async function openSection(
  view: RenderResult,
  label:
    | "Details"
    | "Workflow"
    | "Inputs"
    | "Modes"
    | "Backends"
    | "Terms and attribution"
    | "Test"
    | "Revisions",
) {
  const button = await view.findByRole("button", {
    name: new RegExp(`^${label}`),
  });
  fireEvent.click(button);
}

export async function finishFile() {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
}
