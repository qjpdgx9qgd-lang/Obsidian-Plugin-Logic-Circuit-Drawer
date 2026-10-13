import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CircuitData } from '../model/types';
import { branchEdge } from '../model/circuit';
import type { Point } from './geometry';
import { logicalJunctionPin } from './junction-connections';

export interface BranchDrag { edgeId: string; origin: Point; pointer: Point }

export function useBranching(options: {
	circuit: CircuitData;
	editing: boolean;
	toPoint: (point: Point) => Point;
	commit: (circuit: CircuitData) => void;
	error: (message: string) => void;
}) {
	const latest = useRef(options);
	latest.current = options;
	const [branch, setBranch] = useState<BranchDrag | null>(null);
	const branchRef = useRef<BranchDrag | null>(null);
	const gestureDocument = useRef<Document | null>(null);
	const cancel = useCallback(() => { branchRef.current = null; setBranch(null); }, []);
	const start = useCallback((edgeId: string, point: Point, event: ReactPointerEvent) => {
		if (!latest.current.editing) return;
		event.preventDefault(); event.stopPropagation();
		gestureDocument.current = event.currentTarget.ownerDocument;
		const next = { edgeId, origin: point, pointer: point };
		branchRef.current = next; setBranch(next);
	}, []);
	useEffect(() => {
		if (!branch) return;
		const document = gestureDocument.current;
		const window = document?.defaultView;
		if (!document || !window) return;
		const move = (event: PointerEvent) => {
			const current = branchRef.current;
			if (!current) return;
			const next = { ...current, pointer: latest.current.toPoint({ x: event.clientX, y: event.clientY }) };
			branchRef.current = next; setBranch(next);
		};
		const finish = (event: PointerEvent) => {
			const current = branchRef.current;
			if (!current) return;
			const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-circuit-pin]');
			const nodeId = element?.dataset.circuitNode;
			const pin = element?.dataset.circuitPin;
			if (nodeId && pin) {
				try {
					latest.current.commit(branchEdge(latest.current.circuit, current.edgeId, { x: current.origin.x - 8, y: current.origin.y - 8 }, nodeId, logicalJunctionPin(latest.current.circuit, nodeId, pin, 'target')));
				} catch (error) { latest.current.error(error instanceof Error ? error.message : 'Could not create a branch.'); }
			}
			cancel();
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
		return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); };
	// Presence, rather than pointer position, owns the global gesture listeners.
	}, [branch !== null, cancel]);
	useEffect(() => { if (!options.editing) cancel(); }, [options.editing, cancel]);
	return { branch, start, cancel };
}
