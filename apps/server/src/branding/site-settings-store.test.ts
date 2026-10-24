import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { auditEntries } from "../db/schema.js";
import { createLocalStorage } from "../storage/storage.js";
import { createTestDatabase } from "../test/database.js";
import {
  LOGO_STORAGE_KEY,
  getSiteSettings,
  updateSiteSettings,
  updateSiteTerms,
} from "./site-settings-store.js";

describe("Site settings store", () => {
  const testDb = createTestDatabase("site_settings_store_test");
  const rootPromise = mkdtemp(path.join(tmpdir(), "site-settings-store-"));
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
    await rm(await rootPromise, { recursive: true, force: true });
  });

  const admin = {
    type: "admin" as const,
    userId: "00000000-0000-0000-0000-00000000000a",
    email: "admin@example.com",
    ip: "203.0.113.1",
    userAgent: "test-agent",
    requestId: "req-abc",
  };

  test("saves fields, stores the logo, bumps the version and writes an Audit entry", async () => {
    const { db } = await testDb;
    const storage = createLocalStorage(await rootPromise);
    const current = await getSiteSettings(db);

    const logoBytes = new Uint8Array([1, 2, 3, 4]);
    const result = await updateSiteSettings(db, clock, storage, admin, {
      version: current.version,
      title: "My Studio",
      landingText: "Welcome!",
      accent: "violet",
      logo: { bytes: logoBytes, contentType: "image/png" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.settings.version).toBe(current.version + 1);
    expect(result.settings.title).toBe("My Studio");
    expect(result.settings.logo?.size).toBe(4);

    const stored = await storage.read(LOGO_STORAGE_KEY);
    expect(stored.equals(Buffer.from(logoBytes))).toBe(true);

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetType, "site_settings"));
    expect(entry?.actorType).toBe("admin");
    expect(entry?.actorEmail).toBe("admin@example.com");
    expect(entry?.action).toBe("update");
    expect(entry?.images).toEqual([
      { key: "logo", hash: expect.any(String), size: 4 },
    ]);
    expect((entry?.before as { title: string }).title).toBe(current.title);
    expect((entry?.after as { title: string }).title).toBe("My Studio");
  });

  test("a stale version is refused with reason 'stale' and writes no Audit entry", async () => {
    const { db } = await testDb;
    const storage = createLocalStorage(await rootPromise);
    const before = await db.select().from(auditEntries);

    const result = await updateSiteSettings(db, clock, storage, admin, {
      version: 1, // already moved past 1 by the previous test
      title: "Someone else's edit",
      landingText: "",
      accent: "teal",
    });

    expect(result).toEqual({ ok: false, reason: "stale" });

    const after = await db.select().from(auditEntries);
    expect(after).toHaveLength(before.length);
  });
});

