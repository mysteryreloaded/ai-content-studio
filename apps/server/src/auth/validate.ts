import { zValidator } from "@hono/zod-validator";
import type { Context, MiddlewareHandler, ValidationTargets } from "hono";
import type { z } from "zod";
import type { AppEnv } from "./app-env.js";

/**
 * A thin wrapper over @hono/zod-validator's `zValidator` for the chained
 * route style (issue #164). It takes the validation target, a schema, and
 * the route's own error response, so a converted route answers
 * byte-for-byte what it answers today on a bad body instead of zod's
 * default `c.json(result, 400)` (e.g. account.ts's `email_mismatch`). On
 * success the middleware keeps the chain going; the parsed value is
 * available from `c.req.valid(target)`.
 *
 * The cast erases zod-validator's inferred response type, which reduces
 * to `never` for a hook that may return `void` (the success branch); the
 * runtime behavior is exactly the `zValidator` hook's.
 */
export function validate<
  Target extends keyof ValidationTargets,
  Schema extends z.ZodSchema,
>(
  target: Target,
  schema: Schema,
  onInvalid: (c: Context<AppEnv>) => Response | Promise<Response>,
): MiddlewareHandler<AppEnv> {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return;
    return onInvalid(c);
  }) as MiddlewareHandler<AppEnv>;
}
