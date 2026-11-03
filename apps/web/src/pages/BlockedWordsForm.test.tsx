// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, fireEvent, screen, waitFor } = await import(
  "@testing-library/react"
);
const { BlockedWordsForm } = await import("./BlockedWordsForm.js");
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
  blockedWords: ["foo", "bar"],
  blockedWordsRevision: 3,
  notice: "",
  noticeRevision: 1,
  paused: false,
  pausedAt: null,
  pausedByName: null,
  dailyCap: 20,
  concurrentCap: 4,
  capsRevision: 1,
};

function mockPut() {
  const calls: { url: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push({ url: typeof input === "string" ? input : input.toString() });
    return Response.json(SETTINGS);
  }) as typeof fetch;
  return calls;
}

function renderForm() {
  return renderWithProviders(
    <BlockedWordsForm
      settings={SETTINGS}
      onReload={() => Promise.resolve(undefined)}
    />,
  );
}

describe("BlockedWordsForm", () => {
  test("counts entries and blocks saving past 1,000", async () => {
    const calls = mockPut();
    renderForm();

    expect(screen.getByText("2 of 1,000 entries")).toBeTruthy();

    const words = Array.from({ length: 1001 }, (_, i) => `word${i}`).join("\n");
    fireEvent.change(screen.getByLabelText("Blocked words and phrases"), {
      target: { value: words },
    });

    expect(screen.getByText("1,001 of 1,000 entries")).toBeTruthy();
    expect(screen.getByText("at most 1000 entries are allowed")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.length).toBe(0));
  });
});
