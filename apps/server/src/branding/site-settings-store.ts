import type { Clock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { recordAuditEntry } from "../audit/audit.js";
import type { AuditActor, AuditImage } from "../audit/audit.js";
import type { Database } from "../db/client.js";
import { siteSettings } from "../db/schema.js";
import type { Storage } from "../storage/storage.js";

export const LOGO_STORAGE_KEY = "branding/logo";
export const BACKGROUND_STORAGE_KEY = "branding/background";

export interface ImageSnapshot {
  contentType: string;
  hash: string;
  size: number;
}

export interface SiteSettingsSnapshot {
  version: number;
  title: string;
  landingText: string;
  accent: string;
  logo: ImageSnapshot | null;
  background: ImageSnapshot | null;
  termsBody: string;
  termsVersion: number | null;
  termsVersionCreatedAt: Date | null;
}

export interface SiteSettingsUpdateImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface SiteSettingsUpdateInput {
  version: number;
  title: string;
  landingText: string;
  accent: string;
  logo?: SiteSettingsUpdateImage;
  background?: SiteSettingsUpdateImage;
}

export type SiteSettingsUpdateResult =
  | { ok: true; settings: SiteSettingsSnapshot }
  | { ok: false; reason: "stale" };

function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function rowToSnapshot(
  row: typeof siteSettings.$inferSelect,
): SiteSettingsSnapshot {
  return {
    version: row.version,
    title: row.title,
    landingText: row.landingText,
    accent: row.accent,
    logo:
      row.logoHash && row.logoContentType && row.logoSize != null
        ? {
            contentType: row.logoContentType,
            hash: row.logoHash,
            size: row.logoSize,
          }
        : null,
    background:
      row.backgroundHash &&
      row.backgroundContentType &&
      row.backgroundSize != null
        ? {
            contentType: row.backgroundContentType,
            hash: row.backgroundHash,
            size: row.backgroundSize,
          }
        : null,
    termsBody: row.termsBody,
    termsVersion: row.termsVersion,
    termsVersionCreatedAt: row.termsVersionCreatedAt,
  };
}

/** Reads the single Site settings row, which always exists after migration. */
export async function getSiteSettings(
  db: Database,
): Promise<SiteSettingsSnapshot> {
  const [row] = await db.select().from(siteSettings).limit(1);
  if (!row) throw new Error("site_settings row is missing");
  return rowToSnapshot(row);
}

/**
 * Validates `input.version` against the current row, writes any new
 * images to `storage`, and saves the row and its Audit entry (ADR 0005)
 * in one transaction. Returns `{ ok: false, reason: "stale" }` instead
 * of saving when another save won the race.
 */
export async function updateSiteSettings(
  db: Database,
  clock: Clock,
  storage: Storage,
  actor: AuditActor,
  input: SiteSettingsUpdateInput,
): Promise<SiteSettingsUpdateResult> {
  const images: AuditImage[] = [];
  let logoColumns: Partial<typeof siteSettings.$inferInsert> = {};
  let backgroundColumns: Partial<typeof siteSettings.$inferInsert> = {};

  if (input.logo) {
    const hash = sha256Hex(input.logo.bytes);
    await storage.write(LOGO_STORAGE_KEY, input.logo.bytes);
    logoColumns = {
      logoContentType: input.logo.contentType,
      logoHash: hash,
      logoSize: input.logo.bytes.byteLength,
    };
    images.push({ key: "logo", hash, size: input.logo.bytes.byteLength });
  }

  if (input.background) {
    const hash = sha256Hex(input.background.bytes);
    await storage.write(BACKGROUND_STORAGE_KEY, input.background.bytes);
    backgroundColumns = {
      backgroundContentType: input.background.contentType,
      backgroundHash: hash,
      backgroundSize: input.background.bytes.byteLength,
    };
    images.push({
      key: "background",
      hash,
      size: input.background.bytes.byteLength,
    });
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(siteSettings).limit(1);
    if (!current) throw new Error("site_settings row is missing");
    if (current.version !== input.version) {
      return { ok: false, reason: "stale" };
    }

    const before = rowToSnapshot(current);
    const now = clock.now();

    const [updated] = await tx
      .update(siteSettings)
      .set({
        version: current.version + 1,
        title: input.title,
        landingText: input.landingText,
        accent: input.accent,
        updatedAt: now,
        ...logoColumns,
        ...backgroundColumns,
      })
      .where(eq(siteSettings.singleton, true))
      .returning();
    if (!updated) throw new Error("site_settings update affected no row");

    const after = rowToSnapshot(updated);

    await recordAuditEntry(tx, clock, {
      actor,
      targetType: "site_settings",
      targetId: "singleton",
      action: "update",
      before,
      after,
      images: images.length > 0 ? images : undefined,
    });

    return { ok: true, settings: after };
  });
}

export interface SiteTermsUpdateInput {
  version: number;
  body: string;
  askAgain: boolean;
}

export type SiteTermsUpdateResult =
  | { ok: true; settings: SiteSettingsSnapshot }
  | { ok: false; reason: "stale" };

/**
 * Saves the Site terms body and decides `termsVersion` (issue #60):
 * blank keeps/clears "no terms set"; a first non-blank body starts
 * version 1; `askAgain` bumps the version on top of that (new version,
 * every acceptance cleared); any other save keeps the version, so a
 * quiet text edit never re-asks anyone. The full before/after text and
 * `askAgain` are kept in the Audit entry (ADR 0005) forever.
 */
export async function updateSiteTerms(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  input: SiteTermsUpdateInput,
): Promise<SiteTermsUpdateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(siteSettings).limit(1);
    if (!current) throw new Error("site_settings row is missing");
    if (current.version !== input.version) {
      return { ok: false, reason: "stale" };
    }

    const before = rowToSnapshot(current);
    const now = clock.now();
    const body = input.body.trim();

    let termsVersion = current.termsVersion;
    let termsVersionCreatedAt = current.termsVersionCreatedAt;
    if (body === "") {
      termsVersion = null;
      termsVersionCreatedAt = null;
    } else if (current.termsVersion === null || input.askAgain) {
      termsVersion = (current.termsVersion ?? 0) + 1;
      termsVersionCreatedAt = now;
    }

    const [updated] = await tx
      .update(siteSettings)
      .set({
        version: current.version + 1,
        termsBody: body,
        termsVersion,
        termsVersionCreatedAt,
        updatedAt: now,
      })
      .where(eq(siteSettings.singleton, true))
      .returning();
    if (!updated) throw new Error("site_settings update affected no row");

    const after = rowToSnapshot(updated);

    await recordAuditEntry(tx, clock, {
      actor,
      targetType: "site_settings",
      targetId: "singleton",
      action: "update-terms",
      before: {
        termsBody: before.termsBody,
        termsVersion: before.termsVersion,
      },
      after: {
        termsBody: after.termsBody,
        termsVersion: after.termsVersion,
        askAgain: input.askAgain,
      },
    });

    return { ok: true, settings: after };
  });
}
