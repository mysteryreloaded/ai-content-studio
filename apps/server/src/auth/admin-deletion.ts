// An Admin deleting another user's account (issue #64's AC: "An Admin
// delete scrubs like a self-delete"): same scrub as issue #63's
// self-delete (auth/account-deletion.ts), but the actor is the Admin,
// the acting Admin can't be the target (ADR 0008: 404, not 403, so the
// row's existence isn't leaked past what the Users page already shows),
// and a pinned Admin can't be the target either. Deleting a user who was
// `disabled` additionally blocks their Google account from signing up
// again: a plain SHA-256 of their raw `sub` (no per-row salt, unlike the
// scrub's own hash on `googleSub`) goes into `blockedAccounts`, which the
// sign-in callback checks before creating a brand-new user.

import type { Clock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { type AuditActor, recordAuditEntry } from "../audit/audit.js";
import { blockedAccounts, users } from "../db/schema.js";
import {
  type AccountDeletionDeps,
  scrubUserAccount,
  scrubbedUserFields,
  sha256Hex,
} from "./account-deletion.js";
import { isPinned } from "./users.js";

export type AdminDeletionResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

/**
 * Deletes `targetId`'s account as an Admin action. Refused (as
 * `not_found`, matching approve/promote/demote's ADR 0008 shape) when
 * the target is the acting Admin, is pinned, or doesn't exist.
 */
export async function adminDeleteUser(
  deps: AccountDeletionDeps,
  clock: Clock,
  actor: AuditActor,
  actingUserId: string,
  targetId: string,
  adminEmails: readonly string[],
  reason: string | null,
): Promise<AdminDeletionResult> {
  const [user] = await deps.db
    .select()
    .from(users)
    .where(eq(users.id, targetId));
  if (!user) return { ok: false, reason: "not_found" };
  if (targetId === actingUserId || isPinned(user.email, adminEmails)) {
    return { ok: false, reason: "not_found" };
  }

  const now = clock.now();
  const wasDisabled = user.status === "disabled";
  await scrubUserAccount(deps, user, now);

  await deps.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set(scrubbedUserFields(user, now))
      .where(eq(users.id, targetId));

    if (wasDisabled) {
      await tx
        .insert(blockedAccounts)
        .values({
          subHash: sha256Hex(user.googleSub),
          reason: reason ?? user.disabledReason,
          createdAt: now,
        })
        .onConflictDoNothing();
    }

    await recordAuditEntry(tx, clock, {
      actor,
      targetType: "user",
      targetId,
      action: "admin-delete",
      before: { role: user.role, status: user.status },
      after: { role: user.role, status: "disabled", blocked: wasDisabled },
    });
  });

  return { ok: true };
}
