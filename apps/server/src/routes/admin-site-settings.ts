import {
  isAllowedImageContentType,
  maxBytesFor,
  parseBlockedWordsList,
  siteBlockedWordsFieldsSchema,
  siteCapsFieldsSchema,
  siteNoticeFieldsSchema,
  sitePrivacyFieldsSchema,
  siteSettingsFieldsSchema,
  siteTermsFieldsSchema,
  validateBlockedWordsList,
} from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { validate, type ValidateReason } from "../auth/validate.js";
import type { NoticeEvents } from "../branding/notice-events.js";
import {
  type SiteSettingsUpdateImage,
  getSiteSettings,
  pauseGenerating,
  resumeGenerating,
  updateSiteBlockedWords,
  updateSiteCaps,
  updateSiteNotice,
  updateSitePrivacy,
  updateSiteSettings,
  updateSiteTerms,
} from "../branding/site-settings-store.js";
import type { Database } from "../db/client.js";
import type { Storage } from "../storage/storage.js";

const versionSchema = z.coerce.number().int().min(1);

/**
 * The five JSON sub-routes' wire body is `revision` plus the shared field
 * schema (issue #169). Each extension schema validates exactly what its
 * route reads, so the typed `hc` client (see
 * `app-type.admin-site.test.ts`) matches the real body; the shared field
 * schema stays the single source of field validation.
 */
const siteTermsSchema = z.object({
  revision: versionSchema,
  ...siteTermsFieldsSchema.shape,
});

const sitePrivacySchema = z.object({
  revision: versionSchema,
  ...sitePrivacyFieldsSchema.shape,
});

const siteBlockedWordsSchema = z.object({
  revision: versionSchema,
  ...siteBlockedWordsFieldsSchema.shape,
});

const siteNoticeSchema = z.object({
  revision: versionSchema,
  ...siteNoticeFieldsSchema.shape,
});

const siteCapsSchema = z.object({
  revision: versionSchema,
  ...siteCapsFieldsSchema.shape,
});

