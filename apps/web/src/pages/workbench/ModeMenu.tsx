import { cn } from "../../lib/cn.js";
import { MODE_MENU_GROUP_LABELS } from "./modeMenu.js";
import type { WorkbenchMode } from "./types.js";

interface ModeMenuProps {
	modes: WorkbenchMode[];
	selectedModeId: string;
	onSelect: (mode: WorkbenchMode) => void;
}

export function ModeMenu({ modes, selectedModeId, onSelect }: ModeMenuProps) {
	return (
		<div className="mode-menu" role="group" aria-label="Mode">
			{MODE_MENU_GROUP_ORDER.map((group) => {
				const groupModes = modes.filter((mode) => mode.group === group);
				if (groupModes.length === 0) return null;
				return (
					<div key={group} className="mode-menu-group">
						<div className="mode-menu-group-label">{MODE_MENU_GROUP_LABELS[group]}</div>
						{groupModes.map(({ id, label, group, description }) => (
							<button
								key={id}
								type="button"
								className={cn("mode-button", selectedModeId === id ? "mode-button-active" : null)}
								onClick={() => onSelect({ id, label, group, description })}
							>
								{label}
							</button>
						))}
					</div>
				);
			})}
		</div>
	);
}
