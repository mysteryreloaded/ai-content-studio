import type { Clock } from "@ai-content-studio/shared";
import type { Database, Transaction } from "../db/client.js";
import { auditEntries } from "../db/schema.js";

/**
 * ADR 0005: an Admin (named) or "system". A deleted/non-Admin target is
 * id-only. `"user"` is a non-Admin acting on themself (issue #63's
 * self-delete) — id-only too, with no email, IP address or user agent.
 */
export type AuditActor =
  | {
      type: "admin";
      userId: string;
      email: string;
      ip: string | null;
      userAgent: string | null;
      requestId: string;
    }
  | { type: "system" }
  | { type: "user"; userId: string };

export interface AuditImage {
  key: string;
  hash: string;
  size: number;
}

export interface AuditEntryInput {
  actor: AuditActor;
  targetType: string;
  targetId: string;
  action: string;
  before: unknown;
  after: unknown;
  images?: AuditImage[];
}

/** Inserts one append-only Audit entry row. Call inside the same transaction as the save it records. */
export async function recordAuditEntry(
  db: Pick<Database, "insert"> | Pick<Transaction, "insert">,
  clock: Clock,
  entry: AuditEntryInput,
): Promise<void> {
  await db.insert(auditEntries).values({
    createdAt: clock.now(),
    actorType: entry.actor.type,
    actorUserId:
      entry.actor.type === "admin" || entry.actor.type === "user"
        ? entry.actor.userId
        : null,
    actorEmail: entry.actor.type === "admin" ? entry.actor.email : null,
    actorIp: entry.actor.type === "admin" ? entry.actor.ip : null,
    actorUserAgent: entry.actor.type === "admin" ? entry.actor.userAgent : null,
    actorRequestId: entry.actor.type === "admin" ? entry.actor.requestId : null,
    targetType: entry.targetType,
    targetId: entry.targetId,
    action: entry.action,
    before: entry.before,
    after: entry.after,
    images: entry.images ?? null,
  });
}
