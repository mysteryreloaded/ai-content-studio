import type { Clock, SignUpMode } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { type AuditActor, recordAuditEntry } from "../audit/audit.js";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";
import type { GoogleIdentity } from "./oidc.js";

export interface UpsertedUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
}

/**
 * Creates or refreshes the user keyed on their Google `sub`. Email, name
 * and picture are always refreshed. An email listed in `ADMIN_EMAILS` is
 * promoted, approved and re-enabled every time (and pinned, so the admin
 * panel can never undo it). Otherwise a brand-new user starts `pending`
 * under approval sign-up, `active` under open sign-up (issue #62) — an
 * existing user's status is never touched here.
 */
export async function upsertUserFromGoogle(
  db: Database,
  clock: Clock,
  identity: GoogleIdentity,
  adminEmails: readonly string[],
  signUpMode: SignUpMode,
): Promise<UpsertedUser> {
  const isAdmin = adminEmails.includes(identity.email.toLowerCase());
  const now = clock.now();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.googleSub, identity.sub));

    const [row] = await tx
      .insert(users)
      .values({
        googleSub: identity.sub,
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
        role: isAdmin ? "admin" : "user",
        status: isAdmin || signUpMode === "open" ? "active" : "pending",
        pinned: isAdmin,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.googleSub,
        set: {
          email: identity.email,
          name: identity.name,
          picture: identity.picture,
          updatedAt: now,
          ...(isAdmin
            ? {
                role: "admin" as const,
                status: "active" as const,
                pinned: true,
              }
            : {}),
        },
      })
      .returning();

    if (!row) throw new Error("upsert returned no row");

    // ADR 0005: a sign-in that promotes/approves/re-enables an
    // ADMIN_EMAILS user is the system acting, not that Admin themself.
    if (
      isAdmin &&
      existing &&
      (existing.role !== row.role || existing.status !== row.status)
    ) {
      await recordAuditEntry(tx, clock, {
        actor: { type: "system" },
        targetType: "user",
        targetId: row.id,
        action: "admin-emails-sync",
        before: { role: existing.role, status: existing.status },
        after: { role: row.role, status: row.status },
      });
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      picture: row.picture,
      role: row.role,
      status: row.status,
    };
  });
}

export type UserActionResult =
  | { ok: true; user: UpsertedUser }
  | { ok: false; reason: "not_found" | "invalid_state" };

/**
 * Whether `email` is pinned: read live against `adminEmails` on every
 * check (ADR 0008), never from a stored flag, so removing an email from
 * `ADMIN_EMAILS` unpins that Admin immediately, with no write and no
 * Audit entry of its own — only the Operator's configuration changed,
 * not anything about the user.
 */
export function isPinned(
  email: string,
  adminEmails: readonly string[],
): boolean {
  return adminEmails.includes(email.toLowerCase());
}

/**
 * ADR 0008: a target that's pinned, or is the acting Admin themselves,
 * is refused 404 like a missing row, not 403 — so the row's existence
 * isn't leaked past what the Users page already shows, and the admin
 * panel can hide the same actions it would otherwise be refused.
 */
async function applyUserAction(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  actingUserId: string,
  targetId: string,
  adminEmails: readonly string[],
  action: "approve" | "promote" | "demote",
  precondition: (user: typeof users.$inferSelect) => boolean,
  changes: Partial<typeof users.$inferInsert>,
): Promise<UserActionResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, targetId));
    if (!user) return { ok: false, reason: "not_found" };
    if (targetId === actingUserId || isPinned(user.email, adminEmails)) {
      return { ok: false, reason: "not_found" };
    }
    if (!precondition(user)) return { ok: false, reason: "invalid_state" };

    const now = clock.now();
    const [updated] = await tx
      .update(users)
      .set({ ...changes, updatedAt: now })
      .where(eq(users.id, targetId))
      .returning();
    if (!updated) throw new Error("user update affected no row");

    await recordAuditEntry(tx, clock, {
      actor,
      targetType: "user",
      targetId,
      action,
      before: { role: user.role, status: user.status },
      after: { role: updated.role, status: updated.status },
    });

    return {
      ok: true,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        picture: updated.picture,
        role: updated.role,
        status: updated.status,
      },
    };
  });
}

/** Approves a pending user (issue #62). Refused for a pinned Admin (never pending), the acting Admin's own row, or a user that isn't pending. */
export function approveUser(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  actingUserId: string,
  targetId: string,
  adminEmails: readonly string[],
): Promise<UserActionResult> {
  return applyUserAction(
    db,
    clock,
    actor,
    actingUserId,
    targetId,
    adminEmails,
    "approve",
    (user) => user.status === "pending",
    { status: "active" },
  );
}

/**
 * Promotes a user to Admin (issue #62). Refused for a pinned Admin, the
 * acting Admin's own row, a user already an Admin, or a user still
 * pending (ADR 0008: approve before promote — two clicks, two Audit
 * entries, never one).
 */
export function promoteUser(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  actingUserId: string,
  targetId: string,
  adminEmails: readonly string[],
): Promise<UserActionResult> {
  return applyUserAction(
    db,
    clock,
    actor,
    actingUserId,
    targetId,
    adminEmails,
    "promote",
    (user) => user.role === "user" && user.status === "active",
    { role: "admin" },
  );
}

/** Demotes an Admin to a plain user (issue #62). Refused for a pinned Admin, the acting Admin's own row, or a user that isn't an Admin. */
export function demoteUser(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  actingUserId: string,
  targetId: string,
  adminEmails: readonly string[],
): Promise<UserActionResult> {
  return applyUserAction(
    db,
    clock,
    actor,
    actingUserId,
    targetId,
    adminEmails,
    "demote",
    (user) => user.role === "admin",
    { role: "user" },
  );
}
