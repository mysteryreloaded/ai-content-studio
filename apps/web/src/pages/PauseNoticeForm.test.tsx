// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";
import type { AdminSiteSettings } from "./site-settings-shared.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { PauseNoticeForm, PauseControl, NoticeForm } = await import(
  "./PauseNoticeForm.js"
);
const { renderWithProviders } = await import("../test/render.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

const RUNNING_SETTINGS: AdminSiteSettings = {
  version: 1,
  title: "Studio",
  landingText: "",
  accent: "teal",
  signUpMode: "approval" as const,
  contact: "",
  footerLinks: [],
  logo: null,
  background: null,
  termsBody: "",
  termsVersion: null,
  termsVersionCreatedAt: null,
  termsRevision: 1,
  privacyBody: "",
  privacyUpdatedAt: null,
  privacyRevision: 1,
  blockedWords: [],
  blockedWordsRevision: 1,
  notice: "",
  noticeRevision: 1,
  paused: false,
  pausedAt: null,
  pausedByName: null,
  dailyCap: 20,
  concurrentCap: 4,
  capsRevision: 1,
};

const PAUSED_SETTINGS = {
  ...RUNNING_SETTINGS,
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

function renderForm(settings = RUNNING_SETTINGS) {
  return renderWithProviders(<PauseNoticeForm settings={settings} />);
}

describe("PauseNoticeForm", () => {
  test("shows Generating is running normally and a Pause button when not Paused", () => {
    renderForm(RUNNING_SETTINGS);

    expect(screen.getByText("Generating is running normally.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  test('shows "Paused since … by …" and a Resume button when Paused', () => {
    renderForm(PAUSED_SETTINGS);

    expect(screen.getByText(/^Paused since/)).toBeTruthy();
    expect(screen.getByText(/by Dev User/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  test("Pause posts to /pause and switches the button to Resume", async () => {
    // No `settings` prop here: `PauseControl` must react to its own
    // mutation's `setQueryData`, the same way it reacts to a parent
    // page's query once that page re-renders it with fresh `settings`.
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/api/admin/site-settings/pause")) {
        return Response.json(PAUSED_SETTINGS);
      }
      return Response.json(RUNNING_SETTINGS);
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    renderWithProviders(<PauseNoticeForm />);
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
    renderWithProviders(<PauseNoticeForm />);
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

    renderWithProviders(<PauseNoticeForm />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });

  test("PauseControl and NoticeForm render on their own", async () => {
    mockFetch(() => Response.json(RUNNING_SETTINGS));

    renderWithProviders(
      <>
        <PauseControl />
        <NoticeForm />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByText("Generating is running normally.")).toBeTruthy(),
    );
    expect(screen.getByLabelText("Notice")).toBeTruthy();
  });
});
