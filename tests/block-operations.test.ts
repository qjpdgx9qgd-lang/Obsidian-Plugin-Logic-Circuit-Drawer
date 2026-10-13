import test from 'node:test';
import assert from 'node:assert/strict';
import { newCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks } from '../src/storage/blocks';
import { deleteCircuitBlock, insertCircuitBlockLine, moveCircuitBlock, structuralBaseline, validateBlockMoveTarget } from '../src/storage/block-operations';

const fence = (id: string): string => `\`\`\`logic-circuit\n${serializeCircuit({ ...newCircuit(), circuitId: id })}\n\`\`\``;
function fixture() {
	const first = fence('first');
	const second = fence('second');
	const text = `Heading\n\n${first}\n\nBetween\n\n${second}\n\nEnd`;
	const block = scanCircuitBlocks(text)[0]!;
	return { text, first, second, block, baseline: structuralBaseline(text, block) };
}

void test('deletion removes only the selected raw fence and preserves every surrounding byte', () => {
	const { text, block, baseline, second } = fixture();
	const result = deleteCircuitBlock(text, baseline);
	assert.equal(result.text, text.slice(0, block.from) + text.slice(block.to));
	assert.deepEqual(result.changes, [{ from: block.from, to: block.to, text: '' }]);
	assert.equal(result.cursorOffset, block.from);
	assert.equal(scanCircuitBlocks(result.text).length, 1);
	assert.ok(result.text.includes(second));
});

void test('deletion follows a unique circuit when surrounding note text shifts its position', () => {
	const { text, baseline, block } = fixture();
	const prefix = 'An unsaved heading\n\n';
	assert.equal(deleteCircuitBlock(prefix + text, baseline).text,
		prefix + text.slice(0, block.from) + text.slice(block.to));
	assert.equal(deleteCircuitBlock(prefix + text, baseline).cursorOffset, prefix.length + block.from);
});

void test('inserting a line before or after adds exactly one empty line and places the caret on it', () => {
	for (const newline of ['\n', '\r\n']) {
		const raw = fence('line').replaceAll('\n', newline);
		const text = `Before${newline}${raw}${newline}After`;
		const block = scanCircuitBlocks(text)[0]!;
		const baseline = structuralBaseline(text, block);
		const before = insertCircuitBlockLine(text, baseline, 'before');
		assert.equal(before.text, `Before${newline}${newline}${raw}${newline}After`);
		assert.equal(before.cursorOffset, `Before${newline}`.length);
		assert.equal(before.block!.from, block.from + newline.length);
		assert.equal(before.text.slice(before.block!.from, before.block!.to), raw);
		const after = insertCircuitBlockLine(text, baseline, 'after');
		assert.equal(after.text, `Before${newline}${raw}${newline}${newline}After`);
		assert.equal(after.cursorOffset, block.to + newline.length);
		assert.equal(after.block!.from, block.from);
		assert.equal(after.text.slice(after.block!.from, after.block!.to), raw);
	}
});

void test('inserting beside a fence preserves existing blank lines and other circuits', () => {
	const { text, first, second, block, baseline } = fixture();
	assert.equal(insertCircuitBlockLine(text, baseline, 'before').text, `Heading\n\n\n${first}\n\nBetween\n\n${second}\n\nEnd`);
	const after = insertCircuitBlockLine(text, baseline, 'after');
	assert.equal(after.text, `Heading\n\n${first}\n\n\nBetween\n\n${second}\n\nEnd`);
	assert.equal(after.cursorOffset, block.to + 1);
});

void test('line insertion handles the first and last note lines without putting the caret inside a fence', () => {
	const raw = fence('edge-line');
	for (const [text, expected, cursor] of [
		[raw, `${raw}\n`, raw.length + 1],
		[`${raw}\n`, `${raw}\n\n`, raw.length + 1],
	] as const) {
		const baseline = structuralBaseline(text, scanCircuitBlocks(text)[0]!);
		const after = insertCircuitBlockLine(text, baseline, 'after');
		assert.equal(after.text, expected);
		assert.equal(after.cursorOffset, cursor);
		assert.equal(after.text.slice(0, after.cursorOffset).split('\n').at(-1), '');
	}
	const before = insertCircuitBlockLine(raw, structuralBaseline(raw, scanCircuitBlocks(raw)[0]!), 'before');
	assert.equal(before.text, `\n${raw}`);
	assert.equal(before.cursorOffset, 0);
});

void test('line insertion relocates shifted unique fences and rejects changed or ambiguous occurrences', () => {
	const { text, first, baseline } = fixture();
	const prefix = 'Unsaved heading\n';
	const shifted = insertCircuitBlockLine(prefix + text, baseline, 'before');
	assert.equal(shifted.cursorOffset, prefix.length + baseline.from);
	assert.throws(() => insertCircuitBlockLine(text.replace(first, first.replace('schemaVersion', 'version')), baseline, 'after'), /changed/);
	assert.throws(() => insertCircuitBlockLine(`${first}\n${text}`, baseline, 'before'), /cannot be distinguished/);
	const duplicated = `${text}\n${first}`;
	const copies = scanCircuitBlocks(duplicated);
	const copiedBaseline = structuralBaseline(duplicated, copies.at(-1)!);
	assert.equal(insertCircuitBlockLine(duplicated, copiedBaseline, 'before').cursorOffset, copies.at(-1)!.from);
	assert.throws(() => insertCircuitBlockLine(prefix + duplicated, copiedBaseline, 'after'), /note changed/);
});

