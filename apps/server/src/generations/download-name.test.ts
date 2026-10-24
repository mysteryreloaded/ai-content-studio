import { describe, expect, test } from "bun:test";
import { downloadFileName } from "./download-name.js";

const GENERATION_ID = "11111111-2222-3333-4444-555566667777";

describe("downloadFileName", () => {
  test("names a single Asset <model-slug>-<mode-slug>-<last 8 of Generation id>.<ext>", () => {
    const asset = {
      id: "a",
      sortOrder: 0,
      comfyuiFilename: "studio_00001_.png",
    };
    const name = downloadFileName(
      "ltx-2-5",
      "First/Last Frame",
      GENERATION_ID,
      asset,
      [asset],
    );
    expect(name).toBe("ltx-2-5-first-last-frame-66667777.png");
  });

  test("numbers same-extension Assets of one Generation -2, -3, ... by sortOrder", () => {
    const siblings = [
      { id: "a", sortOrder: 0, comfyuiFilename: "studio_00001_.png" },
      { id: "b", sortOrder: 1, comfyuiFilename: "studio_00002_.png" },
      { id: "c", sortOrder: 2, comfyuiFilename: "studio_00003_.png" },
    ];
    expect(
      downloadFileName(
        "m",
        "mode",
        GENERATION_ID,
        siblings[0] as never,
        siblings,
      ),
    ).toBe("m-mode-66667777.png");
    expect(
      downloadFileName(
        "m",
        "mode",
        GENERATION_ID,
        siblings[1] as never,
        siblings,
      ),
    ).toBe("m-mode-66667777-2.png");
    expect(
      downloadFileName(
        "m",
        "mode",
        GENERATION_ID,
        siblings[2] as never,
        siblings,
      ),
    ).toBe("m-mode-66667777-3.png");
  });

  test("tie-breaks same-sortOrder siblings (a batch's outputs) on comfyuiFilename, regardless of input order", () => {
    const siblings = [
      { id: "a", sortOrder: 0, comfyuiFilename: "studio_00002_.png" },
      { id: "b", sortOrder: 0, comfyuiFilename: "studio_00001_.png" },
      { id: "c", sortOrder: 0, comfyuiFilename: "studio_00003_.png" },
    ];
    const reordered = [siblings[2], siblings[0], siblings[1]] as never;

    for (const order of [siblings, reordered]) {
      expect(
        downloadFileName(
          "m",
          "mode",
          GENERATION_ID,
          siblings[1] as never,
          order,
        ),
      ).toBe("m-mode-66667777.png");
      expect(
        downloadFileName(
          "m",
          "mode",
          GENERATION_ID,
          siblings[0] as never,
          order,
        ),
      ).toBe("m-mode-66667777-2.png");
      expect(
        downloadFileName(
          "m",
          "mode",
          GENERATION_ID,
          siblings[2] as never,
          order,
        ),
      ).toBe("m-mode-66667777-3.png");
    }
  });

  test("a different extension never collides with another kind's name", () => {
    const image = {
      id: "a",
      sortOrder: 0,
      comfyuiFilename: "studio_00001_.png",
    };
    const video = {
      id: "b",
      sortOrder: 1,
      comfyuiFilename: "studio_00001_.mp4",
    };
    expect(
      downloadFileName("m", "mode", GENERATION_ID, video, [image, video]),
    ).toBe("m-mode-66667777.mp4");
  });
});
