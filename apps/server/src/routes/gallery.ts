// `/api/gallery`: the signed-in user's own Gallery across every Model
// (issue #56) — their Submissions, newest first, filterable by Model
// and state and paged by a (submitted-at, submission id) cursor.

import { Hono } from "hono";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type {
  GalleryStateFilter,
  GenerationsRepository,
} from "../generations/repository.js";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

const STATE_FILTERS: readonly GalleryStateFilter[] = [
  "underway",
  "finished",
  "failed",
];

function isGalleryStateFilter(
  value: string | undefined,
): value is GalleryStateFilter {
  return (
    value !== undefined && (STATE_FILTERS as readonly string[]).includes(value)
  );
}

/** `/api/gallery`: issue #56. */
export function galleryRoute(
  generationsRepository: GenerationsRepository,
  routes: RouteEntry[],
) {
  const basePath = "/api/gallery";

  return new Hono<AppEnv>()
    .get("/", guard(routes, basePath, "get", "/", "active"), async (c) => {
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      const query = c.req.query();
      const modelId = isUuid(query.model) ? query.model : undefined;
      const stateFilter = isGalleryStateFilter(query.state)
        ? query.state
        : undefined;

      const limitParam = Number.parseInt(query.limit ?? "", 10);
      const limit =
        Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(limitParam, MAX_LIMIT)
          : DEFAULT_LIMIT;

      let cursor: { submittedAt: Date; submissionId: string } | undefined;
      if (query.afterSubmittedAt && isUuid(query.afterSubmissionId)) {
        const submittedAt = new Date(query.afterSubmittedAt);
        if (!Number.isNaN(submittedAt.getTime())) {
          cursor = { submittedAt, submissionId: query.afterSubmissionId };
        }
      }

      const { submissions, hasMore } =
        await generationsRepository.listGallerySubmissions({
          userId: session.user.id,
          modelId,
          stateFilter,
          cursor,
          limit,
        });

      return c.json({ submissions, hasMore });
    })
    .get(
      "/models",
      guard(routes, basePath, "get", "/models", "active"),
      async (c) => {
        const session = c.get("session");
        if (!session) return c.json({ error: "unauthorized" }, 401);

        const models = await generationsRepository.listUsedModelsForUser(
          session.user.id,
        );
        return c.json({ models });
      },
    );
}
