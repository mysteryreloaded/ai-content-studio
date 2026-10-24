// Content-addressing a Workflow (issue #40): SHA-256 of its canonical JSON.

import { createHash } from "node:crypto";
import { canonicalizeWorkflow } from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";

export function hashWorkflow(workflow: Workflow): string {
  return createHash("sha256")
    .update(canonicalizeWorkflow(workflow))
    .digest("hex");
}
