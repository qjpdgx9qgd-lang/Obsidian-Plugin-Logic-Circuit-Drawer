import test from 'node:test';
import assert from 'node:assert/strict';
import { insertionForCircuit } from '../src/integration/insertion';
import { newCircuit, parseCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks } from '../src/storage/blocks';

const insert = (note: string, offset: number) => {
	const circuit = newCircuit(1.5);
	const insertion = insertionForCircuit(note, offset, circuit);
	return { circuit, insertion, result: note.slice(0, offset) + insertion.text + note.slice(offset) };
};

void test('insertion at a selection head preserves every original character without replacing selected text', () => {
	const note = 'Before selected text after.';
	const head = note.indexOf(' after.');
	const { circuit, insertion, result } = insert(note, head);
	assert.equal(result.slice(0, head), note.slice(0, head));
	assert.equal(result.slice(head + insertion.text.length), note.slice(head));
	assert.ok(result.includes('selected text'));
	assert.equal(insertion.cursorOffset, head + insertion.text.length);
	const block = scanCircuitBlocks(result)[0]!;
	assert.equal(parseCircuit(block.content).circuitId, circuit.circuitId);
	assert.equal(parseCircuit(block.content).view.preferredScale, 1.5);
});

void test('empty notes and end-of-note placement produce one independently renderable circuit', () => {
	for (const note of ['', 'A paragraph', 'A paragraph\n']) {
		const { result } = insert(note, note.length);
		assert.ok(result.startsWith(note));
		assert.equal(scanCircuitBlocks(result).length, 1);
		assert.ok(result.endsWith('```'), 'EOF insertion must not create a trailing empty line');
	}
});

void test('insertion uses only the separator needed before following text and reuses existing line endings', () => {
	for (const newline of ['\n', '\r\n']) {
		const circuit = newCircuit();
		const raw = `\`\`\`logic-circuit${newline}${serializeCircuit(circuit).replaceAll('\n', newline)}${newline}\`\`\``;
		for (const [note, offset, expected] of [
			[`First${newline}Last`, `First${newline}`.length, `First${newline}${raw}${newline}Last`],
			[`First${newline}${newline}Last`, `First${newline}`.length, `First${newline}${raw}${newline}Last`],
			[`First${newline}`, 'First'.length, `First${newline}${raw}${newline}`],
		] as const) {
			const insertion = insertionForCircuit(note, offset, circuit);
			assert.equal(note.slice(0, offset) + insertion.text + note.slice(offset), expected);
		}
	}
});

void test('CRLF notes retain their newline style, surroundings and circuit offsets', () => {
	const note = 'Before\r\n\r\nAfter\r\n';
	const offset = note.indexOf('After');
	const { result, insertion } = insert(note, offset);
	assert.equal(insertion.text.replace(/\r\n/g, '').includes('\n'), false);
	assert.ok(result.startsWith('Before\r\n\r\n'));
	assert.ok(result.endsWith('After\r\n'));
	assert.equal(scanCircuitBlocks(result).length, 1);
	assert.throws(() => insertionForCircuit(note, note.indexOf('\r\n') + 1, newCircuit()), /complete line boundary/);
});

void test('positions inside existing logic-circuit JSON reject insertion without changing the note', () => {
	const note = `Before\n\n\`\`\`logic-circuit\n${serializeCircuit(newCircuit())}\n\`\`\`\n\nAfter`;
	for (const offset of [note.indexOf('schemaVersion'), note.indexOf('logic-circuit') + 1, note.lastIndexOf('```')]) {
		assert.throws(() => insertionForCircuit(note, offset, newCircuit()), /existing code block/);
	}
	assert.equal(scanCircuitBlocks(note).length, 1);
});

void test('backtick, tilde, longer and unclosed fences protect their content', () => {
	for (const fence of ['```', '~~~~', '`````']) {
		const note = `${fence}text\ninside\n${fence}\n`;
		assert.throws(() => insertionForCircuit(note, note.indexOf('inside'), newCircuit()), /existing code block/);
	}
	assert.throws(() => insertionForCircuit('```text\ninside', 14, newCircuit()), /Close the existing code block/);
	const nested = '````text\n```logic-circuit\ninside\n```\n````\n';
	assert.throws(() => insertionForCircuit(nested, nested.indexOf('inside'), newCircuit()), /existing code block/);
});

void test('insertion before an opening fence or after a closing fence leaves the original fence valid', () => {
	const note = '```text\ninside\n```\n';
	for (const offset of [0, note.lastIndexOf('```') + 3, note.length]) {
		const { result } = insert(note, offset);
		assert.equal(scanCircuitBlocks(result).length, 1);
		assert.ok(result.includes('```text\ninside\n```'));
	}
});

void test('list, blockquote, continuation and indented code locations are rejected', () => {
	for (const line of ['- item', '+ item', '* item', '1. item', '2) item', '> quote', '  continuation', '    code', '\tcode', '  ']) {
		assert.throws(() => insertionForCircuit(line, line.length, newCircuit()), /unindented line outside lists and blockquotes/);
	}
	assert.throws(() => insertionForCircuit('- item\n  continuation', 17, newCircuit()), /unindented line outside lists and blockquotes/);
});

void test('note properties and invalid offsets are protected', () => {
	const note = '---\ntitle: Example\n---\n\nText';
	assert.throws(() => insertionForCircuit(note, 0, newCircuit()), /after the note properties/);
	assert.throws(() => insertionForCircuit(note, note.indexOf('Example'), newCircuit()), /after the note properties/);
	assert.equal(scanCircuitBlocks(insert(note, note.indexOf('Text')).result).length, 1);
	for (const offset of [-1, 0.5, Infinity, note.length + 1]) {
		assert.throws(() => insertionForCircuit(note, offset, newCircuit()), /position is no longer valid/);
	}
});
