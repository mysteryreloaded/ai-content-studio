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
  | { ok: false; reason: "not_found" | "pinned" | "invalid_state" };

async function applyUserAction(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  userId: string,
  action: "approve" | "promote" | "demote",
  precondition: (user: typeof users.$inferSelect) => boolean,
  changes: Partial<typeof users.$inferInsert>,
): Promise<UserActionResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user) return { ok: false, reason: "not_found" };
    if (user.pinned) return { ok: false, reason: "pinned" };
    if (!precondition(user)) return { ok: false, reason: "invalid_state" };

    const now = clock.now();
    const [updated] = await tx
      .update(users)
      .set({ ...changes, updatedAt: now })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw new Error("user update affected no row");

    await recordAuditEntry(tx, clock, {
      actor,
      targetType: "user",
      targetId: userId,
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

/** Approves a pending user (issue #62). Refused for a pinned Admin (never pending) or a user that isn't pending. */
export function approveUser(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  userId: string,
): Promise<UserActionResult> {
  return applyUserAction(
    db,
    clock,
    actor,
    userId,
    "approve",
    (user) => user.status === "pending",
    { status: "active" },
  );
}

/** Promotes a user to Admin (issue #62). Refused for a pinned Admin or a user already an Admin. */
export function promoteUser(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  userId: string,
): Promise<UserActionResult> {
  return applyUserAction(
    db,
    clock,
    actor,
    userId,
    "promote",
    (user) => user.role === "user",
    { role: "admin" },
  );
}

/** Demotes an Admin to a plain user (issue #62). Refused for a pinned Admin or a user that isn't an Admin. */
export function demoteUser(
  db: Database,
  clock: Clock,
  actor: AuditActor,
  userId: string,
): Promise<UserActionResult> {
  return applyUserAction(
    db,
    clock,
    actor,
    userId,
    "demote",
    (user) => user.role === "admin",
    { role: "user" },
  );
}

/**
 * Unpins any Admin no longer listed in `ADMIN_EMAILS`, without touching
 * their role or status (issue #62). Call once at boot: `ADMIN_EMAILS`
 * only changes between deploys, never mid-request.
 */
export async function syncAdminEmailPins(
  db: Database,
  clock: Clock,
  adminEmails: readonly string[],
): Promise<void> {
  const lowerEmails = new Set(adminEmails.map((email) => email.toLowerCase()));

  await db.transaction(async (tx) => {
    const pinned = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.pinned, true));

    for (const user of pinned) {
      if (lowerEmails.has(user.email.toLowerCase())) continue;

      await tx
        .update(users)
        .set({ pinned: false, updatedAt: clock.now() })
        .where(eq(users.id, user.id));

      await recordAuditEntry(tx, clock, {
        actor: { type: "system" },
        targetType: "user",
        targetId: user.id,
        action: "unpin",
        before: { pinned: true },
        after: { pinned: false },
      });
    }
  });
}
