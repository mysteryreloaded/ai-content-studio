// Self-delete (issue #63, ADR 0005): a user, active or still pending,
// deletes their own account by typing their email back. Every session
// is dropped, anything still under way is cancelled (issue #54's own
// cancel, reused), every Generation goes through the same Generation-
// delete path as a manual delete (issue #57: Tombstone + storage
// cleanup), and the user row is scrubbed but its id is kept — so an
// Audit entry or another user's Generation that still names this id
// keeps reading "Deleted user" instead of pointing at a gone row. The
// Google `sub` is hashed with this row's own id salted in (never the
// raw value, and unique even if the same Google account deletes and
// re-registers more than once), freeing the real `sub` so signing in
// again makes a fresh user.
//
// Round 4: cancelling only gets a `queued`/`starting`/`running`
// Generation to `cancelling`, and a `saving` one can't be cancelled at
// all — both still end later through the runner's own terminal write,
// not through this request. Those are flagged with `deletedAt` here
// (`markUnfinishedForPendingDeletion`) so `finalizeIfPendingDeletion`
// Tombstones each one for good the moment it actually ends. Every other
// Upload this user has — unused, failed or still uploading, not just
// the ones a Tombstoned Generation referenced — is deleted outright,
// except one still feeding a run that hasn't ended yet.

import type { Clock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { recordAuditEntry } from "../audit/audit.js";
import type { Database } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import {
  type CancellationDeps,
  cancelGeneration,
} from "../generations/cancellation.js";
import { deleteStorageFor } from "../generations/deletion.js";
import type { GenerationsRepository } from "../generations/repository.js";
import type { Storage } from "../storage/storage.js";
import type { UploadsRepository } from "../uploads/repository.js";

export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "email_mismatch" };

export interface AccountDeletionDeps {
  db: Database;
  clock: Clock;
  generationsRepository: GenerationsRepository;
  uploadsRepository: UploadsRepository;
  cancellationDeps: CancellationDeps;
  storage: Storage;
}

function sha256Hex(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

/**
 * Deletes `userId`'s own account (issue #63's AC). Refused for an Admin,
 * or when `typedEmail` doesn't match this user's current email — the
 * server re-checks it rather than trusting whatever the account page
 * sent.
 */
export async function deleteOwnAccount(
  deps: AccountDeletionDeps,
  userId: string,
  typedEmail: string,
): Promise<AccountDeletionResult> {
  const [user] = await deps.db.select().from(users).where(eq(users.id, userId));
  if (!user) return { ok: false, reason: "forbidden" };
  // Checked before the Admin refusal below, so a wrong email always
  // reads the same way regardless of role.
  if (user.email.toLowerCase() !== typedEmail.trim().toLowerCase()) {
    return { ok: false, reason: "email_mismatch" };
  }
  if (user.role === "admin") return { ok: false, reason: "forbidden" };

  const now = deps.clock.now();

  const unfinishedIds =
    await deps.generationsRepository.listUnfinishedIdsForUser(userId);
  for (const generationId of unfinishedIds) {
    try {
      await cancelGeneration(generationId, userId, deps.cancellationDeps);
    } catch {
      // Raced to a terminal state (or someone else's cancel) between the
      // list above and this call — nothing left to cancel, carry on.
    }
  }

  // Flags what cancelling couldn't finish for good right away — `saving`
  // (uncancellable) and `starting`/`running` only just moved to
  // `cancelling` above — so the runner's own terminal write Tombstones
  // each one the moment it actually ends.
  await deps.generationsRepository.markUnfinishedForPendingDeletion(
    userId,
    now,
  );

  const keys = await deps.generationsRepository.deleteAllEndedForUser(
    userId,
    now,
  );
  await deleteStorageFor(deps.storage, keys);

  const inUseUploadIds =
    await deps.generationsRepository.listUploadIdsInUseForUser(userId);
  const uploadKeys = await deps.uploadsRepository.deleteAllForUserExcept(
    userId,
    inUseUploadIds,
  );
  await deleteStorageFor(deps.storage, { assets: [], uploads: uploadKeys });

  await deps.db.delete(sessions).where(eq(sessions.userId, userId));

  await deps.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        name: "Deleted user",
        email: "",
        picture: null,
        googleSub: sha256Hex(`${user.googleSub}:${user.id}`),
        status: "disabled",
        pinned: false,
        termsAcceptedVersion: null,
        termsAcceptedAt: null,
        dailyCapOverride: null,
        concurrentCapOverride: null,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    // ADR 0005: a self-delete by a non-Admin records only the acting
    // user's id — no email, IP address or user agent.
    await recordAuditEntry(tx, deps.clock, {
      actor: { type: "user", userId },
      targetType: "user",
      targetId: userId,
      action: "self-delete",
      before: { role: user.role, status: user.status },
      after: { role: user.role, status: "disabled" },
    });
  });

  return { ok: true };
}
