// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, fireEvent, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { SiteSettingsPage } = await import("./SiteSettingsPage.js");
const { renderWithProviders } = await import("../test/render.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

const FULL_SETTINGS = {
  version: 3,
  title: "My Studio",
  landingText: "",
  accent: "teal",
  signUpMode: "approval" as const,
  contact: "",
  footerLinks: [],
  logo: null,
  background: null,
  dailyCap: 20,
  concurrentCap: 4,
  capsRevision: 1,
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
};

interface FetchCall {
  method: string;
  url: string;
}

/** Every panel shares `/api/admin/site-settings`: `SiteSettingsForm` and `CapsForm` behind the page's one `useQuery`, and (until #202) the four untouched text forms each with their own `fetch`. */
function mockFetch() {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url });
    return Response.json(FULL_SETTINGS);
  }) as typeof fetch;
  return calls;
}

function renderPage() {
  return renderWithProviders(<SiteSettingsPage />, {
    route: "/admin/settings",
  });
}

describe("SiteSettingsPage", () => {
  test("fetches the settings once and shows every section", async () => {
    const calls = mockFetch();

    renderPage();

    expect(await screen.findByDisplayValue("My Studio")).toBeTruthy();

    for (const heading of [
      "Branding",
      "Accent colour",
      "Sign-up and Caps",
      "Contact and footer",
      "Blocked words",
      "Site terms",
      "Privacy policy",
      "Notice",
    ]) {
      // The section nav repeats each label as a plain link, so this
      // looks for the section's own `<h2>` instead of any match.
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }

    // `SiteSettingsForm` and `CapsForm` consume one shared query instead of
    // each fetching on their own: only the untouched text forms (#202) and
    // the page's single query ever call the GET, so the exact-path GET
    // never fires more than once per panel that still fetches on its own.
    const siteSettingsGets = calls.filter(
      (call) =>
        call.method === "GET" && call.url === "/api/admin/site-settings",
    );
    await waitFor(() => {
      expect(siteSettingsGets.length).toBeGreaterThan(0);
    });
    // 1 shared query (Branding/Accent/Sign-up/Caps/Contact-footer) + 4
    // untouched text forms each fetching on their own = 5, not 6: the old
    // page fetched once per of its six panels.
    expect(siteSettingsGets.length).toBe(5);
  });

  test("after a caps save bumps the version in the cache, the branding PUT still sends the original version", async () => {
    const puts: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return Response.json(FULL_SETTINGS);
      puts.push({ url, init });
      if (url === "/api/admin/site-settings/caps") {
        // Another admin's caps save, seen through this page's one shared
        // query cache: it bumps `version` too, simulating cache drift
        // unrelated to this admin's own branding baseline.
        return Response.json({
          ...FULL_SETTINGS,
          version: 99,
          capsRevision: 2,
          dailyCap: 30,
        });
      }
      return Response.json({ ...FULL_SETTINGS, title: "New title" });
    }) as typeof fetch;

    renderPage();

    await screen.findByDisplayValue("My Studio");

    fireEvent.change(screen.getByLabelText("Daily cap"), {
      target: { value: "30" },
    });
    const capsSection = screen
      .getByRole("heading", { name: "Sign-up and Caps" })
      .closest("section");
    if (!capsSection) throw new Error("no Sign-up and Caps section found");
    fireEvent.click(within(capsSection).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        puts.some((call) => call.url === "/api/admin/site-settings/caps"),
      ).toBe(true),
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New title" },
    });
    const contactSection = screen
      .getByRole("heading", { name: "Contact and footer" })
      .closest("section");
    if (!contactSection) throw new Error("no Contact and footer section found");
    fireEvent.click(
      within(contactSection).getByRole("button", { name: "Save" }),
    );

    await waitFor(() =>
      expect(puts.some((call) => call.url === "/api/admin/site-settings")).toBe(
        true,
      ),
    );
    const brandingPut = puts.find(
      (call) => call.url === "/api/admin/site-settings",
    );
    const body = brandingPut?.init?.body as FormData;
    expect(body.get("version")).toBe("3");
  });

  test("History links to the Site settings Audit entries", async () => {
    mockFetch();

    renderPage();

    await screen.findByDisplayValue("My Studio");

    // PauseNoticeForm (unchanged, #202) carries its own History link too
    // (same URL twice, per issue #201's "gaps"), so at least one — the
    // page header's — must point at the Site settings Audit entries.
    const historyLinks = screen.getAllByRole("link", { name: "History" });
    expect(
      historyLinks.some(
        (link) =>
          link.getAttribute("href") ===
          "/admin/audit?targetType=site_settings&targetId=singleton",
      ),
    ).toBe(true);
  });
});
