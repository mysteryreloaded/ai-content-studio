// Minimal HTTP surface for Backend CRUD + health + history, so the
// repository/monitor are reachable over the wire. Admin-only access isn't
// enforced here: issue #39 is blocked by #36 (Sign in with Google), which
// doesn't exist yet. Wire an admin-session guard in front of this handler
// once #36 lands.

import type postgres from "postgres";
import { NameTaken, NotFound, StaleVersion } from "./repository";
import type { BackendRepository } from "./repository";
import type { BackendsService } from "./service";
import { ValidationFailed } from "./validation";
import type { BackendInput } from "./validation";

export interface BackendsHttpDeps {
  repository: BackendRepository;
  service: BackendsService;
  sql: postgres.Sql;
}

function errorResponse(err: unknown): Response {
  if (err instanceof ValidationFailed) {
    return Response.json({ errors: err.errors }, { status: 400 });
  }
  if (err instanceof NameTaken) {
    return Response.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof StaleVersion) {
    return Response.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof NotFound) {
    return Response.json({ error: err.message }, { status: 404 });
  }
  throw err;
}

export function createBackendsHandler(deps: BackendsHttpDeps): (req: Request) => Promise<Response> {
  const { repository, service, sql } = deps;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);

    try {
      if (segments.length === 1 && segments[0] === "backends") {
        if (req.method === "GET") {
          const backends = await repository.list();
          return Response.json({
            backends,
            disabledBanner: service.disabledBanner,
          });
        }
        if (req.method === "POST") {
          const input = (await req.json()) as BackendInput;
          const record = await repository.create(input, "system");
          service.watch(record);
          return Response.json(record, { status: 201 });
        }
      }

      if (segments.length === 2 && segments[0] === "backends") {
        const id = segments[1] as string;

        if (req.method === "GET") {
          const record = await repository.get(id);
          if (!record) return Response.json({ error: "not found" }, { status: 404 });
          return Response.json({ ...record, health: service.healthFor(id) });
        }

        if (req.method === "PUT") {
          const body = (await req.json()) as BackendInput & { version: number };
          const record = await repository.update(id, body, body.version, "system");
          service.unwatch(id);
          service.watch(record);
          return Response.json(record);
        }

        if (req.method === "DELETE") {
          const version = Number(url.searchParams.get("version"));
          await repository.softDelete(id, version, "system");
          service.unwatch(id);
          return new Response(null, { status: 204 });
        }
      }

      if (segments.length === 3 && segments[0] === "backends" && segments[2] === "history") {
        const id = segments[1] as string;
        const entries = await sql`
          select * from audit_entries where target = ${`backend:${id}`} order by created_at desc
        `;
        return Response.json({ entries });
      }

      return new Response("not found", { status: 404 });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
