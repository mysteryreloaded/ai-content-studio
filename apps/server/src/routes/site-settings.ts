import { Hono } from "hono";
import type { Database } from "../db/client.js";
import { siteSettings } from "../db/schema.js";

/** `/api/site-settings`: the public branding the landing page reads. */
export function siteSettingsRoute(db: Database): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const [row] = await db
      .select({ title: siteSettings.title })
      .from(siteSettings)
      .limit(1);
    return c.json({ title: row?.title ?? "AI Content Studio" });
  });

  return app;
}
