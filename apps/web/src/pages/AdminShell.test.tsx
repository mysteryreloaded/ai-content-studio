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
import type { SessionUser } from "../useSession.js";

await GlobalRegistrator.register();

const { cleanup, waitFor, within } = await import("@testing-library/react");
const { AdminShell } = await import("./AdminShell.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "../test/render.js"
);

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

const ADMIN: SessionUser = {
  id: "a1",
  email: "admin@example.com",
  name: "An Admin",
  picture: null,
  role: "admin",
  status: "active",
  termsAcceptedVersion: 1,
};

const USER: SessionUser = { ...ADMIN, role: "user" };

interface MockOptions {
  user: SessionUser;
  pendingCount?: number;
  errorCount?: number;
  calledUrls?: string[];
}

function mockFetch(options: MockOptions) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    options.calledUrls?.push(url);
    if (url.endsWith("/api/auth/me")) return Response.json(options.user);
    if (url.endsWith("/api/admin/overview")) {
      return Response.json({
        problems: [],
        backends: [],
        disabledBanner: null,
        disk: { freeGb: null, minFreeDiskGb: 0 },
        errors24h: 0,
        version: "test",
        uptimeSeconds: 0,
      });
    }
    if (url.endsWith("/api/admin/backends")) {
      return Response.json({ backends: [] });
    }
    if (url.endsWith("/api/admin/users/pending-count")) {
      return Response.json({ count: options.pendingCount ?? 0 });
    }
    if (url.endsWith("/api/admin/logs/error-count-24h")) {
      return Response.json({ count: options.errorCount ?? 0 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function renderAt(path: string) {
  return renderWithProviders(<AdminShell />, {
    route: path,
    routes: [
      { path: "/admin/*", element: <AdminShell /> },
      { path: "*", element: <output data-testid="elsewhere" /> },
    ],
  });
}

describe("AdminShell (issue #200)", () => {
  test("lists the admin sections in order", async () => {
    mockFetch({ user: ADMIN });
    const view = renderAt("/admin");

    const nav = await view.findByRole("navigation", { name: "Admin" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      "Overview",
      "Models",
      "Backends",
      "Users",
      "Generations",
      "Site settings",
      "Audit",
      "Logs",
    ]);
  });

  test("marks the current section, and Users stays current on Blocked accounts", async () => {
    mockFetch({ user: ADMIN });
    let view = renderAt("/admin/backends");
    let nav = await view.findByRole("navigation", { name: "Admin" });
    expect(
      within(nav)
        .getByRole("link", { name: "Backends" })
        .getAttribute("aria-current"),
    ).toBe("page");

    cleanup();

    mockFetch({ user: ADMIN });
    view = renderAt("/admin/blocked-accounts");
    nav = await view.findByRole("navigation", { name: "Admin" });
    expect(
      within(nav)
        .getByRole("link", { name: /^Users/ })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  test("shows the pending and 24-h error badges when non-zero", async () => {
    mockFetch({ user: ADMIN, pendingCount: 3, errorCount: 5 });
    const view = renderAt("/admin");
    const nav = await view.findByRole("navigation", { name: "Admin" });

    const users = await within(nav).findByRole("link", { name: /^Users/ });
    await waitFor(() => expect(users.textContent).toContain("3"));
    expect(users.textContent).toContain("pending");

    const logs = await within(nav).findByRole("link", { name: /^Logs/ });
    await waitFor(() => expect(logs.textContent).toContain("5"));
    expect(logs.textContent).toContain("errors in the last 24 hours");
  });

  test("hides the badges at 0", async () => {
    mockFetch({ user: ADMIN, pendingCount: 0, errorCount: 0 });
    const view = renderAt("/admin");
    const nav = await view.findByRole("navigation", { name: "Admin" });

    const users = await within(nav).findByRole("link", { name: "Users" });
    const logs = await within(nav).findByRole("link", { name: "Logs" });
    expect(users.querySelector("[aria-hidden]")).toBeNull();
    expect(logs.querySelector("[aria-hidden]")).toBeNull();
  });

  test("never calls an admin route for a non-Admin", async () => {
    const calledUrls: string[] = [];
    mockFetch({ user: USER, calledUrls });
    renderAt("/admin");

    await waitFor(() => expect(calledUrls.length).toBeGreaterThan(0));
    await drainMacrotasks();
    expect(calledUrls.some((u) => u.includes("/api/admin"))).toBe(false);
  });

  test("routes /admin/backends to the Backends page", async () => {
    mockFetch({ user: ADMIN });
    const view = renderAt("/admin/backends");
    expect(await view.findByRole("heading", { name: "Backends" })).toBeTruthy();
  });

  test("puts the routed content, not the nav, in the page's main landmark", async () => {
    mockFetch({ user: ADMIN });
    const view = renderAt("/admin/backends");

    const main = await view.findByRole("main");
    expect(
      within(main).getByRole("heading", { name: "Backends" }),
    ).toBeTruthy();
    expect(
      within(main).queryByRole("navigation", { name: "Admin" }),
    ).toBeNull();
  });
});
