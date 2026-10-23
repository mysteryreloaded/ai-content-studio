-- Backends, their Log entries and the Audit entries their saves write.
--
-- Audit entries are expected to be defined once by issue #37 (Site settings
-- branding, with Audit entries) as a shared, append-only table used by every
-- admin-controlled save. Issue #39 is blocked by #37, which isn't built yet,
-- so this migration creates a minimal audit_entries table shaped the way
-- ADR 0005 describes, to be reconciled with #37's table when it lands
-- (whichever migration merges second should drop its duplicate and point at
-- the other).

create table if not exists backends (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  auth_kind text not null check (auth_kind in ('none', 'basic', 'header')),
  -- Credentials are AES-256-GCM encrypted with the Backend id as associated
  -- data (see credentials.ts); null when auth_kind = 'none'.
  encrypted_credentials bytea,
  header_name text,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists backends_name_unique
  on backends (name)
  where deleted_at is null;

create table if not exists log_entries (
  id bigint generated always as identity primary key,
  level text not null check (level in ('error', 'warning', 'info')),
  message text not null,
  details text,
  backend_id uuid references backends (id) on delete set null,
  created_at timestamptz not null
);

create index if not exists log_entries_backend_id_idx on log_entries (backend_id);
create index if not exists log_entries_created_at_idx on log_entries (created_at);

create table if not exists audit_entries (
  id bigint generated always as identity primary key,
  actor text not null,
  target text not null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_entries_target_idx on audit_entries (target);

create or replace function audit_entries_no_update_or_delete()
returns trigger as $$
begin
  raise exception 'audit_entries is append-only';
end;
$$ language plpgsql;

drop trigger if exists audit_entries_append_only on audit_entries;
create trigger audit_entries_append_only
  before update or delete on audit_entries
  for each row execute function audit_entries_no_update_or_delete();
