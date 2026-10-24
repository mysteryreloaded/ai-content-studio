// Backend persistence: create/edit/soft-delete with optimistic versioning
// (stale save -> 409) and write-only credentials (issue #39).

import type { Clock } from "@ai-content-studio/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import { recordAuditEntry } from "../audit/audit.js";
import type { Database, Transaction } from "../db/client.js";
import { backends } from "../db/schema.js";
import { decryptCredentials, encryptCredentials } from "./credentials.js";
import type { AuthKind, BackendInput } from "./validation.js";
import { ValidationFailed, validateBackendInput } from "./validation.js";

export class StaleVersion extends Error {
  constructor() {
    super("changed by someone else, reload");
  }
}

export class NameTaken extends Error {
  constructor() {
    super("a Backend with this name already exists");
  }
}

export class NotFound extends Error {
  constructor() {
    super("Backend not found");
  }
}

export interface BackendRecord {
  id: string;
  name: string;
  baseUrl: string;
  auth: AuthKind;
  headerName: string | null;
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type Row = typeof backends.$inferSelect;

export type CredentialAuditState = "set" | "changed" | "unchanged" | "cleared";

function toRecord(row: Row): BackendRecord {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    auth: row.authKind,
    headerName: row.headerName,
    version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function credentialsPlaintext(input: BackendInput): string | null {
  if (input.auth === "basic" && (input.basicUser || input.basicPass)) {
    return JSON.stringify({ user: input.basicUser, pass: input.basicPass });
  }
  if (input.auth === "header" && input.headerValue) {
    return JSON.stringify({ value: input.headerValue });
  }
  return null;
}

/** Whether the input actually supplies new credentials, vs. leaving them blank to keep the existing ones. */
function suppliesCredentials(input: BackendInput): boolean {
  if (input.auth === "basic")
    return Boolean(input.basicUser || input.basicPass);
  if (input.auth === "header") return Boolean(input.headerValue);
  return false;
}

function isUniqueViolation(err: unknown): boolean {
  const cause =
    err && typeof err === "object" && "cause" in err ? err.cause : err;
  return Boolean(
    cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505",
  );
}

async function writeBackendAuditEntry(
  tx: Transaction,
  clock: Clock,
  actor: AuditActor,
  action: "create" | "update" | "soft_delete",
  backendId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  await recordAuditEntry(tx, clock, {
    actor,
    targetType: "backend",
    targetId: backendId,
    action,
    before,
    after,
  });
}

function snapshot(row: Row, credentials: CredentialAuditState) {
  return {
    name: row.name,
    baseUrl: row.baseUrl,
    authKind: row.authKind,
    headerName: row.headerName,
    credentials,
  };
}

export class BackendRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly secretKey: string,
  ) {}