/** `footerLinks` travels as a JSON string inside the branding form's `multipart/form-data` body. */
function parseFooterLinks(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return [];
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readImageField(
  value: unknown,
  which: "logo" | "background",
): Promise<SiteSettingsUpdateImage | undefined> {
  if (value === undefined || value === null || value === "") return undefined;
  if (!(value instanceof File)) {
    throw new Error(`${which} must be an uploaded file`);
  }
  if (!isAllowedImageContentType(value.type)) {
    throw new Error(`${which} must be a PNG, JPEG or WebP image`);
  }
  if (value.size > maxBytesFor(which)) {
    throw new Error(`${which} is too large`);
  }
  return {
    bytes: new Uint8Array(await value.arrayBuffer()),
    contentType: value.type,
  };
}

/**
 * The shared `onInvalid` of the five JSON sub-routes (issue #169): it
 * re-runs the exact revision-then-fields parse order the routes used
 * before the conversion, so every 400 body stays byte-for-byte what it
 * answers today.
 */
async function onInvalidSiteFields(
  c: Context<AppEnv>,
  reason: ValidateReason,
  fieldsSchema: z.ZodType,
  project: (body: Record<string, unknown> | null) => unknown,
  error: string,
): Promise<Response> {
  // Hono's validator throws for an unparseable body before the schema
  // runs, so this reason never has a body to re-read.
  if (reason === "malformed") {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  // The gate only calls back with "invalid" for a body that parsed, and
  // Hono caches the parse, so re-reading is safe.
  const body = (await c.req.json()) as Record<string, unknown> | null;

  const revisionResult = versionSchema.safeParse(body?.revision);
  if (!revisionResult.success) {
    return c.json({ error: "revision is required" }, 400);
  }

  const fieldsResult = fieldsSchema.safeParse(project(body));
  if (!fieldsResult.success) {
    return c.json({ error, issues: fieldsResult.error.issues }, 400);
  }

  // The gate only rejects a body one of the two parses above rejects.
  return c.json({ error, issues: [] }, 400);
}

/** `/api/admin/site-settings`: the Site settings branding form (Admin only). */
export function adminSiteSettingsRoute(
  db: Database,
  clock: Clock,
  storage: Storage,
  noticeEvents: NoticeEvents,
  /** Wakes the dispatcher (issue #59): a Resume may make queued Generations dispatchable right away. */
  wakeDispatcher: () => void,
  routes: RouteEntry[],
) {
  const basePath = "/api/admin/site-settings";

  return new Hono<AppEnv>()
    .get(
      "/",
      guard(routes, basePath, "get", "/", "admin"),
      async (c) => {
        const settings = await getSiteSettings(db);
        return c.json(settings);
      },
    )
    .put(
      "/",
      guard(routes, basePath, "put", "/", "admin"),
      async (c) => {
        let body: Record<string, unknown>;
        try {
          body = await c.req.parseBody();
        } catch {
          return c.json({ error: "invalid form data" }, 400);
        }

        const versionResult = versionSchema.safeParse(body.version);
        if (!versionResult.success) {
          return c.json({ error: "version is required" }, 400);
        }

        const fieldsResult = siteSettingsFieldsSchema.safeParse({
          title: body.title,
          landingText: body.landingText,
          accent: body.accent,
          signUpMode: body.signUpMode,
          contact: body.contact,
          footerLinks: parseFooterLinks(body.footerLinks),
        });
        if (!fieldsResult.success) {
          return c.json(
            { error: "invalid site settings", issues: fieldsResult.error.issues },
            400,
          );
        }

        let logo: SiteSettingsUpdateImage | undefined;
        let background: SiteSettingsUpdateImage | undefined;
        try {
          logo = await readImageField(body.logo, "logo");
          background = await readImageField(body.background, "background");
        } catch (error) {
          return c.json(
            { error: error instanceof Error ? error.message : "invalid image" },
            400,
          );
        }

        const result = await updateSiteSettings(
          db,
          clock,
          storage,
          adminActorFrom(c),
          {
            version: versionResult.data,
            title: fieldsResult.data.title,
            landingText: fieldsResult.data.landingText,
            accent: fieldsResult.data.accent,
            signUpMode: fieldsResult.data.signUpMode,
            contact: fieldsResult.data.contact,
            footerLinks: fieldsResult.data.footerLinks,
            logo,
            background,
          },
        );

        if (!result.ok) {
          return c.json({ error: "changed by someone else, reload" }, 409);
        }

        return c.json(result.settings);
      },
    )
    .put(
      "/terms",
      guard(routes, basePath, "put", "/terms", "admin"),
      validate(
        "json",
        siteTermsSchema,
        (c, reason) =>
          onInvalidSiteFields(
            c,
            reason,
            siteTermsFieldsSchema,
            (body) => ({ body: body?.body, askAgain: body?.askAgain }),
            "invalid site terms",
          ),
      ),
      async (c) => {
        const { revision, body, askAgain } = c.req.valid("json");

        const result = await updateSiteTerms(db, clock, adminActorFrom(c), {
          revision,
          body,
          askAgain,
        });

        if (!result.ok) {
          return c.json({ error: "changed by someone else, reload" }, 409);
        }

        return c.json(result.settings);
      },
    )
    .put(
      "/privacy",
      guard(routes, basePath, "put", "/privacy", "admin"),
      validate(
        "json",
        sitePrivacySchema,
        (c, reason) =>
          onInvalidSiteFields(
            c,
            reason,
            sitePrivacyFieldsSchema,
            (body) => ({ body: body?.body }),
            "invalid privacy policy",
          ),
      ),
      async (c) => {
        const { revision, body } = c.req.valid("json");

        const result = await updateSitePrivacy(db, clock, adminActorFrom(c), {
          revision,
          body,
        });

        if (!result.ok) {
          return c.json({ error: "changed by someone else, reload" }, 409);
        }

        return c.json(result.settings);
      },
    )
    .put(
      "/blocked-words",
      guard(routes, basePath, "put", "/blocked-words", "admin"),
      validate(
        "json",
        siteBlockedWordsSchema,
        (c, reason) =>
          onInvalidSiteFields(
            c,
            reason,
            siteBlockedWordsFieldsSchema,
            (body) => ({ text: body?.text }),
            "invalid blocked words",
          ),
      ),
      async (c) => {
        const { revision, text } = c.req.valid("json");

        const words = parseBlockedWordsList(text);
        const listError = validateBlockedWordsList(words);
        if (listError) {
          return c.json(
            {
              error: "invalid blocked words",
              issues: [{ path: ["text"], code: "custom", message: listError }],
            },
            400,
          );
        }

        const result = await updateSiteBlockedWords(
          db,
          clock,
          adminActorFrom(c),
          { revision, words },
        );

        if (!result.ok) {
          return c.json({ error: "changed by someone else, reload" }, 409);
        }

        return c.json(result.settings);
      },
    )
    .put(
      "/notice",
      guard(routes, basePath, "put", "/notice", "admin"),
      validate(
        "json",
        siteNoticeSchema,
        (c, reason) =>
          onInvalidSiteFields(
            c,
            reason,
            siteNoticeFieldsSchema,
            (body) => ({ text: body?.text }),
            "invalid notice",
          ),
      ),
      async (c) => {
        const { revision, text } = c.req.valid("json");

        const result = await updateSiteNotice(db, clock, adminActorFrom(c), {
          revision,
          text,
        });

        if (!result.ok) {
          return c.json({ error: "changed by someone else, reload" }, 409);
        }

        noticeEvents.publish({
          paused: result.settings.paused,
          notice: result.settings.notice,
        });
        return c.json(result.settings);
      },
    )
    .put(
      "/caps",
      guard(routes, basePath, "put", "/caps", "admin"),
      validate(
        "json",
        siteCapsSchema,
        (c, reason) =>
          onInvalidSiteFields(
            c,
            reason,
            siteCapsFieldsSchema,
            (body) => ({
              dailyCap: body?.dailyCap,
              concurrentCap: body?.concurrentCap,
            }),
            "invalid caps",
          ),
      ),
      async (c) => {
        const { revision, dailyCap, concurrentCap } = c.req.valid("json");

        const result = await updateSiteCaps(db, clock, adminActorFrom(c), {
          revision,
          dailyCap,
          concurrentCap,
        });

        if (!result.ok) {
          return c.json({ error: "changed by someone else, reload" }, 409);
        }

        return c.json(result.settings);
      },
    )
    .post(
      "/pause",
      guard(routes, basePath, "post", "/pause", "admin"),
      async (c) => {
        const session = c.get("session");
        if (!session) return c.json({ error: "unauthorized" }, 401);

        const result = await pauseGenerating(
          db,
          clock,
          adminActorFrom(c),
          session.user.name,
        );
        if (!result.ok) {
          return c.json({ error: "already paused" }, 409);
        }

        noticeEvents.publish({
          paused: result.settings.paused,
          notice: result.settings.notice,
        });
        return c.json(result.settings);
      },
    )
    .post(
      "/resume",
      guard(routes, basePath, "post", "/resume", "admin"),
      async (c) => {
        const result = await resumeGenerating(db, clock, adminActorFrom(c));
        if (!result.ok) {
          return c.json({ error: "not paused" }, 409);
        }

        noticeEvents.publish({
          paused: result.settings.paused,
          notice: result.settings.notice,
        });
        wakeDispatcher();
        return c.json(result.settings);
      },
    );
}
