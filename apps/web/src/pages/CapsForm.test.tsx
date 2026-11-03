// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, fireEvent, screen, waitFor } = await import(
  "@testing-library/react"
);
const { CapsForm } = await import("./CapsForm.js");
const { renderWithProviders } = await import("../test/render.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

const SETTINGS = {
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
  capsRevision: 7,
};

interface PutCall {
  url: string;
  body: Record<string, unknown>;
}

function mockPut(handler: (call: PutCall) => Response) {
  const calls: PutCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call: PutCall = {
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

function renderForm(onReload: () => Promise<typeof SETTINGS | undefined>) {
  return renderWithProviders(
    <CapsForm settings={SETTINGS} onReload={onReload} />,
  );
}

describe("CapsForm", () => {
  test("refuses 0 and saves 1–1,000", async () => {
    const calls = mockPut(() =>
      Response.json({ ...SETTINGS, dailyCap: 50, capsRevision: 8 }),
    );

    renderForm(() => Promise.resolve(undefined));

    const daily = screen.getByLabelText("Daily cap");
    fireEvent.change(daily, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/expected number to be/i)).toBeTruthy();
    expect(calls.length).toBe(0);

    fireEvent.change(daily, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]?.url).toContain("/api/admin/site-settings/caps");
    expect(calls[0]?.body).toEqual({
      revision: 7,
      dailyCap: 50,
      concurrentCap: 4,
    });
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  test("a 500 shows a save error", async () => {
    mockPut(() => Response.json({ error: "internal error" }, { status: 500 }));

    renderForm(() => Promise.resolve(undefined));

    fireEvent.change(screen.getByLabelText("Daily cap"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("internal error")).toBeTruthy();
  });
});
