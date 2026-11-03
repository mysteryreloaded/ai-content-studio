import type { InputDefinition } from "@ai-content-studio/shared";

/** The eight Input types, in the agreed order (issue #215's New Input menu and the sheet's Type select). */
export const INPUT_TYPE_OPTIONS: {
  kind: InputDefinition["kind"];
  label: string;
}[] = [
  { kind: "text", label: "Text" },
  { kind: "number", label: "Number" },
  { kind: "seed", label: "Seed" },
  { kind: "select", label: "Select" },
  { kind: "image_upload", label: "Image Upload" },
  { kind: "video_upload", label: "Video Upload" },
  { kind: "audio_upload", label: "Audio Upload" },
  { kind: "points", label: "Points on a frame" },
];
