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
  NO_BACKENDS,
  cleanup,
  finishFile,
  fireEvent,
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

describe("ModesSection", () => {
  // One Mode with a single text Input, shared by the cell-popover scroll
  // tests below. (Named `POP_…` to avoid shadowing the local `DETAIL_ONE_MODE`
  // constants a couple of the other tests in this file declare.)
  const POP_DETAIL = {
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

  const mockPopDetail = () => {
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(POP_DETAIL);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });
  };

  // A DOMRect-like object; `CellPopover` only ever reads `top` and `left`.
  const rectAt = (pos: { top: number; left: number }) =>
    ({
      top: pos.top,
      left: pos.left,
      x: pos.left,
      y: pos.top,
      width: 120,
      height: 22,
      right: pos.left + 120,
      bottom: pos.top + 22,
    }) as unknown as DOMRect;

  test("adds a Mode, picks an output node through + Output, and saves it", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
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

    await userEvent.click(view.getByRole("button", { name: "+ Mode" }));
    const nameField = await view.findByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Default");

    await userEvent.click(view.getByRole("button", { name: /Output$/ }));
    await userEvent.click(await view.findByRole("button", { name: "Use" }));
    await userEvent.click(view.getByRole("button", { name: "Close" }));

    await userEvent.click(view.getByRole("button", { name: "Save" }));

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

  test("Remove on one Mode's output node doesn't affect another Mode being picked", async () => {
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
        },
        {
          id: "mode-b",
          sortOrder: 1,
          name: "Mode B",
          description: "",
          outputNodes: [
            { nodeId: "3", classType: "SaveImage", title: null, kind: "image" },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_TWO_MODES);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    // Open Mode B's sheet and remove Mode A's output node from the other
    // Mode's own sheet, in turn: each sheet only ever edits its own Mode's
    // `outputNodeIds`, so removing one must leave the other's untouched.
    await userEvent.click(view.getByRole("button", { name: "Mode A" }));
    await userEvent.click(
      await view.findByRole("button", { name: "Remove output" }),
    );
    await userEvent.click(await view.findByRole("button", { name: /^Close$/ }));

    await userEvent.click(view.getByRole("button", { name: "Mode B" }));
    const dialog = await view.findByRole("dialog");
    expect(within(dialog).getByText("#3")).toBeTruthy();
  });

  test("the Input x Mode grid keeps both of a visible switch's branches on the Path (issue #48)", async () => {
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
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();

    const row = (await view.findByText("Strength")).closest(
      "tr",
    ) as HTMLElement;
    const cell = within(row).getByRole("button", { name: /^Strength in/ });
    // "strength" sits on the "on_false" branch, only reachable because
    // the switch is steered by a field no visible Input hides: both
    // branches stay on the Path, so this cell isn't dimmed.
    expect(cell.closest("td")?.className).not.toContain("opacity-40");
  });

  test("Mode sheet's Path node count agrees with the grid for a switch steered by a visible Input (issue #48/#216)", async () => {
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
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(view.getByRole("button", { name: "Mode 1" }));
    const sheet = view.getByRole("dialog");

    // The switch is steered by a field no visible Input hides, so both
    // branches stay on the Path: all 5 nodes, same as the grid's own Path
    // computation for this Mode (issue #48).
    expect(await within(sheet).findByText("5")).toBeTruthy();
    expect(within(sheet).getByText(/of 5 nodes are sent/)).toBeTruthy();
  });

  test("the Input x Mode grid's cell popover never offers Fixed for a Video or Audio Upload Input (issue #51: always a real Upload id)", async () => {
    const DETAIL_UPLOADS = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "1", classType: "LoadImage", title: null, kind: null },
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
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    for (const label of ["Clip", "Narration"]) {
      await userEvent.click(
        await view.findByRole("button", { name: new RegExp(`^${label} in`) }),
      );
      expect(view.queryByRole("radio", { name: "Fixed" })).toBeNull();
      expect(view.getByRole("radio", { name: "Optional" })).toBeTruthy();
      await userEvent.keyboard("{Escape}");
    }
  });

  test("the Input x Mode grid's cell popover never offers Fixed for a Points Input (issue #52)", async () => {
    const DETAIL_POINTS = {
      ...DETAIL,
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Mode 1",
          description: "",
          outputNodes: [
            { nodeId: "1", classType: "LoadImage", title: null, kind: null },
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
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await userEvent.click(
      await view.findByRole("button", { name: /^Who to replace in/ }),
    );
    expect(view.queryByRole("radio", { name: "Fixed" })).toBeNull();
    expect(view.getByRole("radio", { name: "Optional" })).toBeTruthy();
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
            { nodeId: "1", classType: "LoadImage", title: null, kind: null },
          ],
          inputSettings: [],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_ONE_MODE);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(view.getByRole("button", { name: "Mode 1" }));
    await userEvent.click(view.getByRole("button", { name: "Duplicate Mode" }));

    expect(await view.findByDisplayValue("Mode 1 copy")).toBeTruthy();
  });

  test("cell popover sets state and a Mode label, and the cell shows the label", async () => {
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
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_ONE_MODE);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await userEvent.click(
      await view.findByRole("button", { name: /^Prompt in Mode 1/ }),
    );
    await userEvent.click(view.getByRole("radio", { name: "Required" }));
    await userEvent.type(
      view.getByLabelText("Label in this Mode"),
      "Describe the scene",
    );
    await userEvent.keyboard("{Escape}");

    expect(
      view.getByRole("button", {
        name: "Prompt in Mode 1: Required",
      }),
    ).toBeTruthy();
    expect(await view.findByText("Describe the scene")).toBeTruthy();
  });

  test("fixing a select Input to an option shows its label, not the option's id (issue #216)", async () => {
    const DETAIL_SELECT_MODE = {
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
          id: "style-input",
          kind: "select",
          group: "settings",
          label: "Style",
          help: "",
          default: null,
          options: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              label: "Watercolor",
              values: ["watercolor"],
            },
            {
              id: "22222222-2222-2222-2222-222222222222",
              label: "Oil",
              values: ["oil"],
            },
          ],
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
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_SELECT_MODE);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await userEvent.click(
      await view.findByRole("button", { name: /^Style in Mode 1/ }),
    );
    await userEvent.click(view.getByRole("radio", { name: "Fixed" }));
    await userEvent.selectOptions(
      view.getByLabelText("Style fixed value"),
      "11111111-1111-1111-1111-111111111111",
    );
    await userEvent.keyboard("{Escape}");

    expect(
      view.getByRole("button", {
        name: "Style in Mode 1: Fixed (Watercolor)",
      }),
    ).toBeTruthy();
    expect(view.getByText("Watercolor")).toBeTruthy();
    expect(view.queryByText("11111111-1111-1111-1111-111111111111")).toBeNull();
  });

  // The popover tracks the trigger's viewport position: the editor is a
  // fixed-height box whose grid and pane each have their own `overflow-auto`
  // scroll containers that never move `document.scrollingElement`. These
  // tests mock `getBoundingClientRect` so that, on open, the popover records a
  // start position; moving `cell` then simulates a container having scrolled
  // the cell out of place (while a constant `cell` simulates the zero-delta
  // `scroll` Chromium fires when Radix's FocusScope focuses the popover).
  // Each test opens the popover exactly once: re-opening the same Radix
  // trigger after an Escape is unreliable under happy-dom.

  test("cell popover closes on a scroll in the grid's own container that moves the cell (issue #216)", async () => {
    mockPopDetail();
    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    const button = await view.findByRole("button", {
      name: /^Prompt in Mode 1/,
    });
    let cell = { top: 100, left: 10 };
    button.getBoundingClientRect = () => rectAt(cell);
    await userEvent.click(button);
    await view.findByText("Label in this Mode");
    // The cell's nearest `div` ancestor is the grid's own scroll container
    // (`ModeInputGrid`'s `overflow-auto`); scrolling it moves the cell without
    // ever touching `document.scrollingElement`, so it must close.
    const gridScrollContainer = button.closest("div") as HTMLElement;
    cell = { top: 50, left: 10 };
    fireEvent.scroll(gridScrollContainer);
    await waitFor(() =>
      expect(view.queryByText("Label in this Mode")).toBeNull(),
    );
  });

  test("cell popover stays open on a same-position scroll, closing only once the cell actually moves (issue #216)", async () => {
    mockPopDetail();
    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    const button = await view.findByRole("button", {
      name: /^Prompt in Mode 1/,
    });
    // A constant rect: the scroll reads the same position recorded on open.
    const cell = { top: 100, left: 10 };
    button.getBoundingClientRect = () => rectAt(cell);
    await userEvent.click(button);
    const gridScrollContainer = button.closest("div") as HTMLElement;
    fireEvent.scroll(gridScrollContainer);
    expect(view.getByText("Label in this Mode")).toBeTruthy();
  });

  test("cell popover stays open on a scroll inside its own content (issue #216)", async () => {
    mockPopDetail();
    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    const button = await view.findByRole("button", {
      name: /^Prompt in Mode 1/,
    });
    await userEvent.click(button);
    // A scroll originating inside the popover's own content isn't "the page
    // moved under it", so it stays open.
    const popoverContent = await view.findByText("Label in this Mode");
    fireEvent.scroll(popoverContent);
    expect(view.getByText("Label in this Mode")).toBeTruthy();
  });

  test("cell popover closes on a window scroll that moves the trigger (issue #216)", async () => {
    mockPopDetail();
    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    const button = await view.findByRole("button", {
      name: /^Prompt in Mode 1/,
    });
    let cell = { top: 100, left: 10 };
    button.getBoundingClientRect = () => rectAt(cell);
    await userEvent.click(button);
    await view.findByText("Label in this Mode");
    // A whole-window scroll moves the trigger too, so it closes.
    cell = { top: 60, left: 10 };
    document.documentElement.scrollTop = 50;
    fireEvent.scroll(window);
    await waitFor(() =>
      expect(view.queryByText("Label in this Mode")).toBeNull(),
    );
    // Reset so the scroll position can't leak into other tests in this file.
    document.documentElement.scrollTop = 0;
  });

  test("Apply to every Mode whose Path holds this Input's fields copies the cell to eligible Modes only", async () => {
    const DETAIL_TWO_MODES = {
      model: DETAIL.model,
      workflowHash: "hash1",
      workflow: {
        "1": { class_type: "LoadImage", inputs: {} },
        "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
        "3": { class_type: "LoadImage", inputs: {} },
        "4": { class_type: "SaveImage", inputs: { image: ["3", 0] } },
      },
      nodes: [
        { id: "1", classType: "LoadImage", title: null },
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
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_TWO_MODES);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await userEvent.click(
      await view.findByRole("button", { name: /^Prompt in Mode A/ }),
    );
    await userEvent.click(view.getByRole("radio", { name: "Required" }));
    await userEvent.click(
      view.getByRole("button", {
        name: "Apply to every Mode whose Path holds this Input's fields",
      }),
    );

    // Mode A's own Input is bound to node "1", on Mode A's Path but not
    // Mode B's (which depends on node "3" instead) — so only Mode A's
    // cell picks up Required; Mode B's stays Optional.
    expect(
      view.getByRole("button", { name: "Prompt in Mode A: Required" }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Prompt in Mode B: Optional" }),
    ).toBeTruthy();
  });

  test("Mode sheet adds an output through the picker and refuses a preview node", async () => {
    const DETAIL_WITH_PREVIEW = {
      ...DETAIL,
      workflow: {
        ...DETAIL.workflow,
        "3": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
      },
      nodes: [
        ...DETAIL.nodes,
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
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_WITH_PREVIEW);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(view.getByRole("button", { name: "Mode 1" }));
    await userEvent.click(view.getByRole("button", { name: /Output$/ }));
    await userEvent.click(
      await view.findByText("Show every node (for custom save nodes)"),
    );

    const previewRow = (
      await view.findByText(
        "Preview node: it saves nothing, so it can't be an output.",
      )
    ).closest("div");
    expect(
      (
        within(previewRow as HTMLElement).getByRole("button", {
          name: "Use",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    const pickerDialog = view.getByRole("dialog");
    await userEvent.click(
      within(
        within(pickerDialog).getByText("#2").closest("div") as HTMLElement,
      ).getByRole("button", { name: "Use" }),
    );

    // Picking closes the "Pick an output node" dialog, leaving only the
    // Mode sheet (also a `role="dialog"`) behind.
    await waitFor(() => expect(view.getAllByRole("dialog")).toHaveLength(1));
    const sheet = view.getByRole("dialog");
    expect(within(sheet).getByText("#2")).toBeTruthy();
  });

  test("Mode sheet's output row shows the inferred kind, not the raw class_type (issue #216)", async () => {
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
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(view.getByRole("button", { name: "Mode 1" }));
    const sheet = view.getByRole("dialog");

    // The output row's kind pill must show "image" (via inferOutputNodeKind),
    // not the raw class_type "SaveImage".
    const row = within(sheet).getByText("#2").closest("li") as HTMLElement;
    expect(within(row).getByText("image")).toBeTruthy();
  });

  test("preview shows only the Mode's shown Inputs under its labels", async () => {
    const DETAIL_PREVIEW = {
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
              inputId: "hidden-input",
              state: "hidden",
              fixedValue: null,
              label: "",
            },
            {
              inputId: "shown-input",
              state: "required",
              fixedValue: null,
              label: "",
            },
          ],
        },
      ],
      inputs: [
        {
          id: "hidden-input",
          kind: "text",
          group: "describe",
          label: "Hidden Prompt",
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
          id: "shown-input",
          kind: "text",
          group: "describe",
          label: "Shown Prompt",
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
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_PREVIEW);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(view.getByRole("button", { name: "Mode 1" }));
    expect(await view.findByText("What users see")).toBeTruthy();
    expect(view.getByLabelText("Shown Prompt")).toBeTruthy();
    expect(view.queryByLabelText("Hidden Prompt")).toBeNull();
  });

  test("preview shows the count picker when the seed field is on the Path even with the seed hidden", async () => {
    const DETAIL_SEED = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "KSampler", inputs: { seed: 0 } },
        "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
      },
      nodes: [
        { id: "1", classType: "KSampler", title: null },
        { id: "2", classType: "SaveImage", title: null },
      ],
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
          default: null,
          bindings: [
            { nodeId: "1", field: "seed", classType: "KSampler", title: null },
          ],
        },
      ],
    };

    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1"))
        return Response.json(DETAIL_SEED);
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Modes");

    await userEvent.click(view.getByRole("button", { name: "Mode 1" }));
    await waitFor(() => expect(view.getByText("Generations")).toBeTruthy());
  });
});
