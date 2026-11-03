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

    // Issue #215: creating an Input from the inspector opens its sheet
    // directly (`nav.openInput`), so there's no need to switch sections.
    expect(await view.findByDisplayValue("Image")).toBeTruthy();
    expect((view.getByLabelText("Type") as HTMLSelectElement).value).toBe(
      "image_upload",
    );
  });

  test("a boolean field becomes a 2-option Select seeded Off/On, false/true", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "KSampler", inputs: { add_noise: true } },
      },
      nodes: [{ id: "1", classType: "KSampler", title: null }],
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

    // Issue #215: creating an Input from the inspector opens its sheet
    // directly (`nav.openInput`), so there's no need to switch sections.
    expect(await view.findByDisplayValue("Off")).toBeTruthy();
    expect(view.getByDisplayValue("On")).toBeTruthy();
    const offGroup = view.getByRole("radiogroup", {
      name: "Off value for 1.add_noise",
    });
    const onGroup = view.getByRole("radiogroup", {
      name: "On value for 1.add_noise",
    });
    expect(
      within(offGroup).getByText("false").getAttribute("aria-checked"),
    ).toBe("true");
    expect(within(onGroup).getByText("true").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  test("Make it an Input is hidden for a null-valued field", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "KSampler", inputs: { seed_variation: null } },
      },
      nodes: [{ id: "1", classType: "KSampler", title: null }],
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

    expect(await view.findByText("seed_variation")).toBeTruthy();
    expect(view.queryByText("Make it an Input")).toBeNull();
    expect(view.getByText("Keeps the Workflow value")).toBeTruthy();
  });

  test("'Or add to an Input…' excludes Seed and Points, and keeps a Select's option values in sync", async () => {
    const textInput = {
      id: "text1",
      kind: "text" as const,
      group: "describe" as const,
      label: "Text A",
      help: "",
      default: "",
      multiline: false,
      maxLength: 2000,
      bindings: [],
    };
    const pointsInput = {
      id: "points1",
      kind: "points" as const,
      group: "describe" as const,
      label: "Points A",
      help: "",
      videoInputId: "",
      widthField: { nodeId: "", field: "" },
      heightField: { nodeId: "", field: "" },
      bindings: [],
    };
    const selectInput = {
      id: "select1",
      kind: "select" as const,
      group: "settings" as const,
      label: "Switch",
      help: "",
      default: null,
      options: [
        { id: "optA", label: "A", values: ["x"] },
        { id: "optB", label: "B", values: ["y"] },
      ],
      bindings: [
        { nodeId: "1", field: "mode", classType: "KSampler", title: null },
      ],
    };
    const detail = {
      ...DETAIL,
      workflow: {
        "1": {
          class_type: "KSampler",
          inputs: { mode: "x", prompt: "hello", extra: "z" },
        },
      },
      nodes: [{ id: "1", classType: "KSampler", title: null }],
      inputs: [textInput, pointsInput, selectInput],
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

    // "prompt" (a string field) is compatible with both Text A and
    // Points A by type, but a Points Input's own bound field is picked
    // from its own settings (issue #214 CEO review), not here.
    await userEvent.click(
      within(view.getByText("prompt").closest("tr") as HTMLElement).getByText(
        "Make it an Input",
      ),
    );
    const promptSelect = within(
      view.getByText("prompt").closest("tr") as HTMLElement,
    ).getByLabelText("Or add to an Input…");
    expect(within(promptSelect).queryByText("Points A")).toBeNull();
    expect(within(promptSelect).getByText("Text A")).toBeTruthy();

    // Binding "prompt" onto the existing Select keeps every option's
    // `values` the same length as its `bindings` (toggleBinding, not
    // the old hand-rolled append).
    await userEvent.selectOptions(promptSelect, "select1");

    await openSection(view, "Inputs");
    await userEvent.click(view.getByText("Switch"));
    const fieldA = view.getByLabelText(
      "A value for 1.prompt",
    ) as HTMLInputElement;
    const fieldB = view.getByLabelText(
      "B value for 1.prompt",
    ) as HTMLInputElement;
    expect(fieldA.value).toBe("hello");
    expect(fieldB.value).toBe("hello");
  });

  test("the 'In <Mode>' column defaults an unset Input to Optional, not Hidden", async () => {
    const detail = {
      ...DETAIL,
      workflow: {
        "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      },
      nodes: [{ id: "1", classType: "LoadImage", title: null }],
      inputs: [
        {
          id: "img",
          kind: "image_upload" as const,
          group: "describe" as const,
          label: "Photo",
          help: "",
          maxSizeMb: 20,
          maxLongSide: null,
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
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Default",
          description: "",
          outputNodes: [],
          inputSettings: [],
        },
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
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    await userEvent.click(view.getByRole("button", { name: /^Default/ }));
    await userEvent.click(
      view.getByText("#1").closest("button") as HTMLElement,
    );

    expect(
      view
        .getByRole("radio", { name: "Optional" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("workflowErrorMessage surfaces the server's own validation errors", async () => {
    mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(DETAIL);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      if (call.method === "PUT" && call.url.endsWith("/workflow")) {
        return Response.json(
          {
            errors: [
              { field: "workflow", message: "links to missing nodes: 7" },
            ],
          },
          { status: 400 },
        );
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    const file = new File(
      [JSON.stringify({ "1": { class_type: "LoadImage", inputs: {} } })],
      "wf.json",
      { type: "application/json" },
    );
    await userEvent.upload(await view.findByLabelText("Choose file…"), file);
    await userEvent.click(view.getByText("Replace Workflow"));

    expect(
      await view.findByText("workflow: links to missing nodes: 7"),
    ).toBeTruthy();
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
    await userEvent.click(view.getByRole("button", { name: "+ Mode" }));
    const nameField = await view.findByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Default");
    await userEvent.click(view.getByRole("button", { name: "Close" }));

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

  test("the rebind picker repoints a broken output node, and Replace Workflow sends it", async () => {
    const MODE_DETAIL = {
      ...DETAIL,
      model: { ...DETAIL.model, currentRevision: 2, version: 1 },
      workflow: {
        "1": { class_type: "LoadImage", inputs: {} },
        "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
      },
      nodes: [
        { id: "1", classType: "LoadImage", title: null },
        { id: "2", classType: "SaveImage", title: null },
      ],
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

    const calls = mockFetch((call) => {
      if (call.method === "GET" && call.url.endsWith("/api/admin/models/m1")) {
        return Response.json(MODE_DETAIL);
      }
      if (call.method === "GET") return Response.json(NO_BACKENDS);
      if (call.method === "PUT" && call.url.endsWith("/workflow")) {
        return Response.json({
          record: { ...MODE_DETAIL.model, currentRevision: 3, version: 2 },
          modes: [],
          inputs: [],
          outsideServiceNotes: [],
        });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const view = renderEditor();
    const { default: userEvent } = await import("@testing-library/user-event");
    await openSection(view, "Workflow");

    // Node "2" keeps its id but turns into a VHS_VideoCombine; node "3"
    // is a genuine SaveImage the rebind picker can repoint the Mode's
    // output node onto instead (CEO review: the VHS_VideoCombine bug).
    const file = new File(
      [
        JSON.stringify({
          "1": { class_type: "LoadImage", inputs: {} },
          "2": { class_type: "VHS_VideoCombine", inputs: { images: ["1", 0] } },
          "3": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
        }),
      ],
      "wf2.json",
      { type: "application/json" },
    );
    await userEvent.upload(await view.findByLabelText("Choose file…"), file);

    expect(await view.findByText(/rebind it/)).toBeTruthy();

    await userEvent.selectOptions(view.getByLabelText('Rebind node "2"'), "3");
    await userEvent.click(view.getByText("Replace Workflow"));

    const saved = calls.find(
      (c) => c.method === "PUT" && c.url.endsWith("/workflow"),
    );
    const body = saved?.body as { rebind: unknown } | null;
    expect(body?.rebind).toEqual([{ nodeId: "2", newNodeId: "3" }]);
  });
});
