import { test } from "bun:test";
import { hc } from "hono/client";
import type { AppType } from "./app.js";

// Type-only test (issue #164): `hc` performs its network fetch the moment a
// method is called, so nothing below is ever *invoked* at runtime. Only the
// type-level assertions are checked, by `bun run typecheck`.
const client = hc<AppType>("http://x");

type Expect<T extends true> = T;
type IsCallable<T> = T extends (..._args: never[]) => unknown ? true : false;

// The four route shapes the acceptance criteria require.
type SiteSettingsGet = Expect<
  IsCallable<(typeof client.api)["site-settings"]["$get"]>
>;
type TermsGet = Expect<IsCallable<typeof client.api.terms.$get>>;
type TermsAcceptPost = Expect<IsCallable<typeof client.api.terms.accept.$post>>;
type HealthzGet = Expect<IsCallable<typeof client.healthz.$get>>;

test("hc<AppType> exposes exactly the chained routes", () => {
  // Runtime side is intentionally empty: every assertion above is a type.
});
