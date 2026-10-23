import type { Clock } from "@ai-content-studio/shared";
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

  const [row] = await db
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
          ? { role: "admin" as const, status: "active" as const, pinned: true }
          : {}),
      },
    })
    .returning();

  if (!row) throw new Error("upsert returned no row");

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    role: row.role,
    status: row.status,
  };
}
