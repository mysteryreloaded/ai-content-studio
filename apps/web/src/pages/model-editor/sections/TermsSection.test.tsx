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
});
