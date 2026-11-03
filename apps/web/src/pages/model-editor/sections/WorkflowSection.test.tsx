import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { renderWithProviders } from "../../../test/render.js";
import {
  DETAIL,
  NO_BACKENDS,
  cleanup,
  finishFile,
  mockFetch,
  openSection,
  pickOutputNodeInWorkflow,
  prepareConfirmAndEventSource,
  renderEditor,
  respondGet,
  restoreConfirm,
  within,
} from "../testing/harness.js";
import { BindingPicker } from "../workflow/BindingPicker.js";

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

describe("WorkflowSection (issue #214)", () => {
  test("groups and filters nodes", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "LoadImage", inputs: {} },
        "2": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
        "3": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
        "4": { class_type: "CheckpointLoaderSimple", inputs: {} },
        "5": { class_type: "KSampler", inputs: {} },
      },
      nodes: [
        { id: "1", classType: "LoadImage", title: null },
        { id: "2", classType: "CLIPTextEncode", title: null },
        { id: "3", classType: "SaveImage", title: null },
        { id: "4", classType: "CheckpointLoaderSimple", title: null },
        { id: "5", classType: "KSampler", title: null },
      ],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    await openSection(view, "Workflow");

    expect(await view.findByText("Upload loaders · 1")).toBeTruthy();
    expect(view.getByText("Prompts and conditioning · 1")).toBeTruthy();
    expect(view.getByText("Outputs · 1")).toBeTruthy();
    expect(view.getByText("Models and LoRAs · 1")).toBeTruthy();
    expect(view.getByText("Sampling and the rest · 1")).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.type(
      view.getByLabelText("Find a node by title, class or id"),
      "sampler",
    );

    expect(view.queryByText("Upload loaders · 1")).toBeNull();
    expect(view.getByText("Sampling and the rest · 1")).toBeTruthy();
  });

  test("picking a Mode dims off-Path nodes", async () => {
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
          id: "mode-b",
          sortOrder: 0,
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
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL_TWO_MODES);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    await userEvent.click(view.getByRole("button", { name: /^Mode B/ }));

    const rowFor = (nodeId: string) =>
      view.getByText(`#${nodeId}`).closest("button") as HTMLElement;

    // Off Mode B's Path (1, 2): dimmed. On its Path (3, 4): not dimmed.
    expect(rowFor("1").getAttribute("data-dim")).toBe("true");
    expect(rowFor("2").getAttribute("data-dim")).toBe("true");
    expect(rowFor("3").getAttribute("data-dim")).toBeNull();
    expect(rowFor("4").getAttribute("data-dim")).toBeNull();
  });

  test("Make it an Input creates a bound Input of the right kind", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": {
          class_type: "LoadImage",
          inputs: { image: "foo.png" },
          _meta: { title: "Load Image" },
        },
      },
      nodes: [{ id: "1", classType: "LoadImage", title: "Load Image" }],
      inputs: [],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    await userEvent.click(
      view.getByText("#1").closest("button") as HTMLElement,
    );
    await userEvent.click(view.getByText("Make it an Input"));
    await userEvent.click(view.getByText("New Input from this field"));

    await openSection(view, "Inputs");
    expect(await view.findByText("Kind: image_upload")).toBeTruthy();
    expect(view.getByDisplayValue("Image")).toBeTruthy();
  });

  test("a linked field is refused with the hint", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "LoadImage", inputs: {} },
        "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
      },
      nodes: [
        { id: "1", classType: "LoadImage", title: null },
        { id: "2", classType: "SaveImage", title: null },
      ],
      inputs: [],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    await userEvent.click(
      view.getByText("#2").closest("button") as HTMLElement,
    );

    expect(
      await view.findByText("Fed by a link. Bind the source node."),
    ).toBeTruthy();
  });

  test("a preview node refuses to be a Mode's output", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "LoadImage", inputs: {} },
        "2": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
      },
      nodes: [
        { id: "1", classType: "LoadImage", title: null },
        { id: "2", classType: "PreviewImage", title: null },
      ],
      inputs: [],
    };
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(detail);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    await userEvent.click(
      view.getByText("#2").closest("button") as HTMLElement,
    );

    expect(
      await view.findByText(
        "A preview node saves no file, so it can't be a Mode's output.",
      ),
    ).toBeTruthy();
  });

  test("a UI save is refused in the browser", async () => {
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    const file = new File(
      [JSON.stringify({ nodes: [], links: [] })],
      "ui-save.json",
      { type: "application/json" },
    );
    await userEvent.upload(await view.findByLabelText("Choose file…"), file);

    expect(
      await view.findByText("This is a UI save; export it with Export (API)"),
    ).toBeTruthy();
  });

  test("a Workflow holding a key is refused with the agreed message", async () => {
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    const file = new File(
      [
        JSON.stringify({
          "1": {
            class_type: "GemmaAPITextEncode",
            inputs: { api_key: "secret" },
            _meta: { title: "Gemma API Text Encode" },
          },
        }),
      ],
      "keyed.json",
      { type: "application/json" },
    );
    await userEvent.upload(await view.findByLabelText("Choose file…"), file);

    expect(
      await view.findByText(
        "Gemma API Text Encode holds an API key; clear it in ComfyUI and export again",
      ),
    ).toBeTruthy();
  });

  test("Use as an output of <Mode> toggles the Mode's output nodes", async () => {
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

    await view.findByText("LTX 2.5");
    await userEvent.click(view.getByText("Add Mode"));
    await userEvent.type(view.getByLabelText("Mode name"), "Default");

    await pickOutputNodeInWorkflow(view, "Default", "2");
    const checkbox = view.getByLabelText(
      /^Use as an output of Default/,
    ) as HTMLInputElement;
    expect(checkbox.getAttribute("data-state")).toBe("checked");

    // Toggling it off removes the node from the Mode's own outputs.
    await userEvent.click(checkbox);

    await openSection(view, "Modes");
    await userEvent.click(view.getByText("Save"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/modes"),
    );
    const body = saved?.body as { modes: { outputNodeIds: string[] }[] } | null;
    expect(body?.modes[0]?.outputNodeIds).toEqual([]);
  });

  test("BindingPicker disables taken and incompatible fields", async () => {
    const workflow = {
      "1": {
        class_type: "KSampler",
        inputs: { prompt: "hello", notes: "taken", steps: 20 },
      },
    };
    const me = {
      id: "me",
      kind: "text" as const,
      group: "describe" as const,
      label: "My Text",
      help: "",
      default: "",
      multiline: false,
      maxLength: 2000,
      bindings: [],
    };
    const other = {
      ...me,
      id: "other1",
      label: "Notes Input",
      bindings: [
        { nodeId: "1", field: "notes", classType: "KSampler", title: null },
      ],
    };

    const view = renderWithProviders(
      <BindingPicker
        open
        onOpenChange={() => {}}
        input={me}
        workflow={workflow}
        otherInputs={[other]}
        onBind={() => {}}
      />,
    );
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(view.getByText("KSampler"));

    const promptBind = within(
      view.getByText("prompt").closest("div") as HTMLElement,
    ).getByText("Bind");
    expect((promptBind as HTMLButtonElement).disabled).toBe(false);

    const notesBind = within(
      view.getByText("notes").closest("div") as HTMLElement,
    ).getByText("Bind");
    expect((notesBind as HTMLButtonElement).disabled).toBe(true);
    expect(notesBind.getAttribute("title")).toBe("A field takes one Input");
    expect(view.getByText(/bound by Notes Input/)).toBeTruthy();

    const stepsBind = within(
      view.getByText("steps").closest("div") as HTMLElement,
    ).getByText("Bind");
    expect((stepsBind as HTMLButtonElement).disabled).toBe(true);
    expect(stepsBind.getAttribute("title")).toBe(
      "Takes number; this Input can't write it",
    );
  });
});
