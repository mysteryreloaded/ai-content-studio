// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, render, screen } = await import("@testing-library/react");
const { MemoryRouter } = await import("react-router-dom");
const { PauseNoticeForm } = await import("./PauseNoticeForm.js");

function renderForm() {
  return render(
    <MemoryRouter>
      <PauseNoticeForm />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

const RUNNING_SETTINGS = {
  notice: "",
  noticeRevision: 1,
  paused: false,
  pausedAt: null,
  pausedByName: null,
};

const PAUSED_SETTINGS = {
  notice: "",
  noticeRevision: 1,
  paused: true,
  pausedAt: "2026-01-02T03:04:00.000Z",
  pausedByName: "Dev User",
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

describe("PauseNoticeForm", () => {
  test("shows Generating is running normally and a Pause button when not Paused", async () => {
    mockFetch(() => Response.json(RUNNING_SETTINGS));

    renderForm();

    expect(
      await screen.findByText("Generating is running normally."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  test('shows "Paused since … by …" and a Resume button when Paused', async () => {
    mockFetch(() => Response.json(PAUSED_SETTINGS));

    renderForm();

    expect(
      await screen.findByText((text) => text.startsWith("Paused since")),
    ).toBeTruthy();
    expect(await screen.findByText(/by Dev User/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  test("Pause posts to /pause and switches the button to Resume", async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/api/admin/site-settings/pause")) {
        return Response.json(PAUSED_SETTINGS);
      }
      return Response.json(RUNNING_SETTINGS);
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    renderForm();
    await screen.findByRole("button", { name: "Pause" });

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          call.url.endsWith("/api/admin/site-settings/pause"),
      ),
    ).toBe(true);
  });

  test("Resume posts to /resume and switches the button back to Pause", async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/api/admin/site-settings/resume")) {
        return Response.json(RUNNING_SETTINGS);
      }
      return Response.json(PAUSED_SETTINGS);
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    renderForm();
    await screen.findByRole("button", { name: "Resume" });

    await userEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(await screen.findByRole("button", { name: "Pause" })).toBeTruthy();
    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          call.url.endsWith("/api/admin/site-settings/resume"),
      ),
    ).toBe(true);
  });

  test("stays on Loading… (never crashes) when the GET isn't ok", async () => {
    mockFetch(() => new Response(null, { status: 500 }));

    renderForm();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});
