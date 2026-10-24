// resolveUploadValues against a real Postgres (issue #51, round 3 CEO
// review, point 1): a trimmed Upload's limits are checked by the trim's
// own intended range (trimEndMs - trimStartMs), not its re-encode's
// probed durationMs, which can overshoot that range by a few
// milliseconds (fps rounding, AAC padding) and would otherwise refuse a
// trim to exactly the Input's own maxDurationMs.

import { afterAll, describe, expect, test } from "bun:test";
import type {
  ImageUploadInputDefinition,
  InputDefinition,
  NumberInputDefinition,
  PointsInputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
import { systemClock, uploadFileName } from "@ai-content-studio/shared";
import { users } from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { UploadsRepository } from "../uploads/repository.js";
import {
  InvalidUploads,
  type SubmissionDeps,
  resolvePointsFrameSizes,
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

  // CEO review round 1, point 4: `submission.ts` used to accept a
  // removed Upload (its file deleted, `status` left "complete") and
  // resubmit it, instead of refusing it the same way a missing Upload
  // is refused.
  test("a removed Upload is refused, not resubmitted (issue #68's AC)", async () => {
    const { repository, userId, deps } = await setup();
    const input: ImageUploadInputDefinition = {
      id: crypto.randomUUID(),
      kind: "image_upload",
      group: "describe",
      label: "Image",
      help: "",
      maxSizeMb: 50,
      maxLongSide: null,
      bindings: [],
    };

    const upload = await repository.create({
      id: crypto.randomUUID(),
      userId,
      originalName: "photo.png",
      declaredType: "image/png",
      size: 1000,
      modelId: null,
      inputId: input.id,
      storageKey: `uploads/${crypto.randomUUID()}/original`,
      createdAt: new Date(),
    });
    await repository.markComplete(upload.id, {
      kind: "image",
      extension: "png",
      contentType: "image/png",
      width: 64,
      height: 48,
      durationMs: null,
      fps: null,
      probe: {
        formatName: "png",
        codecName: "png",
        width: 64,
        height: 48,
        pixFmt: "rgba",
      },
      thumbnailKey: null,
      completedAt: new Date(),
    });
    await repository.markRemoved(
      upload.id,
      userId,
      "Reported content",
      { type: "system" },
      systemClock,
      new Date(),
    );

    await expect(
      resolveUploadValues([input], { [input.id]: upload.id }, userId, deps),
    ).rejects.toBeInstanceOf(InvalidUploads);
  });
});

