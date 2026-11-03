// Issue #199: when `/generations/<id>` opens over the Workbench (a
// background-location modal route, wired in `main.tsx`), the Workbench's
// own route tree is re-rendered against the *background* location, which
// carries no `:id` param of its own. This context hands the real open id
// down into that tree instead.

import { createContext, useContext } from "react";

const RoutedGenerationIdContext = createContext<string | null>(null);

export const RoutedGenerationIdProvider = RoutedGenerationIdContext.Provider;

/** The Generation id open at `/generations/<id>` over this page, or null when none is (issue #199). */
export function useRoutedGenerationId(): string | null {
  return useContext(RoutedGenerationIdContext);
}
