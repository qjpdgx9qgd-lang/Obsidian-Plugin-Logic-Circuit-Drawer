import { serializeCircuit } from '../model/circuit';
import type { CircuitData } from '../model/types';

interface Line { from: number; to: number; next: number; text: string; }
export interface CircuitInsertion { text: string; cursorOffset: number; }

function linesFor(note: string): Line[] {
	const lines: Line[] = [];
	let from = 0;
	while (from < note.length) {
		const newline = note.indexOf('\n', from);
		const next = newline < 0 ? note.length : newline + 1;
		const to = newline < 0 ? note.length : note[newline - 1] === '\r' ? newline - 1 : newline;
		lines.push({ from, to, next, text: note.slice(from, to) });
		from = next;
	}
	if (!lines.length || note.endsWith('\n')) lines.push({ from: note.length, to: note.length, next: note.length, text: '' });
	return lines;
}

function rejectFencedLocation(lines: Line[], offset: number): void {
	let opening: { from: number; character: string; length: number } | null = null;
	for (const line of lines) {
		if (opening) {
			const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line.text)?.[1];
			if (!closing || closing[0] !== opening.character || closing.length < opening.length) continue;
			if (offset > opening.from && offset < line.to) throw new Error('Insert the circuit outside the existing code block.');
			opening = null;
			continue;
		}
		const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
		if (!fence?.[1] || fence[1][0] === '`' && fence[2]?.includes('`')) continue;
		opening = { from: line.from, character: fence[1][0]!, length: fence[1].length };
	}
	if (opening && offset > opening.from) throw new Error('Close the existing code block before inserting a circuit.');
}

/** Produces a standalone insertion at the selection head, without replacing any text. */
export function insertionForCircuit(note: string, offset: number, circuit: CircuitData): CircuitInsertion {
	if (!Number.isInteger(offset) || offset < 0 || offset > note.length) throw new Error('The insertion position is no longer valid.');
	if (note[offset - 1] === '\r' && note[offset] === '\n') throw new Error('Insert the circuit at a complete line boundary.');
	const lines = linesFor(note);
	rejectFencedLocation(lines, offset);
	const current = lines.find((line) => offset >= line.from && offset < line.next) ?? lines[lines.length - 1]!;
	if (/^[ \t]+\S|^[ \t]+$|^[ \t]*(?:>|[-+*][ \t]+|\d+[.)][ \t]+)/.test(current.text)) {
		throw new Error('Insert the circuit on an unindented line outside lists and blockquotes.');
	}
	if (lines[0]?.text === '---') {
		const closing = lines.slice(1).find((line) => /^(?:---|\.\.\.)[ \t]*$/.test(line.text));
		if (!closing || offset < closing.to) throw new Error('Insert the circuit after the note properties.');
	}
	const newline = /\r\n|\n/.exec(note)?.[0] ?? '\n';
	const before = offset > 0 && note[offset - 1] !== '\n' ? newline : '';
	const startsNewline = note[offset] === '\n' || note[offset] === '\r' && note[offset + 1] === '\n';
	const after = offset < note.length && !startsNewline ? newline : '';
	const payload = serializeCircuit(circuit).replace(/\n/g, newline);
	const text = `${before}\`\`\`logic-circuit${newline}${payload}${newline}\`\`\`${after}`;
	return { text, cursorOffset: offset + text.length };
}
