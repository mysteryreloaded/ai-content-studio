import { afterAll, describe, expect, test } from "bun:test";
import { createTestDatabase } from "../test/database.js";
import { siteSettings } from "./schema.js";

describe("site_settings", () => {
  const testDb = createTestDatabase("site_settings_test");

  afterAll(async () => {
    await (await testDb).close();
  });

  test("the single row exists after migration with the default title", async () => {
    const { db } = await testDb;
    const rows = await db.select().from(siteSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("AI Content Studio");
  });
});
