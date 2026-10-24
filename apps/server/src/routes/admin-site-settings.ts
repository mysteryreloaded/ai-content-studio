import {
  isAllowedImageContentType,
  maxBytesFor,
  parseBlockedWordsList,
  siteBlockedWordsFieldsSchema,
  sitePrivacyFieldsSchema,
  siteSettingsFieldsSchema,
  siteTermsFieldsSchema,
  validateBlockedWordsList,
} from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  type SiteSettingsUpdateImage,
  getSiteSettings,
  updateSiteBlockedWords,
  updateSitePrivacy,
  updateSiteSettings,
  updateSiteTerms,
} from "../branding/site-settings-store.js";
import type { Database } from "../db/client.js";
import type { Storage } from "../storage/storage.js";

const versionSchema = z.coerce.number().int().min(1);

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

/** `/api/admin/site-settings`: the Site settings branding form (Admin only). */
export function adminSiteSettingsRoute(
  db: Database,
  clock: Clock,
  storage: Storage,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/admin/site-settings";

  guardedRoute(app, routes, basePath, "get", "/", "admin", async (c) => {
    const settings = await getSiteSettings(db);
    return c.json(settings);
  });

  guardedRoute(app, routes, basePath, "put", "/", "admin", async (c) => {
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
  });

  guardedRoute(app, routes, basePath, "put", "/terms", "admin", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const revisionResult = versionSchema.safeParse(
      (body as Record<string, unknown> | null)?.revision,
    );
    if (!revisionResult.success) {
      return c.json({ error: "revision is required" }, 400);
    }

    const fieldsResult = siteTermsFieldsSchema.safeParse({
      body: (body as Record<string, unknown> | null)?.body,
      askAgain: (body as Record<string, unknown> | null)?.askAgain,
    });
    if (!fieldsResult.success) {
      return c.json(
        { error: "invalid site terms", issues: fieldsResult.error.issues },
        400,
      );
    }

    const result = await updateSiteTerms(db, clock, adminActorFrom(c), {
      revision: revisionResult.data,
      body: fieldsResult.data.body,
      askAgain: fieldsResult.data.askAgain,
    });

    if (!result.ok) {
      return c.json({ error: "changed by someone else, reload" }, 409);
    }

    return c.json(result.settings);
  });

  guardedRoute(app, routes, basePath, "put", "/privacy", "admin", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const revisionResult = versionSchema.safeParse(
      (body as Record<string, unknown> | null)?.revision,
    );
    if (!revisionResult.success) {
      return c.json({ error: "revision is required" }, 400);
    }

    const fieldsResult = sitePrivacyFieldsSchema.safeParse({
      body: (body as Record<string, unknown> | null)?.body,
    });
    if (!fieldsResult.success) {
      return c.json(
        {
          error: "invalid privacy policy",
          issues: fieldsResult.error.issues,
        },
        400,
      );
    }

    const result = await updateSitePrivacy(db, clock, adminActorFrom(c), {
      revision: revisionResult.data,
      body: fieldsResult.data.body,
    });

    if (!result.ok) {
      return c.json({ error: "changed by someone else, reload" }, 409);
    }

    return c.json(result.settings);
  });

  guardedRoute(
    app,
    routes,
    basePath,
    "put",
    "/blocked-words",
    "admin",
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }

      const revisionResult = versionSchema.safeParse(
        (body as Record<string, unknown> | null)?.revision,
      );
      if (!revisionResult.success) {
        return c.json({ error: "revision is required" }, 400);
      }

      const fieldsResult = siteBlockedWordsFieldsSchema.safeParse({
        text: (body as Record<string, unknown> | null)?.text,
      });
      if (!fieldsResult.success) {
        return c.json(
          {
            error: "invalid blocked words",
            issues: fieldsResult.error.issues,
          },
          400,
        );
      }

      const words = parseBlockedWordsList(fieldsResult.data.text);
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
        { revision: revisionResult.data, words },
      );

      if (!result.ok) {
        return c.json({ error: "changed by someone else, reload" }, 409);
      }

      return c.json(result.settings);
    },
  );

  return app;
}
