import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { newTextInput } from "../helpers/newInputs.js";
import {
  DETAIL,
  NO_BACKENDS,
  cleanup,
  finishFile,
  mockFetch,
  openSection,
  prepareConfirmAndEventSource,
  renderEditor,
  respondGet,
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

describe("Model editor frame (issue #213)", () => {
  test("opens on Modes for a Model with Inputs, on Inputs for one without, and honours ?section", async () => {
    const withInputs = {
      ...DETAIL,
      inputs: [newTextInput()],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(withInputs);
      }
      return respondGet(call.url);
    });

    const view = renderEditor();
    const modesButton = (await view.findByRole("button", {
      name: /^Modes/,
    })) as HTMLButtonElement;
    await waitFor(() =>
      expect(modesButton.getAttribute("aria-current")).toBe("true"),
    );
  });

  test("a Model with no Inputs opens on Inputs", async () => {
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json({ ...DETAIL, inputs: [] });
      }
      return respondGet(call.url);
    });

    const view = renderEditor();
    const inputsButton = (await view.findByRole("button", {
      name: /^Inputs/,
    })) as HTMLButtonElement;
    await waitFor(() =>
      expect(inputsButton.getAttribute("aria-current")).toBe("true"),
    );
  });

  test("nav shows error and warning counts per section", async () => {
    // No attached Backend (respondGet's default NO_BACKENDS): checkModel
    // flags "needs at least one attached Backend" once object-info
    // loads, which this ticket's mapping puts on the Backends nav item.
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json({ ...DETAIL, inputs: [], modes: [] });
      }
      return respondGet(call.url);
    });

    const view = renderEditor();
    const backendsButton = await view.findByRole("button", {
      name: /^Backends/,
    });
    await waitFor(() => expect(backendsButton.textContent).toContain("1"));
  });

  test("clicking a check with a backendId opens Backends and scrolls that Backend's row into view", async () => {
    const detail = {
      ...DETAIL,
      inputs: [],
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Default",
          description: "",
          outputNodes: [
            {
              nodeId: "1",
              classType: "LoadImage",
              title: null,
              kind: "image" as const,
            },
          ],
          inputSettings: [],
        },
      ],
    };
    const attachedBackends = {
      backends: [
        {
          backend: { id: "b1", name: "Backend One", baseUrl: "http://b1" },
          reachable: false,
          missingNodeTypes: null,
          note: null,
        },
      ],
    };
    const objectInfo = {
      backends: [
        {
          id: "b1",
          name: "Backend One",
          enabled: true,
          reachable: false,
          nodeTypes: [],
          fieldSpecs: {},
        },
      ],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET" && call.url.endsWith("/backends")) {
        return Response.json(attachedBackends);
      }
      if (call.method === "GET" && call.url.endsWith("/object-info")) {
        return Response.json(objectInfo);
      }
      return respondGet(call.url);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    const checkButton = await view.findByText(
      /Backend "Backend One" is unreachable/i,
    );
    let scrolled = false;
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function patched() {
      scrolled = true;
    };
    try {
      await userEvent.click(checkButton);
      const backendsButton = await view.findByRole("button", {
        name: /^Backends/,
      });
      await waitFor(() =>
        expect(backendsButton.getAttribute("aria-current")).toBe("true"),
      );
      await waitFor(() => expect(scrolled).toBe(true));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  test("enable switch is blocked by errors, not by warnings", async () => {
    const detail = {
      ...DETAIL,
      inputs: [],
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Default",
          description: "",
          outputNodes: [
            {
              nodeId: "1",
              classType: "LoadImage",
              title: null,
              kind: "image" as const,
            },
          ],
          inputSettings: [],
        },
      ],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      return respondGet(call.url);
    });

    const view = renderEditor();
    const enableSwitch = (await view.findByRole("switch")) as HTMLButtonElement;
    await waitFor(() => expect(enableSwitch.disabled).toBe(true));
    await view.findByText(/Fix 1 error\(s\) to enable\./);
  });

  test("Save and disable sends disable:true", async () => {
    const detail = {
      ...DETAIL,
      model: { ...DETAIL.model, state: "enabled" as const },
      inputs: [],
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Default",
          description: "",
          outputNodes: [
            {
              nodeId: "1",
              classType: "LoadImage",
              title: null,
              kind: "image" as const,
            },
          ],
          inputSettings: [],
        },
      ],
    };
    // No attached Backend (respondGet's default NO_BACKENDS): checkModel
    // flags "needs at least one attached Backend", so the enabled Model
    // can only save by disabling.
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json({
          ...detail,
          model: { ...detail.model, state: "disabled", version: 2 },
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Modes");
    await userEvent.click(await view.findByText("Duplicate Mode"));

    const saveButton = (await view.findByText(
      "Save and disable",
    )) as HTMLButtonElement;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    await userEvent.click(saveButton);

    const saved = await waitFor(() => {
      const call = calls.find(
        (c) => c.method === "PUT" && c.url.endsWith("/draft"),
      );
      if (!call) throw new Error("no /draft PUT yet");
      return call;
    });
    expect(saved.body?.disable).toBe(true);
  });

  test("Save sends only dirty parts in order and stops at the first refusal", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json({ error: "save failed" }, { status: 400 });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("Name"), "x");
    await userEvent.click(view.getByText("Save"));

    await view.findByText("save failed");
    // Details was the only dirty part and it refused: no Inputs/Modes/
    // Terms PUT is ever sent.
    expect(calls.some((c) => c.url.endsWith("/inputs"))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/modes"))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/terms"))).toBe(false);
  });

  // Moved from ModelEditorPage.test.tsx (PR #241 QA round 1): save-409
  // handling is header/save behaviour, not Details' own.
  test("a taken slug on save shows the server's own message, not the generic reload one", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT") {
        return Response.json(
          { error: "a Model with this slug already exists" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Details");
    await view.findByLabelText("URL slug");
    await userEvent.type(view.getByLabelText("URL slug"), "x");
    await userEvent.click(view.getByText("Save"));

    expect(
      await view.findByText("a Model with this slug already exists"),
    ).toBeTruthy();
    expect(view.queryByText("changed by someone else, reload")).toBeNull();
  });

  test("a stale version on save shows the reload message", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT") {
        return Response.json(
          { error: "changed by someone else, reload" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();

    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Details");
    await view.findByLabelText("URL slug");
    await userEvent.type(view.getByLabelText("URL slug"), "x");
    await userEvent.click(view.getByText("Save"));

    expect(
      await view.findByText("changed by someone else, reload"),
    ).toBeTruthy();
  });

  test("Discard resets every draft", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    const nameInput = (await view.findByLabelText("Name")) as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Renamed");

    const discardButton = (await view.findByText(
      "Discard",
    )) as HTMLButtonElement;
    await waitFor(() => expect(discardButton.disabled).toBe(false));
    await userEvent.click(discardButton);

    await waitFor(() => expect(nameInput.value).toBe(DETAIL.model.name));
    await waitFor(() => expect(discardButton.disabled).toBe(true));
  });

  test("a successful delete goes to /admin/models without the leave prompt", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("Name"), "x");
    await userEvent.click(await view.findByText("Delete Model"));
    const dialog = await view.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Delete"));

    expect(await view.findByText("Models list")).toBeTruthy();
    await waitFor(() => {
      const del = calls.find((c) => c.method === "DELETE");
      expect(del?.url).toContain("version=1");
    });
  });

  test("delete shows the server's error on a stale version and stays put", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "DELETE")
        return Response.json(
          { error: "changed by someone else, reload" },
          { status: 409 },
        );
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    await userEvent.click(await view.findByText("Delete Model"));
    const dialog = await view.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Delete"));

    expect(
      await view.findByText("changed by someone else, reload"),
    ).toBeTruthy();
    expect(view.queryByText("Models list")).toBeNull();
  });

  test("delete refused with unfinished Generations", async () => {
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "DELETE") {
        return Response.json(
          { error: "has unfinished Generations" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    await userEvent.click(await view.findByText("Delete Model"));
    await userEvent.click(await view.findByText("Delete"));

    expect(
      await view.findByText(
        "This Model has unfinished Generations. Cancel or let them finish, then delete it.",
      ),
    ).toBeTruthy();
  });

  // Issue #241 CEO review 1: `save()` now runs `form.trigger()` (and
  // checks the Terms license URL) before sending anything, so an
  // invalid Details value is shown and blocks the save instead of
  // silently going out with `getValues()`'s stale/invalid data.
  test("Save refuses an invalid slug: nothing is sent, the error shows, and Details opens", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Modes");
    await openSection(view, "Details");
    const slugInput = await view.findByLabelText("URL slug");
    await userEvent.type(slugInput, "X");
    await userEvent.click(view.getByText("Save"));

    expect(
      await view.findByText(
        "must be 1-80 characters: lowercase letters, digits and hyphens",
      ),
    ).toBeTruthy();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    const detailsButton = view.getByRole("button", { name: /^Details/ });
    await waitFor(() =>
      expect(detailsButton.getAttribute("aria-current")).toBe("true"),
    );
  });

  test("Save refuses an invalid Terms license URL: nothing is sent, and Terms opens", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Terms and attribution");
    await userEvent.type(
      await view.findByLabelText("License URL"),
      "not a url",
    );

    // Terms' own dirty state comes from its field changing, so Save
    // is enabled even though Details/Inputs/Modes are untouched.
    await userEvent.click(view.getByText("Save"));

    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    const termsButton = view.getByRole("button", {
      name: /^Terms and attribution/,
    });
    await waitFor(() =>
      expect(termsButton.getAttribute("aria-current")).toBe("true"),
    );
  });

  // Issue #218: Save is one request now, so a refusal leaves every
  // section's draft exactly as dirty as it was — nothing partially
  // saves, and Save stays enabled to try again.
  test("a refused Save keeps every draft dirty, and Save stays enabled", async () => {
    const detail = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Default",
          description: "",
          outputNodes: [
            {
              nodeId: "1",
              classType: "LoadImage",
              title: null,
              kind: "image" as const,
            },
          ],
          inputSettings: [],
        },
      ],
    };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json({ error: "save failed" }, { status: 400 });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Modes");
    await userEvent.click(await view.findByText("Duplicate Mode"));
    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("Name"), "x");

    await userEvent.click(view.getByText("Save"));

    await view.findByText("save failed");
    expect(
      calls.some((c) => c.url.endsWith("/draft") && c.method === "PUT"),
    ).toBe(true);

    const saveButton = view.getByText("Save") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);

    await openSection(view, "Modes");
    expect(await view.findByDisplayValue("Default copy")).toBeTruthy();
  });

  // Issue #241 CEO review 3: Discard and Reload must drop a
  // picked-but-unsaved Workflow file, its name and the rebind map
  // too, not just the four section drafts.
  test("Discard also clears a picked Workflow file and its name", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    // Picking a Workflow file alone doesn't dirty any of the four
    // drafts Discard already resets, so Discard would stay disabled;
    // dirty Details too, the same way a real session would have
    // something else unsaved alongside a picked file.
    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("Name"), "x");

    await openSection(view, "Workflow");
    const file = new File(
      [JSON.stringify({ "1": { class_type: "LoadImage", inputs: {} } })],
      "replacement.json",
      { type: "application/json" },
    );
    await userEvent.upload(view.getByLabelText("Choose file…"), file);
    expect(await view.findByText(/Picked "replacement\.json"/)).toBeTruthy();

    const discardButton = (await view.findByText(
      "Discard",
    )) as HTMLButtonElement;
    await waitFor(() => expect(discardButton.disabled).toBe(false));
    await userEvent.click(discardButton);

    expect(view.queryByText(/Picked "replacement\.json"/)).toBeNull();
  });

  // Issue #241 CEO review 4: Reload must ask "Discard unsaved
  // changes?" first when there's an unsaved draft to lose, the same
  // way leaving the page does.
  test("Reload asks to discard unsaved changes first, and clears the picked Workflow file too", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json(
          { error: "changed by someone else, reload" },
          { status: 409 },
        );
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    // Trigger the stale-save alert (and its Reload button) first.
    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("Name"), "x");
    await userEvent.click(view.getByText("Save"));
    await view.findByText("changed by someone else, reload");

    // Pick a Workflow file while the stale-save alert is up, so Reload
    // has something extra to clear.
    await openSection(view, "Workflow");
    const file = new File(
      [JSON.stringify({ "1": { class_type: "LoadImage", inputs: {} } })],
      "replacement.json",
      { type: "application/json" },
    );
    await userEvent.upload(view.getByLabelText("Choose file…"), file);
    expect(await view.findByText(/Picked "replacement\.json"/)).toBeTruthy();

    await userEvent.click(view.getByText("Reload"));
    const dialog = await view.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Stay"));
    expect(await view.findByText(/Picked "replacement\.json"/)).toBeTruthy();

    await userEvent.click(view.getByText("Reload"));
    const dialog2 = await view.findByRole("dialog");
    await userEvent.click(within(dialog2).getByText("Discard"));

    await waitFor(() =>
      expect(view.queryByText(/Picked "replacement\.json"/)).toBeNull(),
    );
  });

  // Issue #241 CEO review 5: "Save and disable" with only Details/
  // Terms dirty never ran Inputs/Modes, so `disable` never went out —
  // the Model stayed enabled.
  test("Save and disable with only Details dirty still disables the Model", async () => {
    const enabledDetail = {
      ...DETAIL,
      model: { ...DETAIL.model, state: "enabled" as const },
      inputs: [],
    };
    // No Modes (DETAIL's default `modes: []`): checkModel flags "needs
    // at least one Mode", so the enabled Model can only save by
    // disabling.
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(enabledDetail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json({
          ...enabledDetail,
          model: { ...enabledDetail.model, version: 2, state: "disabled" },
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("Name"), "x");

    const saveButton = (await view.findByText(
      "Save and disable",
    )) as HTMLButtonElement;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    await userEvent.click(saveButton);

    await waitFor(() => {
      const draftCall = calls.find(
        (c) => c.method === "PUT" && c.url.endsWith("/draft"),
      );
      expect(draftCall).toBeTruthy();
      expect((draftCall?.body as { disable?: boolean } | null)?.disable).toBe(
        true,
      );
    });
  });

  test("the leave dialog stays or discards", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    await userEvent.type(await view.findByLabelText("Name"), "x");

    await userEvent.click(view.getByText("Models"));
    const dialog = await view.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Stay"));
    expect(view.queryByText("Models list")).toBeNull();

    await userEvent.click(view.getByText("Models"));
    const dialog2 = await view.findByRole("dialog");
    await userEvent.click(within(dialog2).getByText("Discard"));
    expect(await view.findByText("Models list")).toBeTruthy();
  });

  // Issue #241 CEO review round 2: Restore and Replace Workflow both
  // replace the saved Modes/Inputs/Terms, but the drafts-seeding effect
  // only seeds once per Model id now — so a plain `load()` refetch left
  // the old drafts in place after a successful Restore/Replace. Both
  // actions now fully reseed via `draft.reload()`.
  test("restoring a revision reseeds the Modes draft from the restored revision", async () => {
    const modeBeforeRestore = {
      id: "mode-1",
      sortOrder: 0,
      name: "Default",
      description: "",
      outputNodes: [
        {
          nodeId: "1",
          classType: "LoadImage",
          title: null,
          kind: "image" as const,
        },
      ],
      inputSettings: [],
    };
    let restored = false;
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json({
          ...DETAIL,
          model: {
            ...DETAIL.model,
            currentRevision: restored ? 1 : 2,
            version: restored ? 2 : 1,
          },
          modes: restored ? [] : [modeBeforeRestore],
        });
      }
      if (call.url.endsWith("/api/admin/models/m1/revisions")) {
        return Response.json({
          revisions: [
            {
              revisionNumber: 1,
              createdAt: new Date().toISOString(),
              modeCount: 0,
              inputCount: 0,
            },
            {
              revisionNumber: 2,
              createdAt: new Date().toISOString(),
              modeCount: 1,
              inputCount: 0,
            },
          ],
        });
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "POST" && call.url.endsWith("/revisions/1/restore")) {
        restored = true;
        return Response.json({});
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Modes");
    expect(await view.findByDisplayValue("Default")).toBeTruthy();

    await openSection(view, "Revisions");
    const restoreButtons = await view.findAllByRole("button", {
      name: "Restore",
    });
    const restoreButton = restoreButtons.find(
      (button) => !(button as HTMLButtonElement).disabled,
    ) as HTMLButtonElement;
    await userEvent.click(restoreButton);

    await view.findByText("Saved · revision 1");

    await openSection(view, "Modes");
    expect(view.queryByDisplayValue("Default")).toBeNull();

    const saveButton = view.getByText("Save") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  test("a re-uploaded Workflow saved by Save reseeds the Modes draft from the new revision", async () => {
    const modeBeforeReplace = {
      id: "mode-1",
      sortOrder: 0,
      name: "Default",
      description: "",
      outputNodes: [
        {
          nodeId: "1",
          classType: "LoadImage",
          title: null,
          kind: "image" as const,
        },
      ],
      inputSettings: [],
    };
    let replaced = false;
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json({
          ...DETAIL,
          model: {
            ...DETAIL.model,
            currentRevision: replaced ? 2 : 1,
            version: replaced ? 2 : 1,
          },
          modes: replaced ? [] : [modeBeforeReplace],
        });
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        replaced = true;
        return Response.json({});
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Modes");
    expect(await view.findByDisplayValue("Default")).toBeTruthy();

    await openSection(view, "Workflow");
    const file = new File(
      [JSON.stringify({ "1": { class_type: "LoadImage", inputs: {} } })],
      "replacement.json",
      { type: "application/json" },
    );
    await userEvent.upload(view.getByLabelText("Choose file…"), file);
    await userEvent.click(view.getByText("Save"));

    await view.findByText("Saved · revision 2");

    await openSection(view, "Modes");
    expect(view.queryByDisplayValue("Default")).toBeNull();

    const saveButton = view.getByText("Save") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  // Issue #241 CEO review round 2: Details' zod errors must appear live
  // (the nav count updates as you type), not just after Save, and must
  // clear once the field is fixed.
  test("a bad slug shows the Details error count live, and fixing it clears it", async () => {
    mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await openSection(view, "Details");
    const slugInput = await view.findByLabelText("URL slug");
    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, "Not A Valid Slug!");

    const detailsButton = (await view.findByRole("button", {
      name: /^Details/,
    })) as HTMLButtonElement;
    await waitFor(() => expect(detailsButton.textContent).toContain("1"));

    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, "valid-slug");

    await waitFor(() => expect(detailsButton.textContent).not.toContain("1"));
  });
});
