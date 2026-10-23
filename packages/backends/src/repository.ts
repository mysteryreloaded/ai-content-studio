// Backend persistence: create/edit/soft-delete with optimistic versioning
// (stale save -> 409) and write-only credentials (issue #39).

import type postgres from "postgres";
import { type Actor, type CredentialAuditState, writeBackendAuditEntry } from "./audit";
import { decryptCredentials, encryptCredentials } from "./credentials";
import { type AuthKind, type BackendInput, validateBackendInput, ValidationFailed } from "./validation";

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

interface Row {
  id: string;
  name: string;
  base_url: string;
  auth_kind: AuthKind;
  encrypted_credentials: Buffer | null;
  header_name: string | null;
  version: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: Row): BackendRecord {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    auth: row.auth_kind,
    headerName: row.header_name,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
  if (input.auth === "basic") return Boolean(input.basicUser || input.basicPass);
  if (input.auth === "header") return Boolean(input.headerValue);
  return false;
}

export class BackendRepository {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly secretKey: string,
  ) {}

  async create(input: BackendInput, actor: Actor | "system"): Promise<BackendRecord> {
    const errors = validateBackendInput(input);
    if (errors.length > 0) throw new ValidationFailed(errors);

    const record = await this.sql.begin(async (tx) => {
      const existing = await tx<
        Row[]
      >`select id from backends where name = ${input.name} and deleted_at is null`;
      if (existing.length > 0) throw new NameTaken();

      const [row] = await tx<Row[]>`
        insert into backends (name, base_url, auth_kind, header_name)
        values (${input.name}, ${input.baseUrl}, ${input.auth}, ${input.headerName ?? null})
        returning *
      `;
      if (!row) throw new Error("insert returned no row");

      const plaintext = credentialsPlaintext(input);
      if (plaintext !== null) {
        const encrypted = encryptCredentials(plaintext, this.secretKey, row.id);
        await tx`update backends set encrypted_credentials = ${encrypted} where id = ${row.id}`;
      }

      const credentialState: CredentialAuditState = plaintext !== null ? "set" : "unchanged";
      await writeBackendAuditEntry(tx, actor, "create", row.id, null, {
        name: input.name,
        baseUrl: input.baseUrl,
        authKind: input.auth,
        headerName: input.headerName ?? null,
        credentials: credentialState,
      });

      return toRecord(row);
    });

    return record;
  }

  async update(
    id: string,
    input: BackendInput,
    expectedVersion: number,
    actor: Actor | "system",
  ): Promise<BackendRecord> {
    return await this.sql.begin(async (tx) => {
      const [before] = await tx<Row[]>`select * from backends where id = ${id} and deleted_at is null`;
      if (!before) throw new NotFound();

      const hasExistingCredentials = Boolean(before.encrypted_credentials) && before.auth_kind === input.auth;
      const errors = validateBackendInput(input, { hasExistingCredentials });
      if (errors.length > 0) throw new ValidationFailed(errors);

      const nameClash = await tx<Row[]>`
        select id from backends where name = ${input.name} and deleted_at is null and id != ${id}
      `;
      if (nameClash.length > 0) throw new NameTaken();

      const credentialsSupplied = suppliesCredentials(input);
      let encrypted = before.encrypted_credentials;
      let credentialState: CredentialAuditState;
      if (input.auth !== before.auth_kind) {
        const plaintext = credentialsPlaintext(input);
        encrypted = plaintext !== null ? encryptCredentials(plaintext, this.secretKey, id) : null;
        credentialState = plaintext !== null ? "set" : "cleared";
      } else if (credentialsSupplied) {
        const plaintext = credentialsPlaintext(input);
        encrypted = plaintext !== null ? encryptCredentials(plaintext, this.secretKey, id) : null;
        credentialState = "changed";
      } else {
        credentialState = "unchanged";
      }

      const [row] = await tx<Row[]>`
        update backends
        set name = ${input.name},
            base_url = ${input.baseUrl},
            auth_kind = ${input.auth},
            header_name = ${input.headerName ?? null},
            encrypted_credentials = ${encrypted},
            version = version + 1,
            updated_at = now()
        where id = ${id} and version = ${expectedVersion}
        returning *
      `;
      if (!row) throw new StaleVersion();

      await writeBackendAuditEntry(
        tx,
        actor,
        "update",
        id,
        {
          name: before.name,
          baseUrl: before.base_url,
          authKind: before.auth_kind,
          headerName: before.header_name,
          credentials: before.encrypted_credentials ? "unchanged" : "cleared",
        },
        {
          name: input.name,
          baseUrl: input.baseUrl,
          authKind: input.auth,
          headerName: input.headerName ?? null,
          credentials: credentialState,
        },
      );

      return toRecord(row);
    });
  }

  async softDelete(id: string, expectedVersion: number, actor: Actor | "system"): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [before] = await tx<Row[]>`select * from backends where id = ${id} and deleted_at is null`;
      if (!before) throw new NotFound();

      const [row] = await tx<Row[]>`
        update backends
        set deleted_at = now(), version = version + 1
        where id = ${id} and version = ${expectedVersion}
        returning *
      `;
      if (!row) throw new StaleVersion();

      await writeBackendAuditEntry(
        tx,
        actor,
        "soft_delete",
        id,
        {
          name: before.name,
          baseUrl: before.base_url,
          authKind: before.auth_kind,
          headerName: before.header_name,
          credentials: before.encrypted_credentials ? "unchanged" : "cleared",
        },
        null,
      );
    });
  }

  async get(id: string): Promise<BackendRecord | null> {
    const [row] = await this.sql<Row[]>`select * from backends where id = ${id} and deleted_at is null`;
    return row ? toRecord(row) : null;
  }

  async list(): Promise<BackendRecord[]> {
    const rows = await this.sql<Row[]>`select * from backends where deleted_at is null order by name`;
    return rows.map(toRecord);
  }

  /** Decrypts the stored credentials for use by the health monitor. Throws {@link DecryptionFailed} if the row can't be decrypted. */
  async decryptedCredentials(id: string): Promise<{ user?: string; pass?: string; value?: string } | null> {
    const [row] = await this.sql<Row[]>`select * from backends where id = ${id}`;
    if (!row || !row.encrypted_credentials) return null;
    const plaintext = decryptCredentials(row.encrypted_credentials, this.secretKey, id);
    return JSON.parse(plaintext);
  }
}
