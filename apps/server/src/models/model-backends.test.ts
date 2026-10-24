import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import { BackendRepository } from "../backends/repository.js";
import {
  auditEntries,
  backends,
  modelRevisions,
  models,
  workflows,
} from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { ModelBackendsRepository, NotFound } from "./model-backends.js";
import { ModelRepository } from "./repository.js";

const SYSTEM: AuditActor = { type: "system" };
const SECRET_KEY = "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=";

const VALID_WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
};

describe("ModelBackendsRepository", () => {
  const testDb = createTestDatabase("model_backends_repository_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
    await db.delete(backends);
  });

  async function setup() {
    const { db } = await testDb;
    const repository = new ModelBackendsRepository(db, clock);
    const models_ = new ModelRepository(db, clock);
    const backends_ = new BackendRepository(db, clock, SECRET_KEY);
    return { repository, models_, backends_, db };
  }

  test("attaches and detaches a Backend, writing Audit entries on the Model", async () => {
    const { repository, models_, backends_, db } = await setup();
    const { record: model } = await models_.createFromWorkflow(
      "M1",
      VALID_WORKFLOW,
      SYSTEM,
    );
    const backend = await backends_.create(
      { name: "B1", baseUrl: "http://localhost:9", auth: "none" },
      SYSTEM,
    );

    await repository.attach(model.id, backend.id, SYSTEM);
    expect((await repository.listForModel(model.id)).map((b) => b.id)).toEqual([
      backend.id,
    ]);

    await repository.detach(model.id, backend.id, SYSTEM);
    expect(await repository.listForModel(model.id)).toEqual([]);

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, model.id));
    expect(entries.some((e) => e.action === "attach_backend")).toBe(true);
    expect(entries.some((e) => e.action === "detach_backend")).toBe(true);
  });

  test("attaching the same Backend twice is a no-op, not a duplicate row or Audit entry", async () => {
    const { repository, models_, backends_, db } = await setup();
    const { record: model } = await models_.createFromWorkflow(
      "M1",
      VALID_WORKFLOW,
      SYSTEM,
    );
    const backend = await backends_.create(
      { name: "B1", baseUrl: "http://localhost:9", auth: "none" },
      SYSTEM,
    );

    await repository.attach(model.id, backend.id, SYSTEM);
    await repository.attach(model.id, backend.id, SYSTEM);

    expect(await repository.listForModel(model.id)).toHaveLength(1);
    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, model.id));
    expect(entries.filter((e) => e.action === "attach_backend")).toHaveLength(
      1,
    );
  });

  test("detaching a Backend that isn't attached is a no-op", async () => {
    const { repository, models_, backends_ } = await setup();
    const { record: model } = await models_.createFromWorkflow(
      "M1",
      VALID_WORKFLOW,
      SYSTEM,
    );
    const backend = await backends_.create(
      { name: "B1", baseUrl: "http://localhost:9", auth: "none" },
      SYSTEM,
    );

    await expect(
      repository.detach(model.id, backend.id, SYSTEM),
    ).resolves.toBeUndefined();
  });

  test("refuses to attach a Backend to a missing Model", async () => {
    const { repository, backends_ } = await setup();
    const backend = await backends_.create(
      { name: "B1", baseUrl: "http://localhost:9", auth: "none" },
      SYSTEM,
    );

    await expect(
      repository.attach(
        "00000000-0000-0000-0000-000000000000",
        backend.id,
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });

  test("refuses to attach a missing Backend to a Model", async () => {
    const { repository, models_ } = await setup();
    const { record: model } = await models_.createFromWorkflow(
      "M1",
      VALID_WORKFLOW,
      SYSTEM,
    );

    await expect(
      repository.attach(
        model.id,
        "00000000-0000-0000-0000-000000000000",
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });
});
