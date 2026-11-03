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

const { cleanup, fireEvent } = await import("@testing-library/react");
const { useState } = await import("react");
const { useQueryClient } = await import("@tanstack/react-query");
const { drainMacrotasks, renderWithProviders } = await import(
  "../test/render.js"
);
const { useEventStream } = await import("./sse.js");

// `sse.ts` keeps its stream table at module level, so each test uses its
// own URL and can neither see another test's stream nor leave one behind.
let delivered: Array<{ client: unknown; data: unknown }> = [];

// The surface of the real EventSource that `useEventStream` touches
// (addEventListener, onerror, close), with a record of every open.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  close() {
    this.closed = true;
  }
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
  delivered = [];
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

function StreamProbe({ url }: { url: string }) {
  const queryClient = useQueryClient();
  useEventStream(url, {
    tick: (client, data) => {
      delivered.push({ client, data });
      client.setQueryData(["probe"], data);
    },
  });
  return null;
}

function SharedHarness({ url }: { url: string }) {
  const [second, setSecond] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setSecond(true)}>
        add caller
      </button>
      <button type="button" onClick={() => setSecond(false)}>
        remove caller
      </button>
      <StreamProbe url={url} />
      {second && <StreamProbe url={url} />}
    </>
  );
}

function GatedProbe({ url, enabled }: { url: string; enabled: boolean }) {
  const queryClient = useQueryClient();
  useEventStream(
    url,
    {
      tick: (client, data) => {
        delivered.push({ client, data });
      },
    },
    { enabled },
  );
  return null;
}

function GateHarness({ url }: { url: string }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setEnabled(true)}>
        enable
      </button>
      <button type="button" onClick={() => setEnabled(false)}>
        disable
      </button>
      <GatedProbe url={url} enabled={enabled} />
    </>
  );
}

// The status peek runs as an async IIFE of microtasks (fetch +
// body.cancel), so one macrotask turn lets it finish before the assertion.
async function settlePeek() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function mockPeekStatus(status: number) {
  globalThis.fetch = (async () => {
    return Response.json({}, { status });
  }) as unknown as typeof fetch;
}

describe("useEventStream", () => {
  test("delivers parsed events to the handler with the component's own QueryClient", () => {
    const view = renderWithProviders(<StreamProbe url="/sse/cache" />);
    const source = FakeEventSource.instances[0] as FakeEventSource;
    expect(source.url).toBe("/sse/cache");

    source.emit("tick", { v: 1 });

    expect(view.queryClient.getQueryData(["probe"])).toEqual({ v: 1 });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.client).toBe(view.queryClient);
    expect(delivered[0]?.data).toEqual({ v: 1 });
  });

  test("callers sharing a URL share one EventSource; only the last unmount closes it", () => {
    const view = renderWithProviders(<SharedHarness url="/sse/shared" />);
    const source = FakeEventSource.instances[0] as FakeEventSource;

    fireEvent.click(view.getByRole("button", { name: "add caller" }));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.closed).toBeFalse();

    fireEvent.click(view.getByRole("button", { name: "remove caller" }));
    expect(source.closed).toBeFalse();

    view.unmount();
    expect(source.closed).toBeTrue();

    // the closed entry was dropped from the table: a fresh mount opens
    // a new source
    const again = renderWithProviders(<SharedHarness url="/sse/shared" />);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(
      (FakeEventSource.instances[1] as FakeEventSource).closed,
    ).toBeFalse();
    again.unmount();
  });

  test("a 401 peek closes the stream, since its built-in reconnect would loop forever", async () => {
    mockPeekStatus(401);
    const view = renderWithProviders(<StreamProbe url="/sse/denied" />);
    const source = FakeEventSource.instances[0] as FakeEventSource;

    source.onerror?.();
    await settlePeek();

    expect(source.closed).toBeTrue();
    view.unmount();
  });

  test("a 403 peek closes the stream too", async () => {
    mockPeekStatus(403);
    const view = renderWithProviders(<StreamProbe url="/sse/forbidden" />);
    const source = FakeEventSource.instances[0] as FakeEventSource;

    source.onerror?.();
    await settlePeek();

    expect(source.closed).toBeTrue();
    view.unmount();
  });

  test("a non-401/403 peek leaves the built-in reconnection alone", async () => {
    mockPeekStatus(500);
    const view = renderWithProviders(<StreamProbe url="/sse/slow" />);
    const source = FakeEventSource.instances[0] as FakeEventSource;

    source.onerror?.();
    await settlePeek();

    expect(source.closed).toBeFalse();
    view.unmount();
  });

  test("a failed peek (offline) leaves the built-in reconnection alone", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const view = renderWithProviders(<StreamProbe url="/sse/offline" />);
    const source = FakeEventSource.instances[0] as FakeEventSource;

    source.onerror?.();
    await settlePeek();

    expect(source.closed).toBeFalse();
    view.unmount();
  });

  test("enabled: false opens no EventSource at all; enabling opens one, disabling closes it (issue #188)", () => {
    const view = renderWithProviders(<GateHarness url="/sse/gated" />);
    expect(FakeEventSource.instances).toHaveLength(0);

    fireEvent.click(view.getByRole("button", { name: "enable" }));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect((FakeEventSource.instances[0] as FakeEventSource).url).toBe(
      "/sse/gated",
    );

    fireEvent.click(view.getByRole("button", { name: "disable" }));
    expect((FakeEventSource.instances[0] as FakeEventSource).closed).toBeTrue();
    view.unmount();
  });
});
