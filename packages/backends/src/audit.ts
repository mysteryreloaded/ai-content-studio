// Audit entries for Backend saves (ADR 0005: Admins only). Credentials are
// never written as plaintext; only whether they were set/changed/unchanged/cleared.

import type postgres from "postgres";

/** Either a plain connection or a transaction - both support template-literal queries. */
export type Queryable = postgres.Sql | postgres.TransactionSql;

export type CredentialAuditState = "set" | "changed" | "unchanged" | "cleared";

export interface Actor {
  adminEmail: string;
  ip: string;
  userAgent: string;
  requestId: string;
}

export interface BackendAuditSnapshot {
  name: string;
  baseUrl: string;
  authKind: string;
  headerName: string | null;
  credentials: CredentialAuditState;
}

export async function writeBackendAuditEntry(
  sql: Queryable,
  actor: Actor | "system",
  action: "create" | "update" | "soft_delete",
  backendId: string,
  before: BackendAuditSnapshot | null,
  after: BackendAuditSnapshot | null,
): Promise<void> {
  const actorText =
    actor === "system"
      ? "system"
      : `${actor.adminEmail} ip=${actor.ip} ua=${actor.userAgent} req=${actor.requestId}`;

  await sql`
    insert into audit_entries (actor, target, action, before, after)
    values (
      ${actorText},
      ${`backend:${backendId}`},
      ${action},
      ${before ? sql.json(JSON.parse(JSON.stringify(before))) : null},
      ${after ? sql.json(JSON.parse(JSON.stringify(after))) : null}
    )
  `;
}
