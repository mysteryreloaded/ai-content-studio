import { describe, expect, test } from "bun:test";
import path from "node:path";
import { imageDimensions, makeWebpThumbnail } from "./thumbnail.js";

const IMAGE = path.join(import.meta.dir, "fixtures", "tiny.png");

describe("thumbnail", () => {
  test("imageDimensions reads width/height", async () => {
    const dimensions = await imageDimensions(IMAGE);
    expect(dimensions).toEqual({ width: 32, height: 32 });
  });

  test("makeWebpThumbnail produces a readable WebP no larger than the ~480px long side", async () => {
    const thumbnail = await makeWebpThumbnail(IMAGE);
    expect(thumbnail.length).toBeGreaterThan(0);
    const img = new Bun.Image(thumbnail);
    const metadata = await img.metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBeLessThanOrEqual(480);
    expect(metadata.height).toBeLessThanOrEqual(480);
  });
});
