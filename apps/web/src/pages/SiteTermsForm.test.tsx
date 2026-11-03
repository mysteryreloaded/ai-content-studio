// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";
import type { AdminSiteSettings } from "./site-settings-shared.js";

const { cleanup, fireEvent, screen, waitFor } = await import(
  "@testing-library/react"
);
const { SiteTermsForm } = await import("./SiteTermsForm.js");
const { renderWithProviders } = await import("../test/render.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

const BASE_SETTINGS: AdminSiteSettings = {
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

function renderForm(
  settings: typeof BASE_SETTINGS,
  onReload: () => Promise<typeof BASE_SETTINGS | undefined> = () =>
    Promise.resolve(undefined),
) {
  return renderWithProviders(
    <SiteTermsForm settings={settings} onReload={onReload} />,
  );
}

describe("SiteTermsForm", () => {
  test("first-time terms show the note, not the checkbox", () => {
    renderForm(BASE_SETTINGS);

    fireEvent.change(screen.getByLabelText("Terms (Markdown)"), {
      target: { value: "Be nice." },
    });

    expect(
      screen.getByText(
        "Everyone will be asked to accept these terms at their next visit.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Ask everyone to accept again")).toBeNull();
  });

  test("changed terms offer ask-again and send it", async () => {
    const calls = mockPut(() =>
      Response.json({
        ...BASE_SETTINGS,
        termsBody: "New terms.",
        termsVersion: 2,
        termsRevision: 2,
      }),
    );

    renderForm({
      ...BASE_SETTINGS,
      termsBody: "Old terms.",
      termsVersion: 1,
      termsRevision: 5,
    });

    expect(
      screen.queryByText(
        "Everyone will be asked to accept these terms at their next visit.",
      ),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Terms (Markdown)"), {
      target: { value: "New terms." },
    });

    const checkboxLabel = await screen.findByText(
      "Ask everyone to accept again",
    );
    expect(checkboxLabel).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]?.url).toContain("/api/admin/site-settings/terms");
    expect(calls[0]?.body).toEqual({
      revision: 5,
      body: "New terms.",
      askAgain: true,
    });
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });
});
