// resolveUploadValues against a real Postgres (issue #51, round 3 CEO
// review, point 1): a trimmed Upload's limits are checked by the trim's
// own intended range (trimEndMs - trimStartMs), not its re-encode's
// probed durationMs, which can overshoot that range by a few
// milliseconds (fps rounding, AAC padding) and would otherwise refuse a
// trim to exactly the Input's own maxDurationMs.

import { afterAll, describe, expect, test } from "bun:test";
import type { VideoUploadInputDefinition } from "@ai-content-studio/shared";
import { uploadFileName } from "@ai-content-studio/shared";
import { users } from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { UploadsRepository } from "../uploads/repository.js";
import {
  InvalidUploads,
  type SubmissionDeps,
  resolveUploadValues,
} from "./submission.js";

describe("resolveUploadValues: trimmed video/audio Uploads (issue #51)", () => {
  const testDb = createTestDatabase("resolve_upload_values_test");

  afterAll(async () => {
    await (await testDb).close();
  });

  async function setup() {
    const { db } = await testDb;
    const repository = new UploadsRepository(db);
    const [user] = await db
      .insert(users)
      .values({
        googleSub: crypto.randomUUID(),
        email: `${crypto.randomUUID()}@example.com`,
        name: "Test",
      })
      .returning();
    if (!user) throw new Error("no user");
    const deps = { uploadsRepository: repository } as unknown as SubmissionDeps;
    return { repository, userId: user.id, deps };
  }

  function videoInput(
    overrides: Partial<VideoUploadInputDefinition> = {},
  ): VideoUploadInputDefinition {
    return {
      id: crypto.randomUUID(),
      kind: "video_upload",
      group: "describe",
      label: "Clip",
      help: "",
      maxSizeMb: 50,
      maxLongSide: null,
      minDurationMs: 0,
      maxDurationMs: 500,
      trimmable: true,
      bindings: [],
      ...overrides,
    };
  }

  test("a trim to exactly maxDurationMs is accepted even though its own probed durationMs overshoots it", async () => {
    const { repository, userId, deps } = await setup();
    const input = videoInput({ maxDurationMs: 500 });

    // The re-encode of a [0, 500) trim probes at 600ms (one extra frame
    // at the source's fps) - past 500 if checked naively.
    const trimmed = await repository.createTrimmed({
      id: crypto.randomUUID(),
      userId,
      originalName: "clip.mp4",
      declaredType: "video/mp4",
      size: 1000,
      modelId: null,
      inputId: input.id,
      storageKey: `uploads/${crypto.randomUUID()}/original`,
      kind: "video",
      extension: "mp4",
      contentType: "video/mp4",
      width: 64,
      height: 48,
      durationMs: 600,
      fps: 5,
      probe: {
        formatName: "mov,mp4,m4a,3gp,3g2,mj2",
        codecName: "h264",
        audioCodecName: "aac",
        width: 64,
        height: 48,
        durationMs: 600,
        fps: 5,
        pixFmt: "yuv420p",
        browserPlayable: true,
      },
      thumbnailKey: null,
      trimmedFromId: crypto.randomUUID(),
      trimStartMs: 0,
      trimEndMs: 500,
      createdAt: new Date(),
    });

    const result = await resolveUploadValues(
      [input],
      { [input.id]: trimmed.id },
      userId,
      deps,
    );
    expect(result.values[input.id]).toBe(uploadFileName(trimmed.id, "mp4"));
  });

  test("an untrimmed Upload genuinely over maxDurationMs is still refused", async () => {
    const { repository, userId, deps } = await setup();
    const input = videoInput({ maxDurationMs: 500 });

    const original = await repository.create({
      id: crypto.randomUUID(),
      userId,
      originalName: "clip.mp4",
      declaredType: "video/mp4",
      size: 1000,
      modelId: null,
      inputId: input.id,
      storageKey: `uploads/${crypto.randomUUID()}/original`,
      createdAt: new Date(),
    });
    await repository.markComplete(original.id, {
      kind: "video",
      extension: "mp4",
      contentType: "video/mp4",
      width: 64,
      height: 48,
      durationMs: 600,
      fps: 5,
      probe: {
        formatName: "mov,mp4,m4a,3gp,3g2,mj2",
        codecName: "h264",
        audioCodecName: "aac",
        width: 64,
        height: 48,
        durationMs: 600,
        fps: 5,
        pixFmt: "yuv420p",
        browserPlayable: true,
      },
      thumbnailKey: null,
      completedAt: new Date(),
    });

    await expect(
      resolveUploadValues([input], { [input.id]: original.id }, userId, deps),
    ).rejects.toBeInstanceOf(InvalidUploads);
  });
});
