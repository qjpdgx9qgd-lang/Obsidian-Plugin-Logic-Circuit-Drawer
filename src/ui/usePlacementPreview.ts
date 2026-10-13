import { useEffect, useRef, type RefObject } from 'react';
import type { NodeType } from '../model/types';
import type { Point } from './geometry';
import { PLACEMENT_MIME } from './Toolbar';

export interface PlacementPreview { position: Point; valid: boolean }

/** Follow placement below the current canvas so its bottom can grow before drop. */
export function usePlacementPreview(options: {
	canvas: RefObject<HTMLDivElement | null>;
	tool: NodeType | null;
	editing: boolean;
	toPoint: (point: Point) => Point;
	placement: (point: Point, type: NodeType) => PlacementPreview;
	update: (preview: PlacementPreview | null) => void;
}) {
	const latest = useRef(options);
	latest.current = options;
	useEffect(() => {
		if (!options.editing || !options.tool) return;
		const document = options.canvas.current?.ownerDocument;
		if (!document) return;
		const move = (event: MouseEvent) => {
			const current = latest.current;
			const rect = current.canvas.current?.getBoundingClientRect();
			if (!rect || !current.tool) return;
			if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top) {
				current.update(null); return;
			}
			current.update(current.placement(current.toPoint({ x: event.clientX, y: event.clientY }), current.tool));
		};
		const drag = (event: DragEvent) => {
			if (!event.dataTransfer?.types.includes(PLACEMENT_MIME)) return;
			move(event);
		};
		document.addEventListener('pointermove', move);
		document.addEventListener('dragover', drag);
		return () => { document.removeEventListener('pointermove', move); document.removeEventListener('dragover', drag); };
	}, [options.editing, options.tool, options.canvas]);
}