describe("Site terms", () => {
  const testDb = createTestDatabase("site_terms_store_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  const admin = {
    type: "admin" as const,
    userId: "00000000-0000-0000-0000-00000000000b",
    email: "admin@example.com",
    ip: "203.0.113.1",
    userAgent: "test-agent",
    requestId: "req-terms",
  };

  test("the first non-blank save starts version 1 and writes an Audit entry with the full text", async () => {
    const { db } = await testDb;
    const current = await getSiteSettings(db);
    expect(current.termsVersion).toBeNull();

    const result = await updateSiteTerms(db, clock, admin, {
      revision: current.termsRevision,
      body: "Be nice to the GPUs.",
      askAgain: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.settings.termsVersion).toBe(1);
    expect(result.settings.termsBody).toBe("Be nice to the GPUs.");
    expect(result.settings.termsVersionCreatedAt).not.toBeNull();
    expect(result.settings.termsRevision).toBe(current.termsRevision + 1);

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "update-terms"));
    expect(entry?.action).toBe("update-terms");
    expect((entry?.after as { termsBody: string }).termsBody).toBe(
      "Be nice to the GPUs.",
    );
    expect((entry?.after as { askAgain: boolean }).askAgain).toBe(false);
  });

  test("a quiet edit keeps the version (and so keeps acceptances)", async () => {
    const { db } = await testDb;
    const current = await getSiteSettings(db);

    const result = await updateSiteTerms(db, clock, admin, {
      revision: current.termsRevision,
      body: "Be nice to the GPUs. (typo fixed)",
      askAgain: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.settings.termsVersion).toBe(current.termsVersion);
    expect(result.settings.termsBody).toBe("Be nice to the GPUs. (typo fixed)");
  });

  test("ticking 'ask everyone to accept again' bumps the version", async () => {
    const { db } = await testDb;
    const current = await getSiteSettings(db);

    const result = await updateSiteTerms(db, clock, admin, {
      revision: current.termsRevision,
      body: current.termsBody,
      askAgain: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.settings.termsVersion).toBe((current.termsVersion ?? 0) + 1);
  });

  test("saving a blank body clears the terms but keeps the version counter (never reused)", async () => {
    const { db } = await testDb;
    const current = await getSiteSettings(db);
    const previousVersion = current.termsVersion;

    const result = await updateSiteTerms(db, clock, admin, {
      revision: current.termsRevision,
      body: "",
      askAgain: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.settings.termsBody).toBe("");
    // `termsVersion` is kept, not nulled, so the next save can't reuse it.
    expect(result.settings.termsVersion).toBe(previousVersion);
  });

  test("resuming with new text after a clear always starts a new version, never reusing the old one", async () => {
    const { db } = await testDb;
    const current = await getSiteSettings(db);
    expect(current.termsBody).toBe(""); // left blank by the previous test
    const previousVersion = current.termsVersion;

    const result = await updateSiteTerms(db, clock, admin, {
      revision: current.termsRevision,
      body: "All-new terms.",
      askAgain: false, // not ticked: resuming from blank must still bump
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.settings.termsVersion).toBe((previousVersion ?? 0) + 1);
    expect(result.settings.termsVersion).not.toBe(previousVersion);
  });

  test("a stale revision is refused with reason 'stale'", async () => {
    const { db } = await testDb;
    const result = await updateSiteTerms(db, clock, admin, {
      revision: 1, // already moved past 1 by earlier tests in this file
      body: "Someone else's edit",
      askAgain: false,
    });
    expect(result).toEqual({ ok: false, reason: "stale" });
  });
});

describe("Site settings and Site terms have independent concurrency locks", () => {
  const testDb = createTestDatabase("site_settings_terms_locks_test");
  const rootPromise = mkdtemp(path.join(tmpdir(), "site-settings-locks-"));
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
    await rm(await rootPromise, { recursive: true, force: true });
  });

  const admin = {
    type: "admin" as const,
    userId: "00000000-0000-0000-0000-00000000000c",
    email: "admin@example.com",
    ip: "203.0.113.1",
    userAgent: "test-agent",
    requestId: "req-locks",
  };

  test("saving branding doesn't make a pending terms save (with its own stale revision) 409", async () => {
    const { db } = await testDb;
    const storage = createLocalStorage(await rootPromise);
    const current = await getSiteSettings(db);

    const brandingResult = await updateSiteSettings(db, clock, storage, admin, {
      version: current.version,
      title: "Renamed Studio",
      landingText: "",
      accent: "teal",
    });
    expect(brandingResult.ok).toBe(true);

    const termsResult = await updateSiteTerms(db, clock, admin, {
      revision: current.termsRevision,
      body: "Be nice.",
      askAgain: false,
    });
    expect(termsResult.ok).toBe(true);
  });

  test("saving terms doesn't make a pending branding save (with its own stale version) 409", async () => {
    const { db } = await testDb;
    const storage = createLocalStorage(await rootPromise);
    const current = await getSiteSettings(db);

    const termsResult = await updateSiteTerms(db, clock, admin, {
      revision: current.termsRevision,
      body: "Be nice. (again)",
      askAgain: false,
    });
    expect(termsResult.ok).toBe(true);

    const brandingResult = await updateSiteSettings(db, clock, storage, admin, {
      version: current.version,
      title: "Renamed Again",
      landingText: "",
      accent: "teal",
    });
    expect(brandingResult.ok).toBe(true);
  });
});
