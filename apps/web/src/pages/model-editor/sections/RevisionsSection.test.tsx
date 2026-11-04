import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { RenderResult } from "@testing-library/react";
import {
  DETAIL,
  NO_BACKENDS,
  cleanup,
  finishFile,
  mockFetch,
  openSection,
  prepareConfirmAndEventSource,
  renderEditor,
  restoreConfirm,
  waitFor,
  within,
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

/** A Model with one Mode (issue #259), so the current revision's own "N Modes · N Inputs" line reads 1 Mode. */
const MODE_DETAIL = {
  ...DETAIL,
  model: { ...DETAIL.model, currentRevision: 2, version: 1 },
  modes: [
    {
      id: "mode-1",
      sortOrder: 0,
      name: "Default",
      description: "",
      outputNodes: [
        { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
      ],
      inputSettings: [],
    },
  ],
  inputs: [],
};

const REVISIONS = {
  revisions: [
    {
      revisionNumber: 2,
      createdAt: "2026-01-02T00:00:00.000Z",
      workflowHash: "hash2",
      modeCount: 1,
      inputCount: 0,
    },
    {
      revisionNumber: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      workflowHash: "hash1",
      modeCount: 0,
      inputCount: 0,
    },
  ],
};

function respondGetWithRevisions(url: string): Response {
  if (url.endsWith("/api/admin/models/m1")) return Response.json(MODE_DETAIL);
  if (url.endsWith("/revisions")) return Response.json(REVISIONS);
  return Response.json(NO_BACKENDS);
}

/** The Revisions section's own container, to avoid colliding with the header's "revision N" pill (same text). */
async function revisionsSection(view: RenderResult): Promise<HTMLElement> {
  const heading = await view.findByRole("heading", { name: "Revisions" });
  return heading.closest("section") as HTMLElement;
}

describe("RevisionsSection", () => {
  test("lists every revision newest first, with the current pill and a revision whose Workflow changed says so", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    await openSection(view, "Revisions");
    const section = within(await revisionsSection(view));

    expect(await section.findByText("revision 2")).toBeTruthy();
    expect(section.getByText("revision 1")).toBeTruthy();
    expect(section.getByText("current")).toBeTruthy();
    // revision 2's own hash ("hash2") differs from revision 1's ("hash1").
    expect(section.getByText("Workflow changed")).toBeTruthy();
    expect(section.getByText("1 Mode · 0 Inputs")).toBeTruthy();
  });

  test("Restore posts the current version, and the current revision has no Restore button", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      if (call.method === "POST" && call.url.endsWith("/revisions/1/restore")) {
        return Response.json({});
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Revisions");

    await within(await revisionsSection(view)).findByText("revision 2");
    const restoreButtons = await view.findAllByRole("button", {
      name: "Restore",
    });
    expect(restoreButtons).toHaveLength(1);
    await userEvent.click(restoreButtons[0] as HTMLElement);

    const dialog = await view.findByRole("dialog");
    expect(within(dialog).getByText("Restore revision 1?")).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Restore" }),
    );

    await waitFor(() => {
      const restored = calls.find(
        (c) => c.method === "POST" && c.url.endsWith("/revisions/1/restore"),
      );
      expect(restored?.body).toEqual({ version: 1 });
    });
  });

  test("Restore asks to confirm and to discard unsaved changes", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      if (call.method === "POST" && call.url.endsWith("/revisions/1/restore")) {
        return Response.json({});
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("URL slug"), "x");

    await openSection(view, "Revisions");
    await within(await revisionsSection(view)).findByText("revision 2");
    await userEvent.click(await view.findByRole("button", { name: "Restore" }));

    const dialog = await view.findByRole("dialog");
    expect(
      within(dialog).getByText("Your unsaved changes will be discarded."),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Discard and restore" }),
    ).toBeTruthy();
  });

  test("Restore shows the server's reasons on an enabled Model with errors, and 'Restore and disable' sends disable:true", async () => {
    const enabledDetail = {
      ...MODE_DETAIL,
      model: { ...MODE_DETAIL.model, state: "enabled" as const },
    };

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(enabledDetail);
      }
      if (call.method === "GET") return respondGetWithRevisions(call.url);
      if (call.method === "POST" && call.url.endsWith("/revisions/1/restore")) {
        const body = call.body as { disable?: boolean };
        if (!body.disable) {
          return Response.json(
            {
              error:
                "has errors; restore and disable this Model to save it anyway",
              reasons: ["needs at least one attached Backend"],
            },
            { status: 400 },
          );
        }
        return Response.json({});
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Revisions");

    await within(await revisionsSection(view)).findByText("revision 2");
    await userEvent.click(await view.findByRole("button", { name: "Restore" }));
    const dialog = await view.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Restore" }),
    );

    expect(
      await view.findByText(
        "has errors; restore and disable this Model to save it anyway",
      ),
    ).toBeTruthy();
    expect(
      (await view.findAllByText("needs at least one attached Backend")).length,
    ).toBeGreaterThan(0);

    const disableButton = await view.findByText("Restore and disable");
    await userEvent.click(disableButton);

    await waitFor(() => {
      const disabledCall = calls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/revisions/1/restore"),
      )[1];
      expect(disabledCall?.body).toEqual({ version: 1, disable: true });
    });
  });
});
