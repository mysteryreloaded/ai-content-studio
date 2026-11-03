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
  fireEvent,
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

describe("ModesSection", () => {
  test("adds a Mode, picks an output node through the sheet's '+ Output' picker, and saves it", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/modes")) {
        return Response.json({
          record: { ...DETAIL.model, currentRevision: 2, version: 2 },
          modes: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(view.getByText("+ Mode"));
    const nameField = view.getByLabelText("Name") as HTMLInputElement;
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Default");

    await userEvent.click(view.getByText("+ Output"));
    const row = (await view.findByText("SaveImage · #2")).closest(
      "li",
    ) as HTMLElement;
    await userEvent.click(within(row).getByText("Use"));
    await userEvent.keyboard("{Escape}");

    await userEvent.click(view.getByText("Save"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/modes"),
    );
    expect(saved?.body).toEqual({
      version: 1,
      modes: [
        {
          name: "Default",
          description: "",
          outputNodeIds: ["2"],
          inputSettings: [],
        },
      ],
    });
  });

  test("Remove output on one Mode doesn't affect another Mode's own outputs", async () => {
    const DETAIL_TWO_MODES = {
      model: DETAIL.model,
      workflowHash: "hash1",
      workflow: {
        "1": { class_type: "LoadImage", inputs: {} },
        "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
        "3": { class_type: "SaveImage", inputs: { image: ["4", 0] } },
        "4": { class_type: "LoadImage", inputs: {} },
      },
      nodes: [
        { id: "1", classType: "LoadImage", title: null },
        { id: "2", classType: "SaveImage", title: null },
        { id: "3", classType: "SaveImage", title: null },
        { id: "4", classType: "LoadImage", title: null },
      ],
      outsideServiceNotes: [],
      modes: [
        {
          id: "mode-a",
          sortOrder: 0,
          name: "Mode A",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
        {
          id: "mode-b",
          sortOrder: 1,
          name: "Mode B",
          description: "",
          outputNodes: [
            { nodeId: "3", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
      ],
      inputs: [],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_TWO_MODES);
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(await view.findByRole("button", { name: "Mode A" }));
    await userEvent.click(view.getByLabelText("Remove output"));
    expect(
      await view.findByText(/Name the node that saves this Mode's Asset/),
    ).toBeTruthy();
    await userEvent.click(view.getByRole("button", { name: "Close" }));

    await userEvent.click(await view.findByRole("button", { name: "Mode B" }));
    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByText("#3")).toBeTruthy();
  });

  test("the grid keeps both of a visible switch's branches on the Path (issue #48)", async () => {
    const STRENGTH_ID = "44444444-4444-4444-4444-444444444444";
    const FLAG_ID = "55555555-5555-5555-5555-555555555555";
    const DETAIL_SWITCH = {
      model: DETAIL.model,
      workflowHash: "hash1",
      workflow: {
        prim: { class_type: "PrimitiveBoolean", inputs: { value: true } },
        switch: {
          class_type: "ComfySwitchNode",
          inputs: {
            switch: ["prim", 0],
            on_true: ["a", 0],
            on_false: ["b", 0],
          },
        },
        a: { class_type: "LoadImage", inputs: {} },
        b: { class_type: "LoadImage", inputs: { strength: 1 } },
        out: { class_type: "SaveImage", inputs: { image: ["switch", 0] } },
      },
      nodes: [
        { id: "prim", classType: "PrimitiveBoolean", title: null },
        { id: "switch", classType: "ComfySwitchNode", title: null },
        { id: "a", classType: "LoadImage", title: null },
        { id: "b", classType: "LoadImage", title: null },
        { id: "out", classType: "SaveImage", title: null },
      ],
      outsideServiceNotes: [],
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            {
              nodeId: "out",
              classType: "SaveImage",
              title: null,
              kind: "image",
            },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: FLAG_ID,
          kind: "select",
          group: "settings",
          label: "Flag",
          help: "",
          default: null,
          options: [
            { id: "off", label: "Off", values: [false] },
            { id: "on", label: "On", values: [true] },
          ],
          bindings: [
            {
              nodeId: "prim",
              field: "value",
              classType: "PrimitiveBoolean",
              title: null,
            },
          ],
        },
        {
          id: STRENGTH_ID,
          kind: "number",
          group: "settings",
          label: "Strength",
          help: "",
          default: null,
          numberMode: "integer",
          min: 0,
          max: 10,
          step: 1,
          bindings: [
            {
              nodeId: "b",
              field: "strength",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_SWITCH);
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    await openSection(view, "Modes");

    const row = (await view.findByRole("button", { name: "Strength" })).closest(
      "tr",
    ) as HTMLElement;
    const cell = row.querySelector("td") as HTMLElement;
    // "strength" sits on the "on_false" branch, only reachable because
    // the switch is steered by a field no visible Input hides: both
    // branches stay on the Path, so this cell isn't dimmed.
    expect(cell.className).not.toContain("opacity-40");
  });

  test("the cell popover's State editor never offers Fixed for a Video or Audio Upload Input (issue #51: always a real Upload id)", async () => {
    const DETAIL_UPLOADS = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: "video-input",
          kind: "video_upload",
          group: "describe",
          label: "Clip",
          help: "",
          maxSizeMb: 50,
          maxLongSide: null,
          minDurationMs: 0,
          maxDurationMs: 10_000,
          trimmable: true,
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
        {
          id: "audio-input",
          kind: "audio_upload",
          group: "describe",
          label: "Narration",
          help: "",
          maxSizeMb: 20,
          minDurationMs: 0,
          maxDurationMs: 10_000,
          trimmable: true,
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_UPLOADS);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    for (const label of ["Clip", "Narration"]) {
      const trigger = view.getByRole("button", {
        name: new RegExp(`^${label} in Mode 1`),
      });
      await userEvent.click(trigger);
      const popover = await view.findByText("Hidden");
      const popoverContent = popover.closest(
        '[data-slot="popover-content"]',
      ) as HTMLElement;
      expect(within(popoverContent).getByText("Optional")).toBeTruthy();
      expect(within(popoverContent).queryByText("Fixed")).toBeNull();

      // Closes before the next iteration opens a different cell's popover:
      // Radix's own outside-dismiss (on the next trigger's pointerdown) and
      // that trigger's own open toggle can otherwise land in the same tick.
      await userEvent.click(trigger);
      await waitFor(() => expect(view.queryByText("Hidden")).toBeNull());
    }
  });

  test("the cell popover's State editor never offers Fixed for a Points Input (issue #52)", async () => {
    const DETAIL_POINTS = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: "points-input",
          kind: "points",
          group: "describe",
          label: "Who to replace",
          help: "",
          videoInputId: "video-input",
          widthField: { nodeId: "1", field: "width" },
          heightField: { nodeId: "1", field: "height" },
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_POINTS);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(
      view.getByRole("button", { name: /^Who to replace in Mode 1/ }),
    );
    const popover = (await view.findByText("Hidden")).closest(
      '[data-slot="popover-content"]',
    ) as HTMLElement;
    expect(within(popover).getByText("Optional")).toBeTruthy();
    expect(within(popover).queryByText("Fixed")).toBeNull();
  });

  test("Duplicate Mode adds a copy right after the original, named '… copy', and opens it", async () => {
    const DETAIL_ONE_MODE = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_ONE_MODE);
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(await view.findByRole("button", { name: "Mode 1" }));
    await userEvent.click(view.getByText("Duplicate Mode"));

    await waitFor(() => {
      const headers = view.container.querySelectorAll("thead th button");
      expect([...headers].map((el) => el.textContent)).toEqual([
        "Mode 1",
        "Mode 1 copy",
      ]);
    });
  });

  test("cell popover sets state and a Mode label, and the cell shows the label", async () => {
    const DETAIL_TEXT = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: "prompt-input",
          kind: "text",
          group: "describe",
          label: "Prompt",
          help: "",
          multiline: false,
          maxLength: 200,
          default: "",
          bindings: [
            { nodeId: "1", field: "text", classType: "LoadImage", title: null },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_TEXT);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(
      view.getByRole("button", { name: "Prompt in Mode 1: optional" }),
    );
    await userEvent.click(view.getByText("Required"));
    await userEvent.type(view.getByLabelText("Label in this Mode"), "Caption");
    await userEvent.keyboard("{Escape}");

    const cell = view.getByRole("button", {
      name: "Prompt in Mode 1: required",
    });
    expect(within(cell).getByText("Caption")).toBeTruthy();
  });

  test("a scroll inside the cell popover doesn't close it, but a scroll outside it does", async () => {
    const DETAIL_TEXT = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: "prompt-input",
          kind: "text",
          group: "describe",
          label: "Prompt",
          help: "",
          multiline: false,
          maxLength: 200,
          default: "",
          bindings: [
            { nodeId: "1", field: "text", classType: "LoadImage", title: null },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_TEXT);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(
      view.getByRole("button", { name: "Prompt in Mode 1: optional" }),
    );
    const popover = view
      .getByText("Label in this Mode")
      .closest('[data-slot="popover-content"]') as HTMLElement;
    expect(popover).toBeTruthy();

    fireEvent.scroll(popover, { bubbles: false });
    expect(view.queryByText("Label in this Mode")).toBeTruthy();

    fireEvent.scroll(window, { bubbles: false });
    expect(view.queryByText("Label in this Mode")).toBeNull();
  });

  test("Apply to every Mode whose Path holds this Input's fields copies the cell to eligible Modes only", async () => {
    const DETAIL_APPLY = {
      model: DETAIL.model,
      workflowHash: "hash1",
      workflow: {
        "1": { class_type: "CLIPTextEncode", inputs: { text: "hello" } },
        "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
        "3": { class_type: "LoadImage", inputs: {} },
        "4": { class_type: "SaveImage", inputs: { image: ["3", 0] } },
      },
      nodes: [
        { id: "1", classType: "CLIPTextEncode", title: null },
        { id: "2", classType: "SaveImage", title: null },
        { id: "3", classType: "LoadImage", title: null },
        { id: "4", classType: "SaveImage", title: null },
      ],
      outsideServiceNotes: [],
      modes: [
        {
          id: "mode-a",
          sortOrder: 0,
          name: "Mode A",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
        {
          id: "mode-b",
          sortOrder: 1,
          name: "Mode B",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
        {
          id: "mode-c",
          sortOrder: 2,
          name: "Mode C",
          description: "",
          outputNodes: [
            { nodeId: "4", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [],
        },
      ],
      inputs: [
        {
          id: "prompt-input",
          kind: "text",
          group: "describe",
          label: "Prompt",
          help: "",
          multiline: false,
          maxLength: 200,
          default: "",
          bindings: [
            {
              nodeId: "1",
              field: "text",
              classType: "CLIPTextEncode",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_APPLY);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(
      await view.findByRole("button", { name: "Prompt in Mode A: optional" }),
    );
    await userEvent.click(view.getByText("Required"));
    await userEvent.type(view.getByLabelText("Label in this Mode"), "Hi");
    await userEvent.click(
      view.getByText(
        "Apply to every Mode whose Path holds this Input's fields",
      ),
    );

    expect(
      view.getByRole("button", { name: "Prompt in Mode B: required" }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Prompt in Mode C: optional" }),
    ).toBeTruthy();
  });

  test("Mode sheet adds an output through the picker and refuses a preview node", async () => {
    const DETAIL_PREVIEW = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "LoadImage", inputs: {} },
        "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
        "3": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
      },
      nodes: [
        { id: "1", classType: "LoadImage", title: null },
        { id: "2", classType: "SaveImage", title: null },
        { id: "3", classType: "PreviewImage", title: null },
      ],
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [],
          inputSettings: [],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_PREVIEW);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(await view.findByRole("button", { name: "Mode 1" }));
    await userEvent.click(view.getByText("+ Output"));

    const previewRow = (await view.findByText("PreviewImage · #3")).closest(
      "li",
    ) as HTMLElement;
    expect(
      within(previewRow).getByText(
        "Preview node: it saves nothing, so it can't be an output.",
      ),
    ).toBeTruthy();
    expect(
      (within(previewRow).getByText("Use") as HTMLButtonElement).disabled,
    ).toBe(true);

    const saveRow = (await view.findByText("SaveImage · #2")).closest(
      "li",
    ) as HTMLElement;
    await userEvent.click(within(saveRow).getByText("Use"));

    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByText("#2")).toBeTruthy();
  });

  test("preview shows only the Mode's shown Inputs, under this Mode's own labels", async () => {
    const DETAIL_PREVIEW_INPUTS = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [
            {
              inputId: "shown-input",
              state: "optional",
              fixedValue: null,
              label: "Caption",
            },
            {
              inputId: "hidden-input",
              state: "hidden",
              fixedValue: null,
              label: "",
            },
          ],
        },
      ],
      inputs: [
        {
          id: "shown-input",
          kind: "text",
          group: "describe",
          label: "Prompt",
          help: "",
          multiline: false,
          maxLength: 200,
          default: "",
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
        {
          id: "hidden-input",
          kind: "text",
          group: "describe",
          label: "Secret Note",
          help: "",
          multiline: false,
          maxLength: 200,
          default: "",
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_PREVIEW_INPUTS);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(await view.findByRole("button", { name: "Mode 1" }));

    const preview = view.getByRole("region", { name: "What users see" });
    expect(within(preview).getByText("Caption")).toBeTruthy();
    expect(within(preview).queryByText("Secret Note")).toBeNull();
    expect(within(preview).queryByText("Prompt")).toBeNull();
  });

  test("preview shows the count picker when the seed field is on the Path even with the seed hidden", async () => {
    const DETAIL_SEED = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
          ],
          inputSettings: [
            {
              inputId: "seed-input",
              state: "hidden",
              fixedValue: null,
              label: "",
            },
          ],
        },
      ],
      inputs: [
        {
          id: "seed-input",
          kind: "seed",
          group: "settings",
          label: "Seed",
          help: "",
          max: null,
          bindings: [
            { nodeId: "1", field: "seed", classType: "LoadImage", title: null },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_SEED);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(await view.findByRole("button", { name: "Mode 1" }));

    const preview = view.getByRole("region", { name: "What users see" });
    expect(within(preview).getByText("Generations")).toBeTruthy();
    expect(within(preview).queryByText("Seed")).toBeNull();
    expect(
      within(preview).getByText(
        "This Mode shows no Inputs. Users only press Generate.",
      ),
    ).toBeTruthy();
  });
});
