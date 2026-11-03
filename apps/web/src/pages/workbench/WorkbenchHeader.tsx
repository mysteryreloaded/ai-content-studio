import type { WorkbenchModel } from "./types.js";

interface WorkbenchHeaderProps {
	model: WorkbenchModel;
	reuseNotice: string | null;
	onShowTerms: () => void;
}

export function WorkbenchHeader({ model, reuseNotice, onShowTerms }: WorkbenchHeaderProps) {
	return (
		<header className="workbench-header">
			<div className="workbench-header-row">
				<h1 className="page-title">{model.name}</h1>
				<button type="button" className="button button-secondary" onClick={onShowTerms}>
					Show model terms
				</button>
			</div>
			{reuseNotice ? (
				<div className="notice-box notice-box-accent">{reuseNotice}</div>
			) : null}
		</header>
	);
}
