import { afterEach, describe, expect, test } from "bun:test";
// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { ACCENT_PALETTES } from "@ai-content-studio/shared";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, fireEvent, screen, waitFor } = await import(
  "@testing-library/react"
);
const { SiteSettingsForm } = await import("./SiteSettingsForm.js");
const { renderWithProviders } = await import("../test/render.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

const SETTINGS = {
  version: 5,
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
};

interface PutCall {
  url: string;
  body: FormData;
}

function mockPut(handler: (call: PutCall) => Response) {
  const calls: PutCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call: PutCall = { url, body: init?.body as FormData };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

function renderForm(
  settings: typeof SETTINGS = SETTINGS,
  onReload: () => Promise<typeof SETTINGS | undefined> = () =>
    Promise.resolve(undefined),
) {
  return renderWithProviders(
    <SiteSettingsForm
      settings={settings}
      capsSlot={null}
      onReload={onReload}
    />,
  );
}

function makeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** The in-form Save button, not the sticky "Unsaved branding changes" bar's one — both are named "Save" while dirty. */
function brandingSaveButton(): HTMLElement {
  const [button] = screen.getAllByRole("button", { name: "Save" });
  if (!button) throw new Error("no Save button found");
  return button;
}

describe("SiteSettingsForm", () => {
  test("shows a swatch per palette with a button and link in both modes", () => {
    renderForm();

    const buttons = screen.getAllByText("Button");
    const links = screen.getAllByText("Link");
    // Each of the eight palettes shows a Light and a Dark mini preview.
    expect(buttons.length).toBe(ACCENT_PALETTES.length * 2);
    expect(links.length).toBe(ACCENT_PALETTES.length * 2);
    for (const palette of ACCENT_PALETTES) {
      expect(screen.getByText(palette.label)).toBeTruthy();
    }
  });

  test("refuses an oversized logo on pick", async () => {
    renderForm();

    const input = document.getElementById("site-logo") as HTMLInputElement;
    const oversized = makeFile("logo.png", "image/png", 2 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [oversized] } });

    expect(
      await screen.findByText("logo must be 1 MB or smaller"),
    ).toBeTruthy();
  });

  test("a 409 shows the stale-save alert with Reload", async () => {
    mockPut(() =>
      Response.json(
        { error: "changed by someone else, reload" },
        { status: 409 },
      ),
    );
    let reloaded = false;

    renderForm(SETTINGS, () => {
      reloaded = true;
      return Promise.resolve(SETTINGS);
    });

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New title" },
    });
    fireEvent.click(brandingSaveButton());

    expect(
      await screen.findByText("changed by someone else, reload"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(reloaded).toBe(true));
  });

  test("saves the multipart body", async () => {
    const calls = mockPut(() =>
      Response.json({ ...SETTINGS, title: "New title", version: 6 }),
    );

    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New title" },
    });
    fireEvent.click(brandingSaveButton());

    await waitFor(() => expect(calls.length).toBe(1));
    const body = calls[0]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect(body?.get("version")).toBe("5");
    expect(body?.get("title")).toBe("New title");
    expect(body?.get("signUpMode")).toBe("approval");
    expect(body?.get("accent")).toBe("teal");
    expect(JSON.parse(body?.get("footerLinks") as string)).toEqual([]);
    expect(body?.get("logo")).toBeNull();
    expect(body?.get("background")).toBeNull();
  });

  test("a 500 shows a save error", async () => {
    mockPut(() => Response.json({ error: "internal error" }, { status: 500 }));

    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New title" },
    });
    fireEvent.click(brandingSaveButton());

    expect(await screen.findByText("internal error")).toBeTruthy();
  });
});
