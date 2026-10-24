// parseVideoProbeOutput's rotation handling (issue #52 CEO review round
// 2 point 5): an Android portrait MP4 stores its frame sideways (e.g.
// 1920x1080) and asks every player to rotate it 90°/-90° before
// display, so the width/height a browser and ComfyUI actually show are
// swapped from what the stream itself stores. Pure, synthetic ffprobe
// JSON - no real ffmpeg/ffprobe needed to exercise the parsing.

import { describe, expect, test } from "bun:test";
import { parseVideoProbeOutput } from "./probe.js";

function stdoutFor(stream: Record<string, unknown>): string {
  return JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        r_frame_rate: "30/1",
        avg_frame_rate: "30/1",
        ...stream,
      },
    ],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5.0" },
  });
}

describe("parseVideoProbeOutput: rotation (issue #52)", () => {
  test("a -90 rotation (modern side_data_list Display Matrix) swaps width/height", () => {
    const probe = parseVideoProbeOutput(
      stdoutFor({ side_data_list: [{ rotation: -90 }] }),
      "mp4",
    );
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video") throw new Error("expected video");
    expect(probe.facts.width).toBe(1080);
    expect(probe.facts.height).toBe(1920);
  });

  test("a 90 rotation (legacy tags.rotate) swaps width/height", () => {
    const probe = parseVideoProbeOutput(
      stdoutFor({ tags: { rotate: "90" } }),
      "mp4",
    );
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video") throw new Error("expected video");
    expect(probe.facts.width).toBe(1080);
    expect(probe.facts.height).toBe(1920);
  });

  test("side_data_list wins over tags.rotate when both are present", () => {
    const probe = parseVideoProbeOutput(
      stdoutFor({
        tags: { rotate: "0" },
        side_data_list: [{ rotation: 270 }],
      }),
      "mp4",
    );
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video") throw new Error("expected video");
    expect(probe.facts.width).toBe(1080);
    expect(probe.facts.height).toBe(1920);
  });

  test("a 180 rotation leaves width/height as stored", () => {
    const probe = parseVideoProbeOutput(
      stdoutFor({ side_data_list: [{ rotation: 180 }] }),
      "mp4",
    );
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video") throw new Error("expected video");
    expect(probe.facts.width).toBe(1920);
    expect(probe.facts.height).toBe(1080);
  });

  test("no rotation metadata leaves width/height as stored", () => {
    const probe = parseVideoProbeOutput(stdoutFor({}), "mp4");
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video") throw new Error("expected video");
    expect(probe.facts.width).toBe(1920);
    expect(probe.facts.height).toBe(1080);
  });
});
