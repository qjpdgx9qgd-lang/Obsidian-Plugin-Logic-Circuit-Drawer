import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { DecorationSet, EditorView } from '@codemirror/view';

interface CircuitRange { from: number; to: number; }
type Direction = 'backward' | 'forward';
export type BoundaryDeletion = { kind: 'delete'; from: number; to: number; anchor: number } | { kind: 'protect' };

/** Delete blank lines beside a rendered fence without entering its hidden source. */
export function circuitBoundaryDeletion(text: string, circuits: readonly CircuitRange[], position: number, direction: Direction): BoundaryDeletion | null {
	for (const circuit of circuits) {
		// CodeMirror normally leaves the caret at the end of the hidden closing
		// fence after deleting its following blank line. Another Backspace would
		// then expand through the atomic range and delete the entire circuit.
		if (direction === 'backward' && position === circuit.to) return { kind: 'protect' };
		if (direction === 'forward' && position === circuit.from) return { kind: 'protect' };
		if ((direction === 'backward' && position === circuit.to + 1)
			|| (direction === 'forward' && position === circuit.to)) {
			const newline = circuit.to;
			if (text[newline] !== '\n') return direction === 'forward' ? { kind: 'protect' } : null;
			const after = newline + 1;
			if (after < text.length && text[after] !== '\n') return { kind: 'protect' };
			// Keep the required fence separator and place the caret in the next
			// actual Markdown line when one remains, rather than in the fence.
			return { kind: 'delete', from: newline, to: after, anchor: text[after] === '\n' ? after : newline };
		}
		if ((direction === 'backward' && position === circuit.from)
			|| (direction === 'forward' && position === circuit.from - 1)) {
			const newline = circuit.from - 1;
			if (text[newline] !== '\n') return { kind: 'protect' };
			if (newline > 0 && text[newline - 1] !== '\n') return { kind: 'protect' };
			return { kind: 'delete', from: newline, to: circuit.from, anchor: newline };
		}
	}
	return null;
}

export function circuitBoundaryDeleteExtension(decorations: (view: EditorView) => DecorationSet) {
	const remove = (direction: Direction) => (view: EditorView): boolean => {
		const { state } = view;
		// Explicit text selections can delete a complete circuit, and source
		// mode has no circuit decorations. Both retain normal editor behavior.
		if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
		const circuits: CircuitRange[] = [];
		decorations(view).between(0, state.doc.length, (from, to) => { circuits.push({ from, to }); });
		if (!circuits.length) return false;
		const deletion = circuitBoundaryDeletion(state.doc.toString(), circuits, state.selection.main.head, direction);
		if (!deletion) return false;
		if (deletion.kind === 'delete') view.dispatch({
			changes: { from: deletion.from, to: deletion.to },
			selection: { anchor: deletion.anchor },
			userEvent: `delete.${direction}`,
			scrollIntoView: true,
		});
		return true;
	};
	const backward = remove('backward');
	const forward = remove('forward');
	return Prec.highest(keymap.of([
		{ key: 'Backspace', run: backward, shift: backward },
		{ key: 'Delete', run: forward, shift: forward },
	]));
}
