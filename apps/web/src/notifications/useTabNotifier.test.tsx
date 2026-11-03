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
import type { SessionUser } from "../useSession.js";
import type { PublicSiteSettings } from "../useSiteSettings.js";
import type { GenerationState } from "./types.js";

await GlobalRegistrator.register();

const { cleanup, waitFor } = await import("@testing-library/react");
const { useSiteSettings } = await import("../useSiteSettings.js");
const { useTabNotifier } = await import("./useTabNotifier.js");
const { FAILURE_DOT_COLOR } = await import("./favicon.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "../test/render.js"
);

// happy-dom exposes `navigator.locks` without its `request` method, which
// `electNotifier` would call: the stub grants the lock right away, like
// the only open tab in these single-tab tests.
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

// happy-dom's 2d context is `null`, so `favicon.ts`'s `drawDot` would
// return "" and every dot would look the same: the stub records the
// dot's `fillStyle` and `toDataURL` hands it back, so a test can assert
// the drawn colour through the icon's href.
const dotRecord: { color: string } = { color: "" };
(HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext =
  () => ({
    drawImage: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    set fillStyle(value: string) {
      dotRecord.color = value;
    },
    get fillStyle(): string {
      return dotRecord.color;
    },
    set strokeStyle(_value: string) {},
    get strokeStyle(): string {
      return "#fff";
    },
    set lineWidth(_value: number) {},
    get lineWidth(): number {
      return 1.5;
    },
  });
(HTMLCanvasElement.prototype as unknown as { toDataURL: unknown }).toDataURL = (
  _type: string,
) => `data:image/png;dot=${dotRecord.color}`;

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

function mockFetch(
  user: SessionUser | null,
  calls: { me: number; settings: number },
) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) {
      calls.me += 1;
      if (!user) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json(user);
    }
    if (url.endsWith("/api/site-settings")) {
      calls.settings += 1;
      return Response.json(SETTINGS);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

const USER: SessionUser = {
  id: "u1",
  email: "user@example.com",
  name: "A User",
  picture: null,
  role: "user",
  status: "active",
  termsAcceptedVersion: null,
};

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

/** A Generation summary in the stream's JSON shape (Dates as ISO strings). */
function gen(
  id: string,
  state: GenerationState,
  model: "ltx" | "wan",
): Record<string, string | null> {
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

/** The notifier's tab title and favicon are on the document, not the React tree; the only rendered output is the Site title, used to wait for the settings to commit. */
function Harness() {
  useTabNotifier();
  return <span>{useSiteSettings()?.title ?? ""}</span>;
}

function iconHref(): string | null {
  return (
    document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? null
  );
}

/** The tab's one shared generations stream (the notifier registers its handlers on it, issue #188). */
async function stream(): Promise<FakeEventSource> {
  await waitFor(() => {
    expect(FakeEventSource.stream("/api/generations/stream")).toBeTruthy();
  });
  return FakeEventSource.stream("/api/generations/stream") as FakeEventSource;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];
  dotRecord.color = "";
  // The favicon's `originalHref` is captured once per process, from
  // whatever icon link exists when it is first touched: start every
  // test with no icon link, a known title, the Site's accent and a
  // visible tab.
  document.querySelector('link[rel="icon"]')?.remove();
  document.title = "";
  document.documentElement.style.setProperty("--accent", "#0d9488");
  setHidden(false);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

describe("useTabNotifier's tab cue (issue #58's AC, issue #188's rewire)", () => {
  test("the (N) Model cue shows while work is under way, even in the visible tab, and no dot is drawn", async () => {
    const calls = { me: 0, settings: 0 };
    mockFetch(USER, calls);
    const view = renderWithProviders(<Harness />);
    await view.findByText("Test Studio");
    const source = await stream();

    source.emit("snapshot", {
      generations: [gen("g1", "running", "ltx"), gen("g2", "queued", "ltx")],
    });
    expect(document.title).toBe("(2) LTX 2.5 · Test Studio");
    expect(iconHref()).toBeNull();

    // Both end in the visible tab: no ✓/✕ accumulates, the cue resets.
    source.emit("change", gen("g1", "succeeded", "ltx"));
    source.emit("change", gen("g2", "failed", "ltx"));
    expect(document.title).toBe("");
    expect(iconHref()).toBeNull();
  });

  test("a hidden tab accumulates ended Submissions: the ✓ summary and the accent dot", async () => {
    const calls = { me: 0, settings: 0 };
    mockFetch(USER, calls);
    setHidden(true);
    const view = renderWithProviders(<Harness />);
    await view.findByText("Test Studio");
    const source = await stream();

    source.emit("snapshot", {
      generations: [
        gen("g1", "running", "wan"),
        gen("g2", "running", "ltx"),
        gen("g3", "running", "ltx"),
        gen("g4", "running", "ltx"),
      ],
    });
    // The cue shows in a hidden tab too, and no dot yet (under way).
    expect(document.title).toBe("(4) LTX 2.5 · Test Studio");
    expect(iconHref()).toBeNull();

    source.emit("change", gen("g2", "succeeded", "ltx"));
    source.emit("change", gen("g3", "succeeded", "ltx"));
    source.emit("change", gen("g4", "succeeded", "ltx"));
    source.emit("change", gen("g1", "failed", "wan"));

    // 3 ready, 1 failed, accumulated since the tab last became visible.
    expect(document.title).toBe("✓ 3 ready · 1 failed · Test Studio");
    // At least one succeeded: the accent dot, in the Site's --accent.
    expect(iconHref()).toBe("data:image/png;dot=#0d9488");
  });

  test("a hidden tab with no success shows the ✕ summary and the failure dot", async () => {
    const calls = { me: 0, settings: 0 };
    mockFetch(USER, calls);
    setHidden(true);
    const view = renderWithProviders(<Harness />);
    await view.findByText("Test Studio");
    const source = await stream();

    source.emit("snapshot", {
      generations: [gen("g1", "running", "ltx"), gen("g2", "running", "ltx")],
    });
    source.emit("change", gen("g1", "failed", "ltx"));
    source.emit("change", gen("g2", "failed", "ltx"));

    expect(document.title).toBe("✕ 2 failed · Test Studio");
    expect(iconHref()).toBe(`data:image/png;dot=${FAILURE_DOT_COLOR}`);
  });

  test("becoming visible resets the accumulated summary and the dot, and the cue works again", async () => {
    const calls = { me: 0, settings: 0 };
    mockFetch(USER, calls);
    setHidden(true);
    const view = renderWithProviders(<Harness />);
    await view.findByText("Test Studio");
    const source = await stream();

    source.emit("snapshot", {
      generations: [gen("g1", "running", "ltx"), gen("g2", "running", "ltx")],
    });
    source.emit("change", gen("g1", "failed", "ltx"));
    source.emit("change", gen("g2", "failed", "ltx"));
    expect(document.title).toBe("✕ 2 failed · Test Studio");

    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(document.title).toBe("");
    expect(iconHref()).toBeNull();

    // A new Generation starting after the reset shows the cue again.
    source.emit("change", gen("g3", "queued", "ltx"));
    expect(document.title).toBe("(1) LTX 2.5 · Test Studio");
  });

  test("registers its handlers on the shared stream, one EventSource for the tab (issue #188)", async () => {
    const calls = { me: 0, settings: 0 };
    mockFetch(USER, calls);
    renderWithProviders(<Harness />);
    await waitFor(() => expect(calls.me).toBeGreaterThan(0));
    const source = await stream();

    // One open stream for the whole shell here — the notifier adds no
    // connection of its own (issue #59's one-EventSource-per-tab rule).
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe("/api/generations/stream");

    // It hears the wire's snapshot-first order: the snapshot lands in the
    // tracker, then a change for a new Generation ends up under way.
    source.emit("snapshot", {
      generations: [gen("g1", "running", "ltx")],
    });
    expect(document.title).toBe("(1) LTX 2.5 · Test Studio");
    source.emit("change", gen("g2", "queued", "ltx"));
    expect(document.title).toBe("(2) LTX 2.5 · Test Studio");
  });
});
