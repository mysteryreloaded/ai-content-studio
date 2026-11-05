import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  DETAIL,
  cleanup,
  finishFile,
  mockFetch,
  openSection,
  prepareConfirmAndEventSource,
  renderEditor,
  respondGet,
  restoreConfirm,
} from "../testing/harness.js";
import type { FetchCall } from "../testing/harness.js";

/** A detail with already-saved terms, version 1 — the base for the issue #264 ask-again cases. */
function termsDetail() {
  return {
    ...DETAIL,
    model: {
      ...DETAIL.model,
      termsBody: "Old terms.",
      termsVersion: 1,
      termsVersionCreatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

/** The `terms` part of a captured draft-PUT body, if one went out. */
function sentTerms(call: FetchCall | undefined): {
  askAgain?: boolean;
  termsBody?: string;
} | null {
  const body = (call?.body ?? null) as {
    terms?: { askAgain?: boolean; termsBody?: string };
  } | null;
  return body?.terms ?? null;
}

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await finishFile();
});

beforeEach(() => {
  prepareConfirmAndEventSource();
});

afterEach(() => {
  restoreConfirm();
});

describe("TermsSection", () => {
  test("first-time terms (blank saved terms) show the note, not the checkbox", async () => {
    mockFetch((call) => respondGet(call.url));
    const view = renderEditor();
    await openSection(view, "Terms and attribution");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.type(view.getByLabelText("Model terms"), "Be nice.");

    expect(
      await view.findByText(
        "Users will be asked to accept these terms before their next use.",
      ),
    ).toBeTruthy();
    expect(view.queryByText("Ask everyone to accept again")).toBeNull();
  });

  test("changing existing terms shows Ask everyone to accept again", async () => {
    const detail = {
      ...DETAIL,
      model: {
        ...DETAIL.model,
        termsBody: "Old terms.",
        termsVersion: 1,
        termsVersionCreatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      return respondGet(call.url);
    });
    const view = renderEditor();
    await openSection(view, "Terms and attribution");

    expect(await view.findByDisplayValue("Old terms.")).toBeTruthy();
    expect(view.queryByText("Ask everyone to accept again")).toBeNull();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.type(view.getByLabelText("Model terms"), " New line.");

    expect(await view.findByText("Ask everyone to accept again")).toBeTruthy();
    expect(
      view.getByText("Leave unticked for small fixes, such as a typo."),
    ).toBeTruthy();
  });

  test("an invalid License URL shows its error, and the valid one links to the licensing docs", async () => {
    mockFetch((call) => respondGet(call.url));
    const view = renderEditor();
    await openSection(view, "Terms and attribution");

    expect(
      view.getByRole("link", { name: "Model licenses and AI rules" }),
    ).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.type(view.getByLabelText("License URL"), "not-a-url");

    expect(
      await view.findByText("Must be an http(s) URL, or blank"),
    ).toBeTruthy();
  });

  // Issue #264: a ticked box must not bump `termsVersion` once the text
  // has gone back to what was saved — the tick only counts (dirty, and
  // what Save sends) while the terms text still really differs from the
  // saved text.
  test("ticking ask-again, then reverting the text, leaves Terms clean, and the next Save sends askAgain:false", async () => {
    const detail = termsDetail();
    const savedDetail = {
      ...detail,
      model: {
        ...detail.model,
        name: "LTX 2.5x",
        version: 2,
        currentRevision: 2,
      },
    };
    let saved = false;
    const calls = mockFetch((call) => {
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        // The server's own saveDraft keeps `termsVersion`: the body is
        // unchanged once trimmed, and askAgain comes out false.
        saved = true;
        return Response.json(savedDetail);
      }
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(saved ? savedDetail : detail);
      }
      return respondGet(call.url);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Terms and attribution");
    const termsArea = await view.findByDisplayValue("Old terms.");
    await userEvent.type(termsArea, " Extra.");
    await userEvent.click(await view.findByRole("checkbox"));

    // Reverting the text to what was saved: the box disappears, and the
    // tick no longer keeps the editor dirty on its own.
    await userEvent.clear(termsArea);
    await userEvent.type(termsArea, "Old terms.");

    expect(view.queryByText("Ask everyone to accept again")).toBeNull();
    expect(view.queryByText("Unsaved changes")).toBeNull();
    expect(view.getByText("Saved · revision 1")).toBeTruthy();

    // Another change (Details) makes the editor dirty again; the one
    // Save carries the reverted terms and sends askAgain:false.
    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("Name"), "x");
    await userEvent.click(view.getByText("Save"));

    expect(await view.findByText("Saved · revision 2")).toBeTruthy();

    const draftCall = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/draft"),
    );
    expect(draftCall).toBeTruthy();
    expect(sentTerms(draftCall)?.askAgain).toBe(false);
    expect(sentTerms(draftCall)?.termsBody).toBe("Old terms.");

    // The save reseeded the section from the refetched Model, where
    // `termsVersion` stayed at 1 — no bump for a text that went back.
    await openSection(view, "Terms and attribution");
    expect(view.getByText(/Current version 1, effective/)).toBeTruthy();
    expect((view.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
  });

  // Issue #264: the normal case, unchanged by the fix — a real change
  // plus the tick sends askAgain:true and bumps `termsVersion`.
  test("ticking ask-again and saving sends askAgain:true and bumps termsVersion", async () => {
    const detail = termsDetail();
    const bumped = {
      ...detail,
      model: {
        ...detail.model,
        termsBody: "Old terms. Extra.",
        termsVersion: 2,
        termsVersionCreatedAt: "2026-02-01T00:00:00.000Z",
        version: 2,
        currentRevision: 2,
      },
    };
    let saved = false;
    const calls = mockFetch((call) => {
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        // The server's own saveDraft: a changed body plus askAgain:true
        // starts the next terms version.
        saved = true;
        return Response.json(bumped);
      }
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(saved ? bumped : detail);
      }
      return respondGet(call.url);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Terms and attribution");
    const termsArea = await view.findByDisplayValue("Old terms.");
    await userEvent.type(termsArea, " Extra.");
    await userEvent.click(await view.findByRole("checkbox"));
    await userEvent.click(view.getByText("Save"));

    const draftCall = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/draft"),
    );
    expect(draftCall).toBeTruthy();
    expect(sentTerms(draftCall)?.askAgain).toBe(true);
    expect(sentTerms(draftCall)?.termsBody).toBe("Old terms. Extra.");

    // The reseeded section shows the bumped version from the refetch.
    expect(await view.findByText(/Current version 2, effective/)).toBeTruthy();
  });

  // Issue #264: a change without the tick (the box's "small fixes,
  // such as a typo" case) keeps the current terms version.
  test("saving a changed text without ticking sends askAgain:false and keeps termsVersion", async () => {
    const detail = termsDetail();
    const savedDetail = {
      ...detail,
      model: {
        ...detail.model,
        termsBody: "Old terms. Extra.",
        version: 2,
        currentRevision: 2,
      },
    };
    let saved = false;
    const calls = mockFetch((call) => {
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        // The server's own saveDraft: a changed body without askAgain
        // keeps `termsVersion`.
        saved = true;
        return Response.json(savedDetail);
      }
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(saved ? savedDetail : detail);
      }
      return respondGet(call.url);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Terms and attribution");
    const termsArea = await view.findByDisplayValue("Old terms.");
    await userEvent.type(termsArea, " Extra.");
    // The box is offered for a changed text; it stays unticked.
    expect(await view.findByText("Ask everyone to accept again")).toBeTruthy();
    await userEvent.click(view.getByText("Save"));

    const draftCall = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/draft"),
    );
    expect(draftCall).toBeTruthy();
    expect(sentTerms(draftCall)?.askAgain).toBe(false);
    expect(sentTerms(draftCall)?.termsBody).toBe("Old terms. Extra.");

    expect(await view.findByText("Saved · revision 2")).toBeTruthy();
    expect(view.getByText(/Current version 1, effective/)).toBeTruthy();
  });
});
