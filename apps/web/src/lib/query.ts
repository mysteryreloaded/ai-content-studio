import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api.js";

/**
 * The one app-level `QueryClient` (spec #33), mounted in `main.tsx`.
 * No retry on 4xx: a client error won't heal on its own — the component
 * handles it; 5xx and network errors still use TanStack's default retry.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (_failureCount, error) =>
        !(
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ),
    },
  },
});
