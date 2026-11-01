import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  type RouteObject,
  RouterProvider,
  createMemoryRouter,
} from "react-router-dom";

export interface RenderWithProvidersOptions {
  /** The memory router's initial entry (default `"/"`). */
  route?: string;
  /**
   * A custom route tree for the component under test (params, multiple
   * paths). When omitted, `ui` is rendered on a catch-all route.
   */
  routes?: RouteObject[];
}

/**
 * A test render with the app's two provider layers (spec #33): a fresh
 * per-call `QueryClient` with retry off — so a test can neither see
 * another test's cache nor leave one behind — and a per-test memory
 * router, so `useNavigate`/`useLocation`/`useSearchParams` work.
 *
 * The returned result also exposes the client, for tests that inspect
 * the cache directly.
 */
export function renderWithProviders(
  ui: ReactNode,
  { route = "/", routes }: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const router = createMemoryRouter(routes ?? [{ path: "*", element: ui }], {
    initialEntries: [route],
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

/**
 * Drain the pending macrotask turns of the test file's event loop.
 *
 * A test whose last `await` settles before React has committed its final
 * render — the case for the query-based hooks, whose cache transitions
 * schedule one more scheduler callback (Bun's scheduler uses
 * `setImmediate`) — leaves that callback in the queue. If it runs after
 * `GlobalRegistrator.unregister()` has closed the window, the scheduler
 * throws `ReferenceError: window is not defined`, which Bun reports as an
 * unhandled error between tests. Call this from `afterAll`, before
 * unregistering, in every test file that closes its own window.
 */
export async function drainMacrotasks(turns = 3): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
