import type { InputDefinition } from "@ai-content-studio/shared";
import { cn } from "cn";

/**
 * The prototype's type colours (issue #213): each Input kind maps onto
 * one of the `--t-*` tokens added to index.css. Text and Points share
 * "string"; Seed is "int"; Number is "float"; Select is "combo".
 */
export type TypeDotKind =
  | "image"
  | "video"
  | "audio"
  | "string"
  | "int"
  | "float"
  | "bool"
  | "combo";

export function typeDotKindFor(kind: InputDefinition["kind"]): TypeDotKind {
  switch (kind) {
    case "image_upload":
      return "image";
    case "video_upload":
      return "video";
    case "audio_upload":
      return "audio";
    case "text":
    case "points":
      return "string";
    case "seed":
      return "int";
    case "number":
      return "float";
    case "select":
      return "combo";
    default:
      return "string";
  }
}

const CLASS_BY_KIND: Record<TypeDotKind, string> = {
  image: "bg-t-image",
  video: "bg-t-video",
  audio: "bg-t-audio",
  string: "bg-t-string",
  int: "bg-t-int",
  float: "bg-t-float",
  bool: "bg-t-bool",
  combo: "bg-t-combo",
};

/** An 8px dot, the prototype's `.dot` — one per Input kind. */
export function TypeDot({
  kind,
  className,
}: {
  kind: TypeDotKind;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        CLASS_BY_KIND[kind],
        className,
      )}
    />
  );
}
