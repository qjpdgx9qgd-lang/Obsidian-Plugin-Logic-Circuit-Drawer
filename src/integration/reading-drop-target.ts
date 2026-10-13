import type { MarkdownSectionInformation } from 'obsidian';
import { validateBlockMoveTarget } from '../storage/block-operations';

export function readingLineOffset(text: string, line: number): number {
	if (!Number.isInteger(line) || line < 0) throw new Error('The rendered block position is invalid.');
	let offset = 0;
	for (let index = 0; index < line; index++) {
		const newline = text.indexOf('\n', offset);
		if (newline < 0) {
			if (index === line - 1) return text.length;
			throw new Error('The rendered block position is no longer valid.');
		}
		offset = newline + 1;
	}
	return offset;
}

/** Section ranges are public; a drop never guesses individual lines of rendered prose. */
export function readingDropBoundary(section: MarkdownSectionInformation, after: boolean): { offset: number; line: number; noteText: string } {
	if (!Number.isInteger(section.lineStart) || section.lineStart < 0 || !Number.isInteger(section.lineEnd) || section.lineEnd < section.lineStart) {
		throw new Error('The rendered block position is invalid.');
	}
	if (section.lineEnd > section.text.split('\n').length - 1) throw new Error('The rendered block position is no longer valid.');
	const line = after ? section.lineEnd + 1 : section.lineStart;
	const offset = readingLineOffset(section.text, line);
	validateBlockMoveTarget(section.text, offset);
	return { offset, line, noteText: section.text };
}
