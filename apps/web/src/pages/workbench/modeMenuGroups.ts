import type { ModeMenuGroup, WorkbenchMode } from "./types.js";

/** The Workbench Mode menu's group headings (issue #48), by what a Mode's Uploads ask the user to start from. */
export const MODE_MENU_GROUP_LABELS: Record<ModeMenuGroup, string> = {
  prompt: "From a prompt",
  images: "From images",
  audio: "With your audio",
  video: "From a video",
};
const MODE_MENU_GROUP_ORDER: ModeMenuGroup[] = [
  "prompt",
  "images",
  "audio",
  "video",
];

/** Groups `modes` under their Mode menu heading, in a fixed order, dropping empty groups. */
export function groupModesForMenu(
  modes: WorkbenchMode[],
): Array<{ group: ModeMenuGroup; modes: WorkbenchMode[] }> {
  return MODE_MENU_GROUP_ORDER.map((group) => ({
    group,
    modes: modes.filter((mode) => mode.menuGroup === group),
  })).filter((entry) => entry.modes.length > 0);
}
