import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { NoticeBanner } = await import("./NoticeBanner.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data) });
    }
  }
}

beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

async function streamFor() {
  await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
  return FakeEventSource.instances[0] as FakeEventSource;
}

describe("NoticeBanner", () => {
  test("shows nothing when there's no Notice and no Pause", async () => {
    const view = render(<NoticeBanner />);
    const source = await streamFor();
    source.emit("notice", { paused: false, notice: "" });

    await waitFor(() => expect(view.container.textContent).toBe(""));
  });

  test("shows the Admin's own Notice text, dismissably", async () => {
    const view = render(<NoticeBanner />);
    const source = await streamFor();
    source.emit("notice", { paused: false, notice: "Upgrading tonight." });

    await view.findByText("Upgrading tonight.");
    expect(view.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  test("shows the standard message during a Pause when the Notice is blank, with no Dismiss button", async () => {
    const view = render(<NoticeBanner />);
    const source = await streamFor();
    source.emit("notice", { paused: true, notice: "" });

    await view.findByText("Generating is paused for maintenance.", {
      exact: false,
    });
    expect(view.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  test("shows the Admin's own text during a Pause too, when set", async () => {
    const view = render(<NoticeBanner />);
    const source = await streamFor();
    source.emit("notice", { paused: true, notice: "Back by 3pm." });

    await view.findByText("Back by 3pm.");
  });

  test("dismissing hides it until the text changes", async () => {
    const view = render(<NoticeBanner />);
    const source = await streamFor();
    source.emit("notice", { paused: false, notice: "Upgrading tonight." });

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(await view.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(view.container.textContent).toBe(""));

    source.emit("notice", { paused: false, notice: "Upgrading tonight." });
    await waitFor(() => expect(view.container.textContent).toBe(""));

    source.emit("notice", { paused: false, notice: "New text now." });
    await view.findByText("New text now.");
  });
});
