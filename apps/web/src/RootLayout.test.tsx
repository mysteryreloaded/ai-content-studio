// This file registers its own happy-dom instance (bun test --isolate
// gives it a clean process).
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { RouteObject } from "react-router-dom";
import type { SessionUser } from "./useSession.js";
import type { PublicSiteSettings } from "./useSiteSettings.js";

await GlobalRegistrator.register();

const { act } = await import("react");
const { cleanup, waitFor } = await import("@testing-library/react");
const { PageContainer, RootLayout } = await import("./RootLayout.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "./test/render.js"
);

// happy-dom exposes `navigator.locks` without its `request` method, which
// `electNotifier` (the shell's one `useTabNotifier`) would call: the stub
// grants the lock right away, like the only open tab in these tests.
Object.defineProperty(navigator, "locks", {
  configurable: true,
  value: {
    request(
      _name: string,
      _options: { signal: AbortSignal },
      callback: () => Promise<unknown>,
    ): Promise<unknown> {
      return callback();
    },
  },
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

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
  /** The streams still open (the last unmount closes each one). */
  static open(): FakeEventSource[] {
    return FakeEventSource.instances.filter((s) => !s.closed);
  }
  static stream(url: string) {
    return FakeEventSource.open().find((s) => s.url === url) ?? null;
  }
}

beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];
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

const PENDING_USER: SessionUser = { ...USER, status: "pending" };

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
];

function mockFetch(user: SessionUser | null, meCalls: { n: number }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) {
      meCalls.n += 1;
      if (!user) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json(user);
    }
    if (url.endsWith("/api/site-settings")) return Response.json(SETTINGS);
    if (url.endsWith("/api/models")) return Response.json({ models: MODELS });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

/** The memory router's tree: the index route keeps the default layout, the `full` route opts out. */
function layoutRoutes(): RouteObject[] {
  return [
    {
      element: <RootLayout />,
      children: [
        { index: true, element: <div data-testid="page">default page</div> },
        {
          path: "full",
          element: <div data-testid="page">full page</div>,
          handle: { layout: "full" },
        },
      ],
    },
  ];
}

async function renderShell(route: string) {
  const view = renderWithProviders(null, { routes: layoutRoutes(), route });
  // The header's Radix menu settles one state update on mount, outside
  // React's own act scope in happy-dom; flush it so the run stays quiet.
  await act(async () => {});
  return view;
}

describe("RootLayout (issue #188)", () => {
  test("a route without a handle sits in the default page container, and the shell wrapper stretches to the viewport", async () => {
    const meCalls = { n: 0 };
    mockFetch(USER, meCalls);
    const view = await renderShell("/");
    const page = await view.findByTestId("page");

    // The page's wrapper is the shared default container: max-width
    // 1280px, the issue #222 page frame (docs/ui-sizes.md) — 16px sides
    // on phones, 32px at md, 40px top/bottom.
    const container = page.parentElement as HTMLElement;
    expect(container.getAttribute("data-slot")).toBe("page-container");
    expect(container.className).toBe(
      "mx-auto w-full max-w-320 flex-1 px-4 py-10 md:px-8",
    );

    // The root wrapper is a flex column at min-height 100dvh, so the
    // footer sits at the bottom of short pages.
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.className).toBe("flex min-h-dvh flex-col");

    // The Footer is the last element of the shell, on every page.
    expect(root.lastElementChild?.tagName.toUpperCase()).toBe("FOOTER");
  });

  test("a route with handle { layout: 'full' } renders without the max-width or padding", async () => {
    const meCalls = { n: 0 };
    mockFetch(USER, meCalls);
    const view = await renderShell("/full");
    const page = await view.findByTestId("page");

    const wrapper = page.parentElement as HTMLElement;
    expect(wrapper.className).toBe("w-full flex-1");
    expect(
      view.container.querySelector("[data-slot='page-container']"),
    ).toBeNull();
  });

  test("an active user opens the shell's two shared streams; a pending user and a signed-out visitor open no generations stream (issue #188's AC)", async () => {
    const meCalls = { n: 0 };
    mockFetch(USER, meCalls);
    await renderShell("/");
    // Both streams open once: the shared notice stream (ungated) and the
    // generations stream (gated on the session), and nothing else — the
    // header, the notifier and every page share the one generations
    // stream.
    await waitFor(() => expect(FakeEventSource.open().length).toBe(2));
    expect(FakeEventSource.stream("/api/generations/stream")).toBeTruthy();
    expect(
      FakeEventSource.stream("/api/site-settings/notice-stream"),
    ).toBeTruthy();

    cleanup();

    mockFetch(PENDING_USER, meCalls);
    await renderShell("/");
    await waitFor(() => expect(meCalls.n).toBeGreaterThan(1));
    await drainMacrotasks();
    // The pending user's shell opens the notice stream only.
    expect(FakeEventSource.open()).toHaveLength(1);
    expect(FakeEventSource.open()[0]?.url).toBe(
      "/api/site-settings/notice-stream",
    );
    expect(FakeEventSource.stream("/api/generations/stream")).toBeNull();

    cleanup();

    mockFetch(null, meCalls);
    await renderShell("/");
    await waitFor(() => expect(meCalls.n).toBeGreaterThan(2));
    await drainMacrotasks();
    expect(FakeEventSource.open()).toHaveLength(1);
    expect(FakeEventSource.stream("/api/generations/stream")).toBeNull();
  });
});
