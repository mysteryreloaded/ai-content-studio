import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup } = await import("@testing-library/react");
const { useEffect, useState } = await import("react");
const { useQueryClient } = await import("@tanstack/react-query");
const { drainMacrotasks, renderWithProviders } = await import("./render.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

function CacheReader() {
  const queryClient = useQueryClient();
  const data = queryClient.getQueryData(["probe"]) as
    | {
        v: number;
      }
    | undefined;
  return <p>{data ? JSON.stringify(data) : "empty"}</p>;
}

function ProbeTree() {
  const queryClient = useQueryClient();
  const [showReader, setShowReader] = useState(false);
  useEffect(() => {
    // no explicit `act()`: the update is flushed by the act scope the
    // test's render runs under
    queryClient.setQueryData(["probe"], { v: 1 });
    setShowReader(true);
  }, []);
  return showReader ? <CacheReader /> : null;
}

describe("renderWithProviders", () => {
  test("a cache write is visible to another component in the same tree", async () => {
    const view = renderWithProviders(<ProbeTree />);
    await view.findByText('{"v":1}');
  });

  test("each call starts from an empty cache, even after a previous test wrote one", () => {
    const view = renderWithProviders(<CacheReader />);
    expect(view.getByText("empty")).toBeTruthy();
  });
});
