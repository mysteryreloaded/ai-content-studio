import { zValidator } from "@hono/zod-validator";
import type { Context, MiddlewareHandler, ValidationTargets } from "hono";
import type { z } from "zod";
import type { AppEnv } from "./app-env.js";

/**
 * The `Input` a validated value lands in: both the raw (`in`) and the
 * parsed (`out`) side carry the schema's types under the validated
 * target, so `c.req.valid(target)` type-checks in the following
 * handlers and `hc` gets the route's request-body type.
 */
type Validated<
  Target extends keyof ValidationTargets,
  Schema extends z.ZodSchema,
> = {
  in: { [K in Target]: z.input<Schema> };
  out: { [K in Target]: z.output<Schema> };
};

/**
 * A thin wrapper over @hono/zod-validator's `zValidator` for the chained
 * route style (issue #164). It takes the validation target, a schema, and
 * the route's own error response, so a converted route answers
 * byte-for-byte what it answers today on a bad body instead of zod's
 * default `c.json(result, 400)` (e.g. account.ts's `email_mismatch`). On
 * success the middleware keeps the chain going; the parsed value is
 * available from `c.req.valid(target)`.
 *
 * The cast keeps the `Validated` input type (a plain
 * `MiddlewareHandler<AppEnv>` would set `Input = {}`, hiding the schema
 * from `c.req.valid` and `hc`) while erasing zod-validator's inferred
 * response type, which reduces to `never` for a hook that may return
 * `void` (the success branch). The runtime behavior is exactly the
 * `zValidator` hook's.
 */
export function validate<
  Target extends keyof ValidationTargets,
  Schema extends z.ZodSchema,
>(
  target: Target,
  schema: Schema,
  onInvalid: (c: Context<AppEnv>) => Response | Promise<Response>,
): MiddlewareHandler<AppEnv, string, Validated<Target, Schema>> {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return;
    return onInvalid(c);
  }) as MiddlewareHandler<AppEnv, string, Validated<Target, Schema>>;
}
