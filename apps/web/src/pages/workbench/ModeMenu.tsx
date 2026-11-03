import { MODE_MENU_GROUP_LABELS, groupModesForMenu } from "./modeMenuGroups.js";
import type { WorkbenchMode } from "./types.js";

export function ModeMenu({
  modes,
  selectedModeId,
  onSelect,
}: {
  modes: WorkbenchMode[];
  selectedModeId: string | null;
  onSelect: (mode: WorkbenchMode) => void;
}) {
  if (modes.length <= 1) {
    return <h2>{modes[0]?.name ?? "Default"}</h2>;
  }
  return (
    <fieldset>
      <legend>Mode</legend>
      {groupModesForMenu(modes).map(({ group, modes: groupModes }) => (
        <fieldset key={group}>
          <legend>{MODE_MENU_GROUP_LABELS[group]}</legend>
          {groupModes.map((mode) => (
            <label key={mode.id} style={{ display: "block" }}>
              <input
                type="radio"
                name="mode"
                value={mode.id}
                checked={selectedModeId === mode.id}
                onChange={() => onSelect(mode)}
              />
              {mode.name}
            </label>
          ))}
        </fieldset>
      ))}
    </fieldset>
  );
}
