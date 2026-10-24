import type { Clock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { recordAuditEntry } from "../audit/audit.js";
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
 * panel can never undo it) — new users are active straight away until
 * approval sign-up lands.
 */
export async function upsertUserFromGoogle(
  db: Database,
  clock: Clock,
  identity: GoogleIdentity,
  adminEmails: readonly string[],
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
        status: "active",
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
