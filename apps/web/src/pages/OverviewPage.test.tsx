// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";
import type { AdminSiteSettings } from "./site-settings-shared.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { renderWithProviders } = await import("../test/render.js");
const { OverviewPage } = await import("./OverviewPage.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

const SETTINGS: AdminSiteSettings = {
  version: 1,
  title: "Studio",
  landingText: "",
  accent: "teal",
  signUpMode: "approval",
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

function overview(overrides: Record<string, unknown> = {}) {
  return {
    problems: [],
    backends: [],
    models: [],
    disabledBanner: null,
    disk: { freeGb: 100, minFreeDiskGb: 10 },
    errors24h: 0,
    version: "1.0.0",
    uptimeSeconds: 3 * 3600 + 12 * 60,
    ...overrides,
  };
}

interface FetchCall {
  url: string;
}

function mockFetch(
  overviewBody: ReturnType<typeof overview>,
  settingsBody: AdminSiteSettings = SETTINGS,
) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url });
    if (url.includes("/api/admin/overview")) {
      return Response.json(overviewBody);
    }
    if (url.includes("/api/admin/site-settings")) {
      return Response.json(settingsBody);
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return calls;
}

describe("OverviewPage", () => {
  test("shows each Problem with its time and link", async () => {
    const since = new Date().toISOString();
    mockFetch(
      overview({
        problems: [
          {
            code: "backend_unreachable",
            message: 'Backend "GPU 1" has been unreachable since …',
            target: "b1",
            since,
          },
        ],
      }),
    );

    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText(/has been unreachable since/)).toBeTruthy();
    expect(screen.getByText(/^since /)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Backends" });
    expect(link.getAttribute("href")).toBe("/admin/backends");
  });

  test("links queued and running counts to filtered Admin Generations", async () => {
    mockFetch(
      overview({
        models: [
          {
            id: "m1",
            name: "LTX 2.5",
            slug: "ltx-2-5",
            enabled: true,
            queued: 3,
            running: 1,
            oldestQueuedAt: null,
            medianWait24hMs: null,
            usableBackends: 1,
            attachedBackends: 1,
          },
        ],
      }),
    );

    renderWithProviders(<OverviewPage />);

    const queuedLink = await screen.findByRole("link", { name: "3" });
    expect(queuedLink.getAttribute("href")).toBe(
      "/admin/generations?model=m1&status=queued",
    );
    const runningLink = screen.getByRole("link", { name: "1" });
    expect(runningLink.getAttribute("href")).toBe(
      "/admin/generations?model=m1&status=running",
    );
  });

  test("writes usable Backends as N of M", async () => {
    mockFetch(
      overview({
        models: [
          {
            id: "m1",
            name: "LTX 2.5",
            slug: "ltx-2-5",
            enabled: true,
            queued: 0,
            running: 0,
            oldestQueuedAt: null,
            medianWait24hMs: null,
            usableBackends: 1,
            attachedBackends: 2,
          },
          {
            id: "m2",
            name: "SDXL",
            slug: "sdxl",
            enabled: true,
            queued: 0,
            running: 0,
            oldestQueuedAt: null,
            medianWait24hMs: null,
            usableBackends: 0,
            attachedBackends: 2,
          },
        ],
      }),
    );

    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText("1 of 2")).toBeTruthy();
    expect(screen.getByText("0 of 2")).toBeTruthy();
  });

  test("names each Backend state", async () => {
    mockFetch(
      overview({
        backends: [
          {
            id: "b1",
            name: "Idle One",
            enabled: true,
            draining: false,
            health: {
              reachability: "reachable",
              comfyuiVersion: "0.26.2",
              vramTotal: null,
              vramFree: null,
              credentialsError: false,
            },
            unreachableSince: null,
            running: null,
          },
          {
            id: "b2",
            name: "Draining One",
            enabled: true,
            draining: true,
            health: {
              reachability: "reachable",
              comfyuiVersion: null,
              vramTotal: null,
              vramFree: null,
              credentialsError: false,
            },
            unreachableSince: null,
            running: null,
          },
          {
            id: "b3",
            name: "Disabled One",
            enabled: false,
            draining: false,
            health: {
              reachability: "unknown",
              comfyuiVersion: null,
              vramTotal: null,
              vramFree: null,
              credentialsError: false,
            },
            unreachableSince: null,
            running: null,
          },
        ],
      }),
    );

    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText("Idle")).toBeTruthy();
    expect(screen.getByText("Draining")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  test("shows who paused and since when", async () => {
    mockFetch(overview(), {
      ...SETTINGS,
      paused: true,
      pausedAt: "2026-01-02T03:04:00.000Z",
      pausedByName: "Alice",
    });

    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText(/^Paused since/)).toBeTruthy();
    expect(screen.getByText(/by Alice/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  test("formats VRAM in GiB", async () => {
    mockFetch(
      overview({
        backends: [
          {
            id: "b1",
            name: "GPU 1",
            enabled: true,
            draining: false,
            health: {
              reachability: "reachable",
              comfyuiVersion: "0.26.2",
              vramTotal: 24 * 1024 ** 3,
              vramFree: 18.2 * 1024 ** 3,
              credentialsError: false,
            },
            unreachableSince: null,
            running: null,
          },
        ],
      }),
    );

    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText("18.2 of 24.0 GiB free")).toBeTruthy();
  });
});
