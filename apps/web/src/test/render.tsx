import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { render, type RenderResult } from "@testing-library/react";

export interface RenderWithProvidersOptions {
  /** The memory router's initial entry. Defaults to "/". */
  route?: string;
  /**
   * The route's path pattern (e.g. "/models/:slug") when `route` carries
   * path params. Defaults to `route` itself, so a literal entry matches
   * itself exactly.
   */
  pattern?: string;
}

/**
 * Test render helper (issue #172): a fresh `QueryClient` (retry off, so a
 * failed fetch can't retry against a later mock) and a fresh memory
 * router, per test — the cache is isolated between tests. Returns the
 * render result plus the `queryClient`, so a test can inspect or update
 * the cache (e.g. after an SSE event).
 */
export function renderWithProviders(
  ui: ReactNode,
  options: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const router = createMemoryRouter(
    [
      {
        path: options.pattern ?? options.route ?? "*",
        element: ui,
      },
    ],
    { initialEntries: [options.route ?? "/"] },
  );

  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}
