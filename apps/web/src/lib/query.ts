import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api.js";

/**
 * The one `QueryClient` for the whole app (spec #33's "TanStack Query
 * fed by SSE"): every query and mutation runs against this instance, so
 * an SSE handler can update any page's cache through it.
 *
 * A 4xx is an expected answer (a 401 means "signed out"), so it doesn't
 * retry; 5xx and network errors do. No refetch on window focus either:
 * the pre-Query hooks fetched once and on demand, and the SSE streams
 * push changes to the cache as they happen.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (_failureCount, error) =>
        !(error instanceof ApiError) || error.status >= 500,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
