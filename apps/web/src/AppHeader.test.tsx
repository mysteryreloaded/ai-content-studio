// See ModelEditorPage.test.tsx's header comment: this file registers its
// own happy-dom instance (bun test --isolate gives it a clean process).
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ActiveGenerationSummary } from "./lib/generationsStream.js";
import type { GenerationState } from "./notifications/types.js";
import type { SessionUser } from "./useSession.js";
import type { PublicSiteSettings } from "./useSiteSettings.js";

await GlobalRegistrator.register();

const { cleanup, fireEvent, waitFor, within } = await import(
  "@testing-library/react"
);
const { useLocation } = await import("react-router-dom");
const { AppHeader } = await import("./components/AppHeader.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "./test/render.js"
);

// The surface of the real EventSource that `useEventStream` touches
// (addEventListener, onerror, close), with a record of every open.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data) });
    }
  }
  static stream(url: string) {
    return (
      FakeEventSource.instances.find((s) => !s.closed && s.url === url) ?? null
    );
  }
}

beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

const USER: SessionUser = {
  id: "u1",
  email: "user@example.com",
  name: "A User",
  picture: null,
  role: "user",
  status: "active",
  termsAcceptedVersion: null,
};

const ADMIN_USER: SessionUser = { ...USER, role: "admin" };

const SETTINGS: PublicSiteSettings = {
  title: "Test Studio",
  landingText: "",
  accent: "teal",
  signUpMode: "approval",
  contact: "",
  hasLogo: false,
  hasBackground: false,
  hasTerms: false,
  footerLinks: [],
  hasNonVideoEnabledModel: false,
};

const MODELS = [
  {
    id: "m1",
    slug: "ltx",
    name: "LTX 2.5",
    description: "Video",
    modeCount: 1,
    attribution: "",
  },
  {
    id: "m2",
    slug: "wan",
    name: "Wan 2.2",
    description: "Video",
    modeCount: 1,
    attribution: "",
  },
];

interface MockOptions {
  user: SessionUser | null; // null = /api/auth/me answers 401 (signed out)
  settings?: PublicSiteSettings;
  models?: typeof MODELS;
  signOuts?: Array<{ method: string; url: string }>;
  meCalls?: { n: number };
}

