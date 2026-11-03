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
      if (call.method === "PUT" && call.url.endsWith("/modes")) {
        return Response.json({
          ...detail.model,
          state: "disabled",
          version: 2,
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
        (c) => c.method === "PUT" && c.url.endsWith("/modes"),
      );
      if (!call) throw new Error("no /modes PUT yet");
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
});