void test('changed circuit payloads and changed fence spelling reject structural operations', () => {
	const { text, baseline, block } = fixture();
	const payload = text.slice(0, block.contentFrom) + ' ' + text.slice(block.contentFrom);
	assert.throws(() => deleteCircuitBlock(payload, baseline), /changed/);
	const fenceChanged = text.slice(0, block.from) + text.slice(block.from, block.to).replaceAll('```', '~~~') + text.slice(block.to);
	assert.throws(() => deleteCircuitBlock(fenceChanged, baseline), /changed/);
});

void test('a copied block appearing after selection is never deleted accidentally', () => {
	const { text, first, baseline } = fixture();
	const changed = `${first}\n\n${text}`;
	assert.throws(() => deleteCircuitBlock(changed, baseline), /cannot be distinguished/);
});

void test('known duplicates use an exact note and offset guard even when a copy disappears', () => {
	const raw = fence('copied');
	const text = `${raw}\n\n${raw}`;
	const blocks = scanCircuitBlocks(text);
	const baseline = structuralBaseline(text, blocks[1]!);
	assert.equal(deleteCircuitBlock(text, baseline).text, `${raw}\n\n`);
	assert.throws(() => deleteCircuitBlock(`Heading\n${text}`, baseline), /note changed/);
	assert.throws(() => deleteCircuitBlock(raw, baseline), /note changed/);
});

void test('malformed and unsupported blocks can be deleted without parsing or changing their contents', () => {
	for (const raw of ['```logic-circuit\nnot JSON\n```', '~~~logic-circuit\n{"schemaVersion":99,"circuitId":"future"}\n~~~']) {
		const text = `Before\n${raw}\nAfter`;
		const baseline = structuralBaseline(text, scanCircuitBlocks(text)[0]!);
		assert.equal(deleteCircuitBlock(text, baseline).text, 'Before\n\nAfter');
		assert.throws(() => deleteCircuitBlock(text.replace(raw, raw.replace('\n', '\n ')), baseline), /changed/);
	}
});

void test('moving downward passes another circuit without changing its raw fence or surrounding prose', () => {
	const { text, first, second, baseline } = fixture();
	const target = text.indexOf('End');
	const result = moveCircuitBlock(text, baseline, { offset: target, noteText: text });
	assert.equal(result.text, `Heading\n\n\nBetween\n\n${second}\n\n${first}\nEnd`);
	assert.equal(result.changes.length, 2);
	assert.equal(result.block?.circuitId, 'first');
	assert.equal(result.text.slice(result.block.from, result.block.to), first);
	const remaining = scanCircuitBlocks(result.text);
	assert.deepEqual(remaining.map((item) => item.circuitId), ['second', 'first']);
	assert.equal(result.text.slice(remaining[0]!.from, remaining[0]!.to), second);
});

void test('moving upward preserves CRLF and the original tilde fence exactly', () => {
	const raw = fence('crlf').replaceAll('```', '~~~~').replaceAll('\n', '\r\n');
	const text = `Before\r\n\r\n${raw}\r\n\r\nAfter`;
	const block = scanCircuitBlocks(text)[0]!;
	const result = moveCircuitBlock(text, structuralBaseline(text, block), { offset: 0, noteText: text });
	assert.equal(result.text, `${raw}\r\nBefore\r\n\r\n\r\nAfter`);
	assert.equal(result.block!.from, 0);
	assert.ok(!/(?<!\r)\n/.test(result.text));
});

void test('moving malformed blocks preserves the unparseable payload and guarded identity', () => {
	const raw = '```logic-circuit\n{broken\n```';
	const text = `Before\n\n${raw}\nAfter`;
	const baseline = structuralBaseline(text, scanCircuitBlocks(text)[0]!);
	const result = moveCircuitBlock(text, baseline, { offset: 0, noteText: text });
	assert.equal(result.text, `${raw}\nBefore\n\nAfter`);
	assert.equal(result.block!.circuitId, null);
	assert.equal(result.block!.content, '{broken\n');
});

void test('drops inside the original block are no-ops and stale drop offsets reject without changes', () => {
	const { text, block, baseline } = fixture();
	for (const offset of [block.from, block.contentFrom, block.to, block.to + 1]) {
		const result = moveCircuitBlock(text, baseline, { offset, noteText: text });
		assert.equal(result.text, text);
		assert.deepEqual(result.changes, []);
	}
	assert.throws(() => moveCircuitBlock(`Changed\n${text}`, baseline, { offset: 0, noteText: text }), /choosing the drop position/);
});