function mockFetch(options: MockOptions) {
  const settings = options.settings ?? SETTINGS;
  const models = options.models ?? MODELS;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) {
      if (options.meCalls) options.meCalls.n += 1;
      if (!options.user) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json(options.user);
    }
    if (url.endsWith("/api/site-settings")) return Response.json(settings);
    if (url.endsWith("/api/models")) return Response.json({ models });
    if (url.endsWith("/api/auth/signout")) {
      options.signOuts?.push({
        method: (init?.method ?? "GET").toUpperCase(),
        url,
      });
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

/** The header's data is query-fed (issue #183), so render it under the app's two provider layers. */
function renderAt(path: string) {
  return renderWithProviders(
    <>
      <AppHeader />
      <LocationProbe />
    </>,
    { route: path },
  );
}

/** Mirrors the memory router's location: the sign-out test asserts the navigation the header triggers. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

/** A Generation summary in the stream's JSON shape (Dates as ISO strings). */
function generation(
  id: string,
  state: GenerationState,
  model: "ltx" | "wan",
): ActiveGenerationSummary {
  return {
    id,
    modelId: `model-${model}`,
    modelSlug: model,
    modelName: model === "ltx" ? "LTX 2.5" : "Wan 2.2",
    modeId: "mode-1",
    modeName: "Standard",
    submissionId: `sub-${id}`,
    state,
    deletedAt: null,
    removedAt: null,
  };
}

/** The tab's one shared generations stream (the header's count is stream-fed, not fetch-fed). */
async function stream(): Promise<FakeEventSource> {
  await waitFor(() => {
    expect(FakeEventSource.stream("/api/generations/stream")).toBeTruthy();
  });
  return FakeEventSource.stream("/api/generations/stream") as FakeEventSource;
}

// The DropdownMenu content portals to document.body, outside render's
// container, so menu queries go through `within(document.body)`.
const body = () => within(document.body);

describe("AppHeader (issue #173)", () => {
  test("shows the Site title, one link per enabled Model and Gallery", async () => {
    mockFetch({ user: USER });
    const view = renderAt("/models/ltx");

    const brand = await view.findByRole("link", { name: "Test Studio" });
    // Issue #188's gap 3: the brand links to the Models home, not the
    // (signed-out only) landing page.
    expect(brand.getAttribute("href")).toBe("/models");

    const nav = view.getByRole("navigation", { name: "Studio" });
    expect(nav).toBeTruthy();

    const ltx = view.getByRole("link", { name: "LTX 2.5" });
    expect(ltx.getAttribute("href")).toBe("/models/ltx");
    const wan = view.getByRole("link", { name: "Wan 2.2" });
    expect(wan.getAttribute("href")).toBe("/models/wan");
    const gallery = view.getByRole("link", { name: "Gallery" });
    expect(gallery.getAttribute("href")).toBe("/gallery");

    // Gallery carries the hidden live-count slot a later issue feeds.
    expect(gallery.querySelector("[data-slot='nav-count']")).toBeTruthy();
  });

  test("marks the current Model page, not its siblings", async () => {
    mockFetch({ user: USER });
    const view = renderAt("/models/ltx");
    await view.findByRole("link", { name: "LTX 2.5" });

    expect(
      view.getByRole("link", { name: "LTX 2.5" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      view.getByRole("link", { name: "Wan 2.2" }).getAttribute("aria-current"),
    ).toBeNull();
    expect(
      view.getByRole("link", { name: "Gallery" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  test("marks Gallery current on the Gallery itself", async () => {
    mockFetch({ user: USER });
    const view = renderAt("/gallery");
    expect(
      (await view.findByRole("link", { name: "Gallery" })).getAttribute(
        "aria-current",
      ),
    ).toBe("page");
  });

  test("marks Gallery current on a Generation's detail page", async () => {
    mockFetch({ user: USER });
    const view = renderAt("/generations/g1");
    expect(
      (await view.findByRole("link", { name: "Gallery" })).getAttribute(
        "aria-current",
      ),
    ).toBe("page");
  });

  test("shows Admin only for an Admin, and marks it current under /admin", async () => {
    mockFetch({ user: ADMIN_USER });
    const view = renderAt("/admin");
    const admin = await view.findByRole("link", { name: "Admin" });
    expect(admin.getAttribute("href")).toBe("/admin");
    expect(admin.getAttribute("aria-current")).toBe("page");

    cleanup();

    mockFetch({ user: USER });
    const plain = renderAt("/admin");
    await plain.findByRole("link", { name: "Gallery" });
    expect(plain.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  test("shows the initials on the avatar when there is no Google picture", async () => {
    mockFetch({ user: USER });
    const view = renderAt("/gallery");
    const avatar = await view.findByRole("button", { name: "Account" });
    expect(avatar.textContent).toBe("AU");
  });

  test("opens the Account menu and signs out from there", async () => {
    const signOuts: Array<{ method: string; url: string }> = [];
    mockFetch({ user: USER, signOuts });
    const view = renderAt("/gallery");
    const avatar = await view.findByRole("button", { name: "Account" });

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(avatar);

    const menu = body();
    expect(await menu.findByRole("menuitem", { name: "Account" })).toBeTruthy();
    const signOut = await menu.findByRole("menuitem", { name: "Sign out" });
    await userEvent.click(signOut);

    expect(signOuts).toEqual([{ method: "POST", url: "/api/auth/signout" }]);
    // The menu closes (or its portaled content unmounts with the header
    // once the session flips to signed out), and Sign out goes to the top.
    await waitFor(() => {
      const content = document.body.querySelector(
        "[data-slot='dropdown-menu-content']",
      );
      expect(
        content === null || content.getAttribute("data-state") === "closed",
      ).toBe(true);
    });
    await waitFor(() =>
      expect(view.getByTestId("location").textContent).toBe("/"),
    );
  });

  test("stays hidden while signed out", async () => {
    const meCalls = { n: 0 };
    mockFetch({ user: null, meCalls });
    const view = renderAt("/gallery");

    // Wait for /api/auth/me to have resolved as a 401.
    await waitFor(() => expect(meCalls.n).toBeGreaterThan(0));
    expect(view.queryByRole("navigation", { name: "Studio" })).toBeNull();
    expect(view.queryByRole("button", { name: "Account" })).toBeNull();
  });
});

describe("AppHeader (issue #188)", () => {
  test("the Gallery link carries the live under-way count, and hides it at zero", async () => {
    mockFetch({ user: USER });
    const view = renderAt("/gallery");
    const source = await stream();

    // Nothing under way yet: the badge is hidden and out of the
    // link's accessible name.
    let gallery = view.getByRole("link", { name: "Gallery" });
    let badge = gallery.querySelector<HTMLElement>("[data-slot='nav-count']");
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.className).toContain("hidden");

    // Two Generations under way (the same N the tab title's cue shows):
    // the badge appears and the link reads "Gallery 2 under way".
    source.emit("snapshot", {
      generations: [
        generation("g1", "running", "ltx"),
        generation("g2", "queued", "wan"),
      ],
    });
    gallery = await view.findByRole("link", { name: "Gallery 2 under way" });
    badge = gallery.querySelector<HTMLElement>("[data-slot='nav-count']");
    expect(badge?.getAttribute("aria-hidden")).toBeNull();
    expect(badge?.className).not.toContain("hidden");
    expect(badge?.textContent).toBe("2");

    // Both end: back to the plain Gallery link (badge hidden again).
    source.emit("change", generation("g1", "succeeded", "ltx"));
    source.emit("change", generation("g2", "failed", "wan"));
    gallery = await view.findByRole("link", { name: "Gallery" });
    badge = gallery.querySelector<HTMLElement>("[data-slot='nav-count']");
    expect(badge?.textContent).toBe("0");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.className).toContain("hidden");
  });

  test("falls back to the avatar's initials when the Google picture fails to load", async () => {
    mockFetch({
      user: { ...USER, picture: "https://example.com/picture.jpg" },
    });
    const view = renderAt("/gallery");
    const avatar = await view.findByRole("button", { name: "Account" });

    const image = avatar.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/picture.jpg");
    expect(avatar.textContent).toBe("");

    // The dead Google URL used to show a broken image (issue #188's
    // gap 4): the error handler swaps to the initials.
    // biome-ignore lint/style/noNonNullAssertion: presence is asserted on the line above
    fireEvent.error(image!);
    expect(avatar.textContent).toBe("AU");
  });
});
