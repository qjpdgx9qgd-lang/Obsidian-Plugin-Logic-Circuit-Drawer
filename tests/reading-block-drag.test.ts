import test from 'node:test';
import assert from 'node:assert/strict';
import { readingDropBoundary, readingLineOffset } from '../src/integration/reading-drop-target';

void test('Reading view drops land before or after a complete rendered paragraph section', () => {
	const text = '# Title\n\nFirst paragraph\ncontinued line\n\nLast paragraph';
	const section = { text, lineStart: 2, lineEnd: 3 };
	assert.deepEqual(readingDropBoundary(section, false), { offset: text.indexOf('First paragraph'), line: 2, noteText: text });
	assert.deepEqual(readingDropBoundary(section, true), { offset: text.indexOf('\nLast paragraph'), line: 4, noteText: text });
});

void test('Reading view line mapping preserves CRLF and handles the final source line', () => {
	const text = '# Title\r\n\r\nLast paragraph';
	assert.equal(readingLineOffset(text, 2), text.indexOf('Last paragraph'));
	assert.equal(readingDropBoundary({ text, lineStart: 2, lineEnd: 2 }, true).offset, text.length);
	assert.equal(readingLineOffset(text.replaceAll('\r\n', '\n'), 2), 9);
});

void test('Reading view circuit and code sections allow only their outer boundaries', () => {
	const text = 'Before\n\n```logic-circuit\ninvalid JSON\n```\n\nAfter';
	const section = { text, lineStart: 2, lineEnd: 4 };
	assert.equal(readingDropBoundary(section, false).offset, text.indexOf('```'));
	assert.equal(readingDropBoundary(section, true).offset, text.indexOf('\nAfter'));
	assert.throws(() => readingDropBoundary({ text, lineStart: 3, lineEnd: 3 }, false), /outside the existing code block/);
});

void test('Reading view rejects unsafe list positions, properties and stale section line ranges', () => {
	assert.throws(() => readingDropBoundary({ text: '- First item\n- Second item\n', lineStart: 0, lineEnd: 1 }, false), /outside lists/);
	assert.throws(() => readingDropBoundary({ text: '---\ntitle: Note\n---\nBody', lineStart: 1, lineEnd: 1 }, false), /note properties/);
	assert.throws(() => readingDropBoundary({ text: 'Only one line', lineStart: 2, lineEnd: 2 }, false), /no longer valid/);
	assert.throws(() => readingDropBoundary({ text: 'Only one line', lineStart: 1, lineEnd: 1 }, false), /no longer valid/);
	assert.throws(() => readingDropBoundary({ text: 'Only one line', lineStart: -1, lineEnd: 0 }, false), /invalid/);
	assert.throws(() => readingLineOffset('Body', 0.5), /invalid/);
});
