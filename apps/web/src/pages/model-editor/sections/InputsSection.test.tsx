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

/**
 * Issue #215's Input sheet nests `BindingPicker` (a Dialog) inside
 * itself (also a Dialog, via `Sheet`): both stay in the DOM as Radix
 * portals outside this file's render `container`, so a plain
 * `getByText`/`getByRole` after binding a field can match the same
 * text in both the (still open) sheet and the Inputs table row behind
 * it. `userEvent.click` on the inner picker's "Bind" button is also
 * flaky across this file's other tests, sharing one happy-dom globally
 * registered DOM per `--isolate` run — `fireEvent.click` (no
 * synthesized pointerdown/up, no ancestor pointer-events check) is
 * used on it instead.
 */
function clickBind(element: HTMLElement) {
  fireEvent.click(element);
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

describe("InputsSection (issue #215)", () => {
  test("adds an Image upload Input bound to a loader's file field and saves it (issue #50)", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
      },
      inputs: [],
    };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json(detail);
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");
    await userEvent.click(view.getByText("New Input"));
    await userEvent.click(view.getByText("Image Upload"));

    await userEvent.type(view.getByLabelText("Label"), "Photo");
    const maxSize = view.getByLabelText("Max size (MB)");
    await userEvent.clear(maxSize);
    await userEvent.type(maxSize, "10");
    await userEvent.type(view.getByLabelText("Max long side (px)"), "2048");

    await userEvent.click(view.getByText("Bind a field"));
    await userEvent.click(view.getByText("LoadImage"));
    clickBind(
      within(view.getByText("image").closest("div") as HTMLElement).getByText(
        "Bind",
      ),
    );

    await userEvent.click(view.getByRole("button", { name: "Close" }));
    await userEvent.click(view.getByText("Save"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/draft"),
    );
    expect(saved?.body?.inputs).toEqual([
      {
        id: expect.any(String),
        kind: "image_upload",
        group: "settings",
        label: "Photo",
        help: "",
        maxSizeMb: 10,
        maxLongSide: 2048,
        bindings: [
          { nodeId: "1", field: "image", classType: "LoadImage", title: null },
        ],
      },
    ]);
  });

  test("adds a Points Input: picks its video Input, Width/Height fields and its own bound field, then saves it (issue #52)", async () => {
    const videoInput = {
      id: "video-input",
      kind: "video_upload" as const,
      group: "describe" as const,
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
          field: "video",
          classType: "VHS_LoadVideo",
          title: null,
        },
      ],
    };
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "VHS_LoadVideo", inputs: { video: "example.mp4" } },
        "2": {
          class_type: "EmptyLatentImage",
          inputs: { width: 512, height: 512 },
        },
        "3": { class_type: "PointsEditor", inputs: { points: "" } },
      },
      nodes: [
        { id: "1", classType: "VHS_LoadVideo", title: null },
        { id: "2", classType: "EmptyLatentImage", title: null },
        { id: "3", classType: "PointsEditor", title: null },
      ],
      inputs: [videoInput],
    };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json(detail);
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");
    await userEvent.click(view.getByText("New Input"));
    await userEvent.click(view.getByText("Points on a frame"));

    await userEvent.type(view.getByLabelText("Label"), "Who to replace");

    await userEvent.selectOptions(
      view.getByLabelText("Video Input"),
      "video-input",
    );

    await userEvent.click(view.getByLabelText("Width field"));
    await userEvent.click(view.getByText("EmptyLatentImage"));
    clickBind(
      within(view.getByText("width").closest("div") as HTMLElement).getByText(
        "Bind",
      ),
    );

    await userEvent.click(view.getByLabelText("Height field"));
    await userEvent.click(view.getByText("EmptyLatentImage"));
    clickBind(
      within(view.getByText("height").closest("div") as HTMLElement).getByText(
        "Bind",
      ),
    );

    await userEvent.click(view.getByText("Bind a field"));
    await userEvent.click(view.getByText("PointsEditor"));
    clickBind(
      within(view.getByText("points").closest("div") as HTMLElement).getByText(
        "Bind",
      ),
    );

    await userEvent.click(view.getByRole("button", { name: "Close" }));
    await userEvent.click(view.getByText("Save"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/draft"),
    );
    expect(saved?.body?.inputs).toEqual([
      videoInput,
      {
        id: expect.any(String),
        kind: "points",
        group: "settings",
        label: "Who to replace",
        help: "",
        videoInputId: "video-input",
        widthField: { nodeId: "2", field: "width" },
        heightField: { nodeId: "2", field: "height" },
        bindings: [
          {
            nodeId: "3",
            field: "points",
            classType: "PointsEditor",
            title: null,
          },
        ],
      },
    ]);
  });

  test("reorders Inputs with Move up/down", async () => {
    const detail = {
      ...DETAIL,
      inputs: [
        {
          id: "a",
          kind: "text" as const,
          group: "describe" as const,
          label: "A",
          help: "",
          default: "",
          multiline: false,
          maxLength: 2000,
          bindings: [],
        },
        {
          id: "b",
          kind: "text" as const,
          group: "describe" as const,
          label: "B",
          help: "",
          default: "",
          multiline: false,
          maxLength: 2000,
          bindings: [],
        },
      ],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");

    const rowsBefore = view.getAllByRole("row");
    expect(within(rowsBefore[1] as HTMLElement).getByText("A")).toBeTruthy();
    expect(within(rowsBefore[2] as HTMLElement).getByText("B")).toBeTruthy();

    const moveDownButtons = view.getAllByLabelText("Move down");
    await userEvent.click(moveDownButtons[0] as HTMLElement);

    const rowsAfter = view.getAllByRole("row");
    expect(within(rowsAfter[1] as HTMLElement).getByText("B")).toBeTruthy();
    expect(within(rowsAfter[2] as HTMLElement).getByText("A")).toBeTruthy();
  });

  test("a row's Input button opens the sheet from the keyboard", async () => {
    const detail = {
      ...DETAIL,
      inputs: [
        {
          id: "a",
          kind: "text" as const,
          group: "describe" as const,
          label: "Prompt",
          help: "",
          default: "",
          multiline: false,
          maxLength: 2000,
          bindings: [],
        },
      ],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");

    const rowButton = view.getByRole("button", { name: /^Prompt/ });
    rowButton.focus();
    await userEvent.keyboard("{Enter}");

    expect(view.getByLabelText("Label")).toBeTruthy();
  });

  test("Bind a field opens the picker and adds the binding", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
      },
      inputs: [],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");
    await userEvent.click(view.getByText("New Input"));
    await userEvent.click(view.getByText("Text"));
    await waitFor(() => expect(view.queryByRole("menu")).toBeNull());

    await userEvent.click(view.getByText("Bind a field"));
    await userEvent.click(view.getByText("CLIPTextEncode"));
    clickBind(
      within(view.getByText("text").closest("div") as HTMLElement).getByText(
        "Bind",
      ),
    );

    const sheet = within(view.getByRole("dialog"));
    expect(sheet.getByText(".text")).toBeTruthy();
    expect(
      sheet.getByText(/CLIPTextEncode · Workflow value a cat/),
    ).toBeTruthy();
  });

  test("a broken binding offers Rebind", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
      },
      inputs: [
        {
          id: "text1",
          kind: "text" as const,
          group: "describe" as const,
          label: "Prompt",
          help: "",
          default: "",
          multiline: false,
          maxLength: 2000,
          bindings: [
            {
              nodeId: "99",
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
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");
    await userEvent.click(view.getByText("Prompt"));

    expect(view.getByText(/isn't in this Workflow/)).toBeTruthy();
    await userEvent.click(view.getByText("Rebind"));
    await userEvent.click(view.getByText("CLIPTextEncode"));
    clickBind(
      within(view.getByText("text").closest("div") as HTMLElement).getByText(
        "Bind",
      ),
    );

    expect(view.queryByText(/isn't in this Workflow/)).toBeNull();
  });

  test("durations are edited in seconds", async () => {
    const detail = { ...DETAIL, inputs: [] };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json(detail);
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");
    await userEvent.click(view.getByText("New Input"));
    await userEvent.click(view.getByText("Video Upload"));

    const maxDuration = view.getByLabelText("Max duration (s)");
    await userEvent.clear(maxDuration);
    await userEvent.type(maxDuration, "2.5");

    await userEvent.click(view.getByRole("button", { name: "Close" }));
    await userEvent.click(view.getByText("Save"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/draft"),
    );
    const [input] = saved?.body?.inputs as [{ maxDurationMs: number }];
    expect(input.maxDurationMs).toBe(2500);
  });

  test("a select option holds one value per bound field", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": {
          class_type: "EmptyLatentImage",
          inputs: { width: 512, height: 512 },
        },
      },
      inputs: [
        {
          id: "select1",
          kind: "select" as const,
          group: "settings" as const,
          label: "Size",
          help: "",
          default: null,
          options: [
            { id: "optA", label: "Small", values: [512] },
            { id: "optB", label: "Large", values: [1024] },
          ],
          bindings: [
            {
              nodeId: "1",
              field: "width",
              classType: "EmptyLatentImage",
              title: null,
            },
          ],
        },
      ],
    };
    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      if (call.method === "PUT" && call.url.endsWith("/draft")) {
        return Response.json(detail);
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");
    await userEvent.click(view.getByText("Size"));

    const valueInputs = view.getAllByDisplayValue("512");
    await userEvent.clear(valueInputs[0] as HTMLElement);
    await userEvent.type(valueInputs[0] as HTMLElement, "640");

    await userEvent.click(view.getByRole("button", { name: "Close" }));
    await userEvent.click(view.getByText("Save"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/draft"),
    );
    const [input] = saved?.body?.inputs as [
      { options: { values: number[] }[] },
    ];
    expect(input.options[0]?.values).toEqual([640]);
    expect(input.options[1]?.values).toEqual([1024]);
  });

  test("changing type is locked while bound", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
      },
      inputs: [
        {
          id: "text1",
          kind: "text" as const,
          group: "describe" as const,
          label: "Prompt",
          help: "",
          default: "",
          multiline: false,
          maxLength: 2000,
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
        return Response.json(detail);
      }
      if (call.method === "GET") return respondGet(call.url);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");

    await view.findByText("LTX 2.5");
    await openSection(view, "Inputs");
    await userEvent.click(view.getByText("Prompt"));

    expect((view.getByLabelText("Type") as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(
      view.getByText("Remove its bindings to change the type."),
    ).toBeTruthy();
  });
});
