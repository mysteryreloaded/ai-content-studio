// `/api/admin/blocked-accounts`: the list of Google accounts an Admin
// delete blocked from signing up again (issue #64's AC), and clearing
// one off it.

import type { Clock } from "@ai-content-studio/shared";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { adminActorFrom } from "../audit/actor.js";
import { recordAuditEntry } from "../audit/audit.js";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { Database } from "../db/client.js";
import { blockedAccounts } from "../db/schema.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

/** `/api/admin/blocked-accounts`: list and clear. */
export function adminBlockedAccountsRoute(
  db: Database,
  clock: Clock,
  routes: RouteEntry[],
) {
  const basePath = "/api/admin/blocked-accounts";

  return new Hono<AppEnv>()
    .get("/", guard(routes, basePath, "get", "/", "admin"), async (c) => {
      const rows = await db
        .select({
          id: blockedAccounts.id,
          userId: blockedAccounts.userId,
          disabledAt: blockedAccounts.disabledAt,
          reason: blockedAccounts.reason,
          createdAt: blockedAccounts.createdAt,
        })
        .from(blockedAccounts)
        .orderBy(desc(blockedAccounts.createdAt));
      return c.json({ blockedAccounts: rows });
    })
    .delete(
      "/:id",
      guard(routes, basePath, "delete", "/:id", "admin"),
      async (c) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return c.json({ error: "not found" }, 404);

        const result = await db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(blockedAccounts)
            .where(eq(blockedAccounts.id, id));
          if (!row) return { ok: false as const };

          await tx.delete(blockedAccounts).where(eq(blockedAccounts.id, id));

          await recordAuditEntry(tx, clock, {
            actor: adminActorFrom(c),
            targetType: "blocked-account",
            targetId: id,
            action: "unblock",
            before: { reason: row.reason },
            after: null,
          });

          return { ok: true as const };
        });

        if (!result.ok) return c.json({ error: "not found" }, 404);
        return c.json({ ok: true });
      },
    );
}