  async create(input: BackendInput, actor: AuditActor): Promise<BackendRecord> {
    const errors = validateBackendInput(input);
    if (errors.length > 0) throw new ValidationFailed(errors);

    try {
      return await this.db.transaction(async (tx) => {
        const plaintext = credentialsPlaintext(input);

        const [row] = await tx
          .insert(backends)
          .values({
            name: input.name,
            baseUrl: input.baseUrl,
            authKind: input.auth,
            headerName: input.headerName ?? null,
          })
          .returning();
        if (!row) throw new Error("insert returned no row");

        let finalRow = row;
        if (plaintext !== null) {
          const encrypted = encryptCredentials(
            plaintext,
            this.secretKey,
            row.id,
          );
          const [updated] = await tx
            .update(backends)
            .set({ encryptedCredentials: encrypted })
            .where(eq(backends.id, row.id))
            .returning();
          if (!updated) throw new Error("update returned no row");
          finalRow = updated;
        }

        const credentialState: CredentialAuditState =
          plaintext !== null ? "set" : "unchanged";
        await writeBackendAuditEntry(
          tx,
          this.clock,
          actor,
          "create",
          row.id,
          null,
          snapshot(finalRow, credentialState),
        );

        return toRecord(finalRow);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new NameTaken();
      throw err;
    }
  }

  async update(
    id: string,
    input: BackendInput,
    expectedVersion: number,
    actor: AuditActor,
  ): Promise<BackendRecord> {
    try {
      return await this.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(backends)
          .where(and(eq(backends.id, id), isNull(backends.deletedAt)));
        if (!before) throw new NotFound();

        const hasExistingCredentials =
          Boolean(before.encryptedCredentials) &&
          before.authKind === input.auth;
        const errors = validateBackendInput(input, { hasExistingCredentials });
        if (errors.length > 0) throw new ValidationFailed(errors);

        const credentialsSupplied = suppliesCredentials(input);
        let encrypted = before.encryptedCredentials;
        let credentialState: CredentialAuditState;
        if (input.auth !== before.authKind) {
          const plaintext = credentialsPlaintext(input);
          encrypted =
            plaintext !== null
              ? encryptCredentials(plaintext, this.secretKey, id)
              : null;
          credentialState = plaintext !== null ? "set" : "cleared";
        } else if (credentialsSupplied) {
          const plaintext = credentialsPlaintext(input);
          encrypted =
            plaintext !== null
              ? encryptCredentials(plaintext, this.secretKey, id)
              : null;
          credentialState = "changed";
        } else {
          credentialState = "unchanged";
        }

        const [row] = await tx
          .update(backends)
          .set({
            name: input.name,
            baseUrl: input.baseUrl,
            authKind: input.auth,
            headerName: input.headerName ?? null,
            encryptedCredentials: encrypted,
            version: before.version + 1,
            updatedAt: this.clock.now(),
          })
          .where(
            and(eq(backends.id, id), eq(backends.version, expectedVersion)),
          )
          .returning();
        if (!row) throw new StaleVersion();

        await writeBackendAuditEntry(
          tx,
          this.clock,
          actor,
          "update",
          id,
          snapshot(
            before,
            before.encryptedCredentials ? "unchanged" : "cleared",
          ),
          snapshot(row, credentialState),
        );

        return toRecord(row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new NameTaken();
      throw err;
    }
  }

  async softDelete(
    id: string,
    expectedVersion: number,
    actor: AuditActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(backends)
        .where(and(eq(backends.id, id), isNull(backends.deletedAt)));
      if (!before) throw new NotFound();

      const [row] = await tx
        .update(backends)
        .set({ deletedAt: this.clock.now(), version: before.version + 1 })
        .where(and(eq(backends.id, id), eq(backends.version, expectedVersion)))
        .returning();
      if (!row) throw new StaleVersion();

      await writeBackendAuditEntry(
        tx,
        this.clock,
        actor,
        "soft_delete",
        id,
        snapshot(before, before.encryptedCredentials ? "unchanged" : "cleared"),
        null,
      );
    });
  }

  async get(id: string): Promise<BackendRecord | null> {
    const [row] = await this.db
      .select()
      .from(backends)
      .where(and(eq(backends.id, id), isNull(backends.deletedAt)));
    return row ? toRecord(row) : null;
  }

  async list(): Promise<BackendRecord[]> {
    const rows = await this.db
      .select()
      .from(backends)
      .where(isNull(backends.deletedAt))
      .orderBy(backends.name);
    return rows.map(toRecord);
  }

  /** Decrypts the stored credentials for use by the health monitor. Throws {@link DecryptionFailed} if the row can't be decrypted. */
  async decryptedCredentials(
    id: string,
  ): Promise<{ user?: string; pass?: string; value?: string } | null> {
    const [row] = await this.db
      .select()
      .from(backends)
      .where(eq(backends.id, id));
    if (!row || !row.encryptedCredentials) return null;
    const plaintext = decryptCredentials(
      row.encryptedCredentials,
      this.secretKey,
      id,
    );
    return JSON.parse(plaintext);
  }
}
