import type { CircuitData } from './types';
import { parseCircuit, serializeCircuit } from './circuit';

/** Session-local snapshots keep compound junction actions atomic and restore stable IDs. */
export class CircuitHistory {
	private past: string[] = [];
	private future: string[] = [];
	private current: string;
	constructor(initial: CircuitData) { this.current = serializeCircuit(initial); }
	get canUndo(): boolean { return this.past.length > 0; }
	get canRedo(): boolean { return this.future.length > 0; }
	get value(): CircuitData { return parseCircuit(this.current); }
	commit(next: CircuitData): CircuitData {
		const snapshot = serializeCircuit(next);
		if (snapshot !== this.current) {
			this.past.push(this.current);
			this.current = snapshot;
			this.future = [];
		}
		return this.value;
	}
	undo(): CircuitData {
		const previous = this.past.pop();
		if (previous !== undefined) { this.future.push(this.current); this.current = previous; }
		return this.value;
	}
	redo(): CircuitData {
		const next = this.future.pop();
		if (next !== undefined) { this.past.push(this.current); this.current = next; }
		return this.value;
	}
}
