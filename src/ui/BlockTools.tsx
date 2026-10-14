import type { DragEvent as ReactDragEvent } from 'react';
import { AccessibleButton } from './accessibility';

export interface CircuitBlockActions {
	remove: () => Promise<void>;
	menu: (event: MouseEvent, remove: () => void, onClose?: () => void) => void;
	move?: (event: DragEvent) => void;
	cancelMove?: () => void;
	beforeResize?: (dragging: boolean) => void;
	afterResize?: () => void;
}

export function BlockTools({ actions, selected, select, disabled }: {
	actions?: CircuitBlockActions;
	selected: boolean;
	select: () => void;
	disabled: boolean;
}) {
	if (!actions?.move) return null;
	const drag = (event: ReactDragEvent) => {
		event.stopPropagation();
		if (!actions.move || disabled) { event.preventDefault(); return; }
		select(); actions.move(event.nativeEvent);
	};
	return <div className="logic-block-tools">
		<AccessibleButton type="button" className="logic-block-grip" label="Move circuit block" aria-pressed={selected} title="Move" draggable={!disabled} disabled={disabled} onClick={select} onDragStart={drag} onDragEnd={() => actions.cancelMove?.()}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{[6,12,18].flatMap(y => [8,16].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}</svg>
		</AccessibleButton>
	</div>;
}
