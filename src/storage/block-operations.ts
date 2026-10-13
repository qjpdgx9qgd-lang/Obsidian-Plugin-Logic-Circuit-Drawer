import { BlockConflictError, scanCircuitBlocks } from './blocks';
import type { LogicBlock } from './blocks';

/** The complete fence is guarded, including malformed or unsupported payloads. */
export interface StructuralBlockBaseline {
	circuitId: string | null;
	content: string;
	from: number;
	raw: string;
	identityText?: string;
}
export interface BlockTextChange { from: number; to: number; text: string; }
export interface BlockOperationResult {
	text: string;
	changes: BlockTextChange[];
	block?: LogicBlock;
	/** Caret offset in the resulting document, applied with the same text transaction. */
	cursorOffset?: number;
}
/** Offsets are valid only against the note observed while choosing the drop position. */
export interface BlockMoveTarget { offset: number; noteText: string; }

export function structuralBaseline(text: string, block: LogicBlock): StructuralBlockBaseline {
	const raw = text.slice(block.from, block.to);
	const candidates = scanCircuitBlocks(text).filter((item) => block.circuitId === null
		? text.slice(item.from, item.to) === raw : item.circuitId === block.circuitId);
	return { circuitId: block.circuitId, content: block.content, from: block.from, raw,
		...(candidates.length > 1 ? { identityText: text } : {}) };
}

function locate(text: string, baseline: StructuralBlockBaseline): LogicBlock {
	if (baseline.identityText !== undefined && baseline.identityText !== text) {
		throw new BlockConflictError('The note changed while identifying a copied circuit block. Select the block again.');
	}
	const candidates = scanCircuitBlocks(text).filter((block) => baseline.circuitId === null
		? text.slice(block.from, block.to) === baseline.raw : block.circuitId === baseline.circuitId);
	if (!candidates.length) throw new BlockConflictError('This circuit block was removed or changed in the note.');
	if (candidates.length > 1 && baseline.identityText !== text) {
		throw new BlockConflictError('Copied circuit blocks cannot be distinguished safely. Select the block again.');
	}
	const block = candidates.length === 1 ? candidates[0] : candidates.find((item) => item.from === baseline.from);
	if (!block || block.content !== baseline.content || text.slice(block.from, block.to) !== baseline.raw) {
		throw new BlockConflictError('This circuit block changed in the note. Select it again before changing it.');
	}
	return block;
}

/** Delete precisely the fenced block. Surrounding whitespace belongs to the note. */
export function deleteCircuitBlock(text: string, baseline: StructuralBlockBaseline): BlockOperationResult {
	const block = locate(text, baseline);
	return { text: text.slice(0, block.from) + text.slice(block.to),
		changes: [{ from: block.from, to: block.to, text: '' }], cursorOffset: block.from };
}

/** Add one blank line next to a guarded fence without modifying its original bytes. */
export function insertCircuitBlockLine(text: string, baseline: StructuralBlockBaseline, side: 'before' | 'after'): BlockOperationResult {
	const block = locate(text, baseline);
	const ending = text.startsWith('\r\n', block.to) ? '\r\n' : text[block.to] === '\n' ? '\n' : '';
	const newline = ending || /\r\n|\n/.exec(baseline.raw)?.[0] || /\r\n|\n/.exec(text)?.[0] || '\n';
	const offset = side === 'before' ? block.from : block.to + ending.length;
	const updated = text.slice(0, offset) + newline + text.slice(offset);
	const from = block.from + (side === 'before' ? newline.length : 0);
	const next = scanCircuitBlocks(updated).find((item) => item.from === from);
	if (!next || updated.slice(next.from, next.to) !== baseline.raw) throw new BlockConflictError('This circuit block cannot be located safely.');
	return { text: updated, changes: [{ from: offset, to: offset, text: newline }], block: next,
		cursorOffset: side === 'after' && !ending ? offset + newline.length : offset };
}