void test('moving into an existing empty-line slot adds no paragraph spacing', () => {
	const raw = fence('slot');
	const text = `${raw}\nFirst\n\nLast\n`;
	const block = scanCircuitBlocks(text)[0]!;
	const target = text.indexOf('\nLast');
	const result = moveCircuitBlock(text, structuralBaseline(text, block), { offset: target, noteText: text });
	assert.equal(result.text, `First\n${raw}\n\nLast\n`);
	assert.equal(result.text.length, text.length);
	assert.equal(result.changes[0]!.to, block.to + 1);
});

void test('adjacent circuit line slots relocate without adding empty lines', () => {
	const first = fence('adjacent-first');
	const second = fence('adjacent-second');
	const text = `${first}\n${second}\nEnd\n`;
	const original = scanCircuitBlocks(text);
	const result = moveCircuitBlock(text, structuralBaseline(text, original[0]!), { offset: original[1]!.to + 1, noteText: text });
	assert.equal(result.text, `${second}\n${first}\nEnd\n`);
	assert.equal(result.text.length, text.length);
	const back = moveCircuitBlock(result.text, structuralBaseline(result.text, result.block!), { offset: 0, noteText: result.text });
	assert.equal(back.text, text);
});

void test('moves to the beginning and a terminated note end preserve all existing line spacing', () => {
	const raw = fence('ends');
	const text = `First\n${raw}\nLast\n`;
	const block = scanCircuitBlocks(text)[0]!;
	const beginning = moveCircuitBlock(text, structuralBaseline(text, block), { offset: 0, noteText: text });
	assert.equal(beginning.text, `${raw}\nFirst\nLast\n`);
	const end = moveCircuitBlock(text, structuralBaseline(text, block), { offset: text.length, noteText: text });
	assert.equal(end.text, `First\nLast\n${raw}\n`);
	assert.equal(end.text.length, text.length);
});

void test('EOF blocks gain only the one line terminator needed at their new slot', () => {
	const raw = fence('unterminated');
	const text = `First\nLast\n${raw}`;
	const block = scanCircuitBlocks(text)[0]!;
	const result = moveCircuitBlock(text, structuralBaseline(text, block), { offset: text.indexOf('Last'), noteText: text });
	assert.equal(result.text, `First\n${raw}\nLast\n`);
	assert.equal(result.text.length, text.length + 1);
	const crlf = text.replaceAll('\n', '\r\n');
	const crlfBlock = scanCircuitBlocks(crlf)[0]!;
	const crlfResult = moveCircuitBlock(crlf, structuralBaseline(crlf, crlfBlock), { offset: 0, noteText: crlf });
	assert.equal(crlfResult.text, `${raw.replaceAll('\n', '\r\n')}\r\nFirst\r\nLast\r\n`);
	assert.equal(crlfResult.text.length, crlf.length + 2);
});

void test('dropping at an unterminated prose EOF adds one essential separator and no blank line', () => {
	const raw = fence('prose-eof');
	const text = `${raw}\nFirst\nLast`;
	const block = scanCircuitBlocks(text)[0]!;
	const result = moveCircuitBlock(text, structuralBaseline(text, block), { offset: text.length, noteText: text });
	assert.equal(result.text, `First\nLast\n${raw}\n`);
	assert.equal(result.text.length, text.length + 1);
});

void test('repeated moves never accumulate blank lines in LF or CRLF notes', () => {
	for (const newline of ['\n', '\r\n']) {
		const raw = fence('repeated').replaceAll('\n', newline);
		const original = `First${newline}${raw}${newline}Middle${newline}${newline}Last${newline}`;
		let current = original;
		for (let cycle = 0; cycle < 20; cycle++) {
			let block = scanCircuitBlocks(current)[0]!;
			current = moveCircuitBlock(current, structuralBaseline(current, block), { offset: current.indexOf('Last'), noteText: current }).text;
			assert.equal(current, `First${newline}Middle${newline}${newline}${raw}${newline}Last${newline}`);
			block = scanCircuitBlocks(current)[0]!;
			current = moveCircuitBlock(current, structuralBaseline(current, block), { offset: current.indexOf('Middle'), noteText: current }).text;
			assert.equal(current, original);
		}
	}
});

void test('move targets reject code contents, properties, list or quote lines, indentation, and partial lines', () => {
	for (const [text, offset] of [
		['```js\ncode\n```\n', 6],
		['```js\ncode\n```\n', 11],
		['```js\ncode', 10],
		['---\ntitle: Test\n---\nBody', 4],
		['---\ntitle: Test', 15],
		['- item\nBody', 0],
		['1. item\nBody', 0],
		['> quote\nBody', 0],
		['  indented\nBody', 0],
		['paragraph', 4],
	] as const) assert.throws(() => validateBlockMoveTarget(text, offset));
	for (const text of ['Body', '```js\ncode\n```', '---\ntitle: Test\n---']) {
		assert.doesNotThrow(() => validateBlockMoveTarget(text, text.length));
	}
});