describe("resolvePointsFrameSizes (issue #52, CEO review round 2 point 3)", () => {
  const testDb = createTestDatabase("resolve_points_frame_sizes_test");

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

  const videoInputId = "11111111-1111-4111-8111-111111111111";
  const widthInputId = "22222222-2222-4222-8222-222222222222";
  const pointsInputId = "33333333-3333-4333-8333-333333333333";

  const videoInput: VideoUploadInputDefinition = {
    id: videoInputId,
    kind: "video_upload",
    group: "describe",
    label: "Clip",
    help: "",
    maxSizeMb: 50,
    maxLongSide: null,
    minDurationMs: 0,
    maxDurationMs: 10_000,
    trimmable: true,
    bindings: [
      { nodeId: "1", field: "video", classType: "VHS_LoadVideo", title: null },
    ],
  };
  // A width bound to a Number Input, same as a Mode that lets most
  // Modes pick their own size but fixes it on this one.
  const widthInput: NumberInputDefinition = {
    id: widthInputId,
    kind: "number",
    group: "settings",
    label: "Width",
    help: "",
    numberMode: "integer",
    min: 1,
    max: 2000,
    step: 1,
    default: 50,
    bindings: [
      {
        nodeId: "2",
        field: "width",
        classType: "EmptyLatentImage",
        title: null,
      },
    ],
  };
  const pointsInput: PointsInputDefinition = {
    id: pointsInputId,
    kind: "points",
    group: "describe",
    label: "Who to replace",
    help: "",
    videoInputId,
    widthField: { nodeId: "2", field: "width" },
    heightField: { nodeId: "2", field: "height" },
    bindings: [
      { nodeId: "3", field: "points", classType: "PointsEditor", title: null },
    ],
  };

  const workflowForMode = {
    "1": { class_type: "VHS_LoadVideo", inputs: { video: "example.mp4" } },
    // `applyModeFixedValues` already baked the Mode's fixed Width (200)
    // into this literal before `resolvePointsFrameSizes` ever runs.
    "2": {
      class_type: "EmptyLatentImage",
      inputs: { width: 200, height: 50 },
    },
    "3": { class_type: "PointsEditor", inputs: { points: "" } },
  };

  async function uploadedVideo(repository: UploadsRepository, userId: string) {
    return repository.createTrimmed({
      id: crypto.randomUUID(),
      userId,
      originalName: "clip.mp4",
      declaredType: "video/mp4",
      size: 1000,
      modelId: null,
      inputId: videoInputId,
      storageKey: `uploads/${crypto.randomUUID()}/original`,
      kind: "video",
      extension: "mp4",
      contentType: "video/mp4",
      width: 100,
      height: 50,
      durationMs: 1000,
      fps: 30,
      probe: {
        formatName: "mov,mp4,m4a,3gp,3g2,mj2",
        codecName: "h264",
        audioCodecName: "aac",
        width: 100,
        height: 50,
        durationMs: 1000,
        fps: 30,
        pixFmt: "yuv420p",
        browserPlayable: true,
      },
      thumbnailKey: null,
      trimmedFromId: crypto.randomUUID(),
      trimStartMs: 0,
      trimEndMs: 1000,
      createdAt: new Date(),
    });
  }

  // A point at (0.1, 0.5) of a 100x50 frame (px 10, 25): inside the crop
  // for a 200x50 target (height crop only, top 12, so y in [12,38], x
  // unrestricted), but outside the crop for Width's own 50x50 default
  // (width crop to x in [25,75]).
  const pointOnlyValidAtFixedWidth = [{ x: 0.1, y: 0.5 }];

  test("without merging fixedValues in, Width resolves to the Number Input's own default, wrongly refusing a point valid at the Mode's fixed Width", async () => {
    const { repository, userId, deps } = await setup();
    const upload = await uploadedVideo(repository, userId);

    const inputs: InputDefinition[] = [videoInput, widthInput, pointsInput];
    const valuesWithoutFixedMerged = {
      [videoInputId]: upload.id,
      [pointsInputId]: JSON.stringify(pointOnlyValidAtFixedWidth),
      // widthInputId deliberately left out, as `parsedValues.data` would
      // leave it (it's fixed, so it's never in `formInputs`/the schema).
    };

    await expect(
      resolvePointsFrameSizes(
        inputs,
        workflowForMode,
        valuesWithoutFixedMerged,
        userId,
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidUploads);
  });

  test("merging fixedValues in resolves Width to the Mode's own fixed value, accepting the same point", async () => {
    const { repository, userId, deps } = await setup();
    const upload = await uploadedVideo(repository, userId);

    const inputs: InputDefinition[] = [videoInput, widthInput, pointsInput];
    const valuesWithFixedMerged = {
      [videoInputId]: upload.id,
      [pointsInputId]: JSON.stringify(pointOnlyValidAtFixedWidth),
      // The fix: submission.ts merges `fixedValues` (here, { [widthInputId]: 200 }) in.
      [widthInputId]: 200,
    };

    const frameSizes = await resolvePointsFrameSizes(
      inputs,
      workflowForMode,
      valuesWithFixedMerged,
      userId,
      deps,
    );
    expect(frameSizes[pointsInputId]).toEqual({ width: 100, height: 50 });
  });
});
