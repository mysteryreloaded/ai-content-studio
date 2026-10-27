import { zValidator } from "@hono/zod-validator";
import type { Context, MiddlewareHandler, ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
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
 * Why a rejected body reaches the route's error response: `"malformed"`
 * is a body that could not even be parsed (hono's validator throws
 * `HTTPException(400)` for it before the schema runs), `"invalid"` is
 * one that parsed but failed the schema.
 */
export type ValidateReason = "malformed" | "invalid";

/**
 * A thin wrapper over @hono/zod-validator's `zValidator` for the chained
 * route style (issue #164). It takes the validation target, a schema, and
 * the route's own error response, so a converted route answers
 * byte-for-byte what it answers today on a bad body instead of zod's
 * default `c.json(result, 400)` (e.g. account.ts's `email_mismatch`).
 * `onInvalid` receives a `ValidateReason`: `"malformed"` when the body
 * could not even be parsed (hono's validator throws `HTTPException(400)`
 * — "Malformed JSON in request body" — *before* the schema runs, so
 * without the catch below the app's `onError` (app.ts) would answer a
 * 500 "internal error") and `"invalid"` when the parsed body failed the
 * schema; a route that answers differently for each (e.g.
 * admin-site-settings.ts's "invalid JSON body") stays byte-for-byte on
 * both. On success the middleware keeps the chain going; the parsed
 * value is available from `c.req.valid(target)`.
 *
 * The cast keeps the `Validated` input type (a plain
 * `MiddlewareHandler<AppEnv>` would set `Input = {}`, hiding the schema
 * from `c.req.valid` and `hc`) while erasing zod-validator's inferred
 * response type, which reduces to `never` for a hook that may return
 * `void` (the success branch). The runtime behavior is exactly the
 * `zValidator` hook's, plus the malformed-body catch.
 */
export function validate<
  Target extends keyof ValidationTargets,
  Schema extends z.ZodSchema,
>(
  target: Target,
  schema: Schema,
  onInvalid: (
    c: Context<AppEnv>,
    reason: ValidateReason,
  ) => Response | Promise<Response>,
): MiddlewareHandler<AppEnv, string, Validated<Target, Schema>> {
  const hook = zValidator(target, schema, (result, c) => {
    if (result.success) return;
    return onInvalid(c, "invalid");
  }) as MiddlewareHandler<AppEnv, string, Validated<Target, Schema>>;

  // The annotated variable (not a cast on the arrow) carries the
  // `Validated` input type, so `c` is typed and `c.req.valid(target)`
  // type-checks below.
  const middleware: MiddlewareHandler<
    AppEnv,
    string,
    Validated<Target, Schema>
  > = async (c, next) => {
    try {
      return await hook(c, next);
    } catch (err) {
      // A body that fails to parse never reaches the hook: hono's
      // validator throws HTTPException(400) for it before the schema
      // runs, and it would then fall through to the app's onError
      // (500 "internal error"). `c.req.valid(target)` is still unset in
      // that case — the validator registers it only after a successful
      // parse+validation — which tells this apart from a 400 thrown
      // further down the chain (where it stays an unhandled error).
      if (
        c.req.valid(target) === undefined &&
        err instanceof HTTPException &&
        err.status === 400
      ) {
        return onInvalid(c, "malformed");
      }
      throw err;
    }
  };
  return middleware;
}
