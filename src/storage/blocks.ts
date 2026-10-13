import { serializeCircuit } from '../model/circuit';
import type { CircuitData } from '../model/types';

export interface LogicBlock {
	from: number;
	to: number;
	contentFrom: number;
	contentTo: number;
	content: string;
	circuitId: string | null;
	startLine: number;
	endLine: number;
}

export interface BlockBaseline { circuitId: string; content: string; from?: number }

export class BlockConflictError extends Error {
	constructor(message: string) { super(message); this.name = 'BlockConflictError'; }
}

interface Line { from: number; to: number; next: number; text: string; index: number }

function lines(text: string): Line[] {
	const result: Line[] = [];
	let from = 0;
	let index = 0;
	while (from < text.length) {
		const newline = text.indexOf('\n', from);
		const next = newline < 0 ? text.length : newline + 1;
		const to = newline < 0 ? text.length : text[newline - 1] === '\r' ? newline - 1 : newline;
		result.push({ from, to, next, text: text.slice(from, to), index: index++ });
		from = next;
	}
	return result;
}

function circuitId(content: string): string | null {
	try {
		const parsed = JSON.parse(content) as unknown;
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const value = (parsed as Record<string, unknown>).circuitId;
			if (typeof value === 'string' && value.trim()) return value;
		}
	} catch { /* Malformed blocks still render an error without altering their source. */ }
	return null;
}

/** Scan root fences, ignoring metadata and apparent circuit fences inside other fences. */
export function scanCircuitBlocks(text: string): LogicBlock[] {
	const result: LogicBlock[] = [];
	let opening: { line: Line; character: string; length: number; logic: boolean } | null = null;
	let metadata = false;
	for (const line of lines(text)) {
		if (line.index === 0 && /^\uFEFF?---[ \t]*$/.test(line.text)) {
			metadata = true;
			continue;
		}
		if (metadata) {
			if (/^(?:---|\.\.\.)[ \t]*$/.test(line.text)) metadata = false;
			continue;
		}
		if (opening) {
			const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line.text);
			if (closing?.[1]?.[0] !== opening.character || (closing[1]?.length ?? 0) < opening.length) continue;
			if (opening.logic) {
				const content = text.slice(opening.line.next, line.from);
				result.push({ from: opening.line.from, to: line.to, contentFrom: opening.line.next, contentTo: line.from, content, circuitId: circuitId(content), startLine: opening.line.index, endLine: line.index });
			}
			opening = null;
			continue;
		}
		const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
		if (!match?.[1]) continue;
		const character = match[1][0];
		if (!character || (character === '`' && match[2]?.includes('`'))) continue;
		// Indented fences remain opaque, but are never safe editing targets: they may
		// belong to lists, whose indentation cannot be preserved by a root payload.
		opening = { line, character, length: match[1].length, logic: !line.text.startsWith(' ') && match[2]?.trim() === 'logic-circuit' };
	}
	return result;
}

/** Pure guarded update. Call this inside the editor transaction or vault.process callback. */
export function updateCircuitBlock(text: string, baseline: BlockBaseline, next: CircuitData): { text: string; block: LogicBlock } {
	const candidates = scanCircuitBlocks(text).filter(block => block.circuitId === baseline.circuitId);
	if (!candidates.length) throw new BlockConflictError('This circuit was removed or changed in the note. Your draft is preserved.');
	const block = candidates.length === 1 ? candidates[0] : candidates.find(candidate => candidate.from === baseline.from);
	if (!block) throw new BlockConflictError('Multiple blocks have this circuit ID and the selected occurrence cannot be identified safely. Your draft is preserved.');
	if (block.content !== baseline.content) throw new BlockConflictError('This circuit changed elsewhere in the note. Your draft is preserved.');
	const newline = text.slice(block.from, block.contentFrom).endsWith('\r\n') ? '\r\n' : '\n';
	const content = serializeCircuit(next).replace(/\n/g, newline) + newline;
	const updated = text.slice(0, block.contentFrom) + content + text.slice(block.contentTo);
	return { text: updated, block: { ...block, content, contentTo: block.contentFrom + content.length, to: block.to + content.length - block.content.length, endLine: block.startLine + content.split('\n').length, circuitId: next.circuitId } };
}