interface Line { from: number; to: number; text: string; }
function linesFor(text: string): Line[] {
	const lines: Line[] = [];
	let from = 0;
	for (const value of text.split('\n')) {
		const line = value.endsWith('\r') ? value.slice(0, -1) : value;
		lines.push({ from, to: from + line.length, text: line });
		from += value.length + 1;
	}
	return lines;
}

/** A moved fence may only land at an unindented, root Markdown line boundary. */
export function validateBlockMoveTarget(text: string, offset: number): void {
	if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
		throw new BlockConflictError('The block drop position is no longer valid.');
	}
	const lines = linesFor(text);
	const current = lines.find((line) => line.from === offset);
	if (!current && offset !== text.length) throw new BlockConflictError('Drop the circuit between complete lines.');
	if (current && /^[ \t]+|^(?:>|[-+*][ \t]+|\d+[.)][ \t]+)/.test(current.text)) {
		throw new BlockConflictError('Drop the circuit on an unindented line outside lists and blockquotes.');
	}
	let metadata = /^\uFEFF?---[ \t]*$/.test(lines[0]?.text ?? '');
	let opening: { from: number; character: string; length: number } | undefined;
	for (const [index, line] of lines.entries()) {
		if (metadata) {
			if (index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line.text)) {
				if (offset < line.to) throw new BlockConflictError('Drop the circuit after the note properties.');
				metadata = false;
			}
			continue;
		}
		if (opening) {
			const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line.text)?.[1];
			if (!closing || closing[0] !== opening.character || closing.length < opening.length) continue;
			if (offset > opening.from && offset < line.to) {
				throw new BlockConflictError('Drop the circuit outside the existing code block.');
			}
			opening = undefined;
			continue;
		}
		const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
		if (!fence?.[1] || fence[1][0] === '`' && fence[2]?.includes('`')) continue;
		opening = { from: line.from, character: fence[1][0]!, length: fence[1].length };
	}
	if (metadata) throw new BlockConflictError('Close the note properties before moving the circuit.');
	if (opening && offset > opening.from) throw new BlockConflictError('Drop the circuit outside the unclosed code block.');
}

/** Move original bytes in one transaction; never reserialize a circuit as a side effect. */
export function moveCircuitBlock(text: string, baseline: StructuralBlockBaseline, target: BlockMoveTarget): BlockOperationResult {
	if (target.noteText !== text) {
		throw new BlockConflictError('The note changed while choosing the drop position. Drag the circuit again.');
	}
	const block = locate(text, baseline);
	const ending = text.startsWith('\r\n', block.to) ? '\r\n' : text[block.to] === '\n' ? '\n' : '';
	const sourceTo = block.to + ending.length;
	if (Number.isInteger(target.offset) && target.offset >= block.from && target.offset <= sourceTo) return { text, changes: [], block };
	validateBlockMoveTarget(text, target.offset);
	const newline = ending || /\r\n|\n/.exec(baseline.raw)?.[0] || /\r\n|\n/.exec(text)?.[0] || '\n';
	// Relocate complete lines, preserving existing empty lines at both slots.
	// EOF after unterminated prose needs one line ending before the opening fence.
	const prefix = target.offset > 0 && text[target.offset - 1] !== '\n' ? newline : '';
	const insertion = prefix + baseline.raw + newline;
	const changes: BlockTextChange[] = [
		{ from: block.from, to: sourceTo, text: '' },
		{ from: target.offset, to: target.offset, text: insertion },
	].sort((first, second) => first.from - second.from);
	let updated = text;
	for (const change of [...changes].reverse()) {
		updated = updated.slice(0, change.from) + change.text + updated.slice(change.to);
	}
	const from = target.offset + prefix.length - (target.offset > sourceTo ? sourceTo - block.from : 0);
	const moved = scanCircuitBlocks(updated).find((item) => item.from === from);
	if (!moved || updated.slice(moved.from, moved.to) !== baseline.raw) {
		throw new BlockConflictError('The circuit cannot be moved safely to this position.');
	}
	return { text: updated, changes, block: moved };
}
