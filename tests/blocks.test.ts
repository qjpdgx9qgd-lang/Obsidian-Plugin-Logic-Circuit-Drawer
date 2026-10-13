import test from 'node:test';
import assert from 'node:assert/strict';
import { newCircuit, parseCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks, updateCircuitBlock } from '../src/storage/blocks';
import type { CircuitData } from '../src/model/types';

function data(id = 'one'): CircuitData { return { ...newCircuit(), circuitId: id }; }
function block(circuit: CircuitData, fence = '```', newline = '\n'): string {
	return `${fence}logic-circuit${newline}${serializeCircuit(circuit).replace(/\n/g, newline)}${newline}${fence}`;
}

void test('scanner finds multiple circuits and returns exact payload/line offsets', () => {
	const text = `Before\n${block(data())}\nBetween\n${block(data('two'), '~~~~')}\nAfter`;
	const found = scanCircuitBlocks(text);
	assert.equal(found.length, 2);
	const first = found[0];
	assert.ok(first);
	assert.equal(first.startLine, 1);
	assert.equal(first.content, text.slice(first.contentFrom, first.contentTo));
	assert.equal(text.slice(first.from, first.to), block(data()));
	assert.deepEqual(found.map(item => item.circuitId), ['one', 'two']);
});

void test('scanner ignores circuit-looking fences inside another code fence and unclosed blocks', () => {
	const text = `\`\`\`\`markdown\n${block(data('embedded'))}\n\`\`\`\`\n${block(data('real'))}\n\`\`\`logic-circuit\n{"circuitId":"unfinished"}`;
	assert.deepEqual(scanCircuitBlocks(text).map(item => item.circuitId), ['real']);
});

void test('scanner ignores indented circuit fences and treats their nested fence-looking content as opaque', () => {
	const text = `   ~~~~logic-circuit\n${block(data('nested'))}\n~~~\n   ~~~~\n${block(data('root'))}`;
	assert.deepEqual(scanCircuitBlocks(text).map(item => item.circuitId), ['root']);
});

void test('root circuits require a closing fence at least as long as their opening fence', () => {
	const text = `~~~~logic-circuit\n${serializeCircuit(data())}\n~~~\n~~~~\n`;
	assert.equal(scanCircuitBlocks(text).length, 1);
	assert.ok(scanCircuitBlocks(text)[0]?.content.endsWith('~~~\n'));
});

void test('guarded update changes only the intended payload and preserves surrounding text, other circuits and fence syntax', () => {
	const first = block(data(), '~~~~').replace('~~~~logic-circuit', '~~~~logic-circuit \t').replace(/\n~~~~$/, '\n~~~~ \t');
	const second = block(data('two'), '~~~~');
	const text = `Before **text**\n${first}\nBetween\n${second}\nAfter\n`;
	const baseline = scanCircuitBlocks(text)[0]!;
	const next = { ...data(), view: { preferredScale: 1.5 } };
	const updated = updateCircuitBlock(text, baseline as typeof baseline & { circuitId: string }, next);
	assert.equal(updated.text.slice(0, baseline.contentFrom), text.slice(0, baseline.contentFrom));
	assert.equal(updated.text.slice(updated.block.contentTo), text.slice(baseline.contentTo));
	assert.ok(updated.text.includes(second));
	assert.deepEqual(parseCircuit(updated.block.content), next);
	assert.deepEqual(scanCircuitBlocks(updated.text)[0], updated.block);
});

void test('unique circuit IDs relocate safely after unrelated note edits shift the block', () => {
	const initial = `Before\n${block(data())}\nAfter`;
	const baseline = scanCircuitBlocks(initial)[0]!;
	const current = `New heading\n\n${initial.replace('After', 'Edited after')}`;
	const result = updateCircuitBlock(current, { circuitId: 'one', content: baseline.content, from: baseline.from }, { ...data(), view: { preferredScale: 2 } });
	assert.ok(result.text.startsWith('New heading\n\nBefore\n'));
	assert.ok(result.text.endsWith('\nEdited after'));
	assert.equal(parseCircuit(result.block.content).view.preferredScale, 2);
});

void test('same-block edits, changed identities and deletion conflict without overwriting source', () => {
	const initial = block(data());
	const baseline = scanCircuitBlocks(initial)[0]!;
	const reference = { circuitId: 'one', content: baseline.content, from: baseline.from };
	const externallyChanged = initial.replace('"preferredScale": 1', '"preferredScale": 2');
	assert.throws(() => updateCircuitBlock(externallyChanged, reference, data()), /changed elsewhere/);
	assert.throws(() => updateCircuitBlock(initial.replace('"one"', '"renamed"'), reference, data()), /removed or changed/);
	assert.throws(() => updateCircuitBlock('The circuit was deleted.', reference, data()), /removed or changed/);
	assert.equal(externallyChanged, initial.replace('"preferredScale": 1', '"preferredScale": 2'));
});

void test('duplicate circuit IDs require an exact occurrence hint and allow guarded reidentity', () => {
	const text = `${block(data())}\nMiddle\n${block(data())}`;
	const occurrences = scanCircuitBlocks(text);
	const second = occurrences[1]!;
	assert.throws(() => updateCircuitBlock(text, { circuitId: 'one', content: second.content }, data('fresh')), /Multiple blocks/);
	assert.throws(() => updateCircuitBlock(text, { circuitId: 'one', content: second.content, from: second.from + 1 }, data('fresh')), /Multiple blocks/);
	const updated = updateCircuitBlock(text, { circuitId: 'one', content: second.content, from: second.from }, data('fresh'));
	assert.deepEqual(scanCircuitBlocks(updated.text).map(item => item.circuitId), ['one', 'fresh']);
	assert.equal(updated.text.slice(0, second.from), text.slice(0, second.from));
});

void test('an unmapped duplicate hint conflicts even when its baseline content is unique', () => {
	const secondData = { ...data(), view: { preferredScale: 2 } };
	const initial = `${block(data())}\n${block(secondData)}`;
	const baseline = scanCircuitBlocks(initial)[1]!;
	assert.throws(() => updateCircuitBlock(`Inserted line\n${initial}`, { circuitId: 'one', content: baseline.content, from: baseline.from }, data('fresh')), /Multiple blocks/);
});

void test('payload updates preserve CRLF fences and produce consistent returned offsets', () => {
	const text = `Before\r\n${block(data(), '~~~~', '\r\n')}\r\nAfter\r\n`;
	const baseline = scanCircuitBlocks(text)[0]!;
	const updated = updateCircuitBlock(text, { circuitId: 'one', content: baseline.content }, { ...data(), view: { preferredScale: 1.25 } });
	assert.equal(updated.text.replace(/\r\n/g, '').includes('\n'), false);
	assert.equal(text.slice(baseline.contentTo), updated.text.slice(updated.block.contentTo));
	assert.deepEqual(scanCircuitBlocks(updated.text)[0], updated.block);
});

void test('a save checks the text supplied at application time and advances baseline only after success', () => {
	const initial = block(data());
	const baseline = scanCircuitBlocks(initial)[0]!;
	const reference = { circuitId: 'one', content: baseline.content };
	const first = updateCircuitBlock(initial, reference, { ...data(), view: { preferredScale: 1.5 } });
	assert.throws(() => updateCircuitBlock(first.text, reference, { ...data(), view: { preferredScale: 2 } }), /changed elsewhere/);
	const second = updateCircuitBlock(`Outside edit\n${first.text}`, { circuitId: 'one', content: first.block.content }, { ...data(), view: { preferredScale: 2 } });
	assert.equal(parseCircuit(second.block.content).view.preferredScale, 2);
	assert.ok(second.text.startsWith('Outside edit\n'));
});

void test('malformed blocks are recognized for error rendering without inventing an identity', () => {
	const text = '```logic-circuit\n{malformed\n```';
	const found = scanCircuitBlocks(text);
	assert.equal(found.length, 1);
	assert.equal(found[0]?.circuitId, null);
	assert.equal(found[0]?.content, '{malformed\n');
	assert.throws(() => updateCircuitBlock(text, { circuitId: 'one', content: '{malformed\n' }, data()), /removed or changed/);
	assert.equal(text, '```logic-circuit\n{malformed\n```');
});

void test('list-nested and indented-code circuits are excluded without changing surrounding Markdown', () => {
	const nested = block(data('list')).split('\n').map(line => `  ${line}`).join('\n');
	const indentedCode = block(data('code')).split('\n').map(line => `    ${line}`).join('\n');
	const text = `- List item\n${nested}\n\n${indentedCode}\n\n${block(data('root'))}`;
	assert.deepEqual(scanCircuitBlocks(text).map(item => item.circuitId), ['root']);
	const root = scanCircuitBlocks(text)[0]!;
	const changed = updateCircuitBlock(text, { circuitId: 'root', content: root.content }, { ...data('root'), view: { preferredScale: 2 } });
	assert.ok(changed.text.includes(nested));
	assert.ok(changed.text.includes(indentedCode));
	assert.throws(() => updateCircuitBlock(text, { circuitId: 'list', content: `${serializeCircuit(data('list'))}\n` }, data('list')), /removed or changed/);
});

void test('initial YAML metadata is opaque, including root-looking circuit fences in literal values', () => {
	for (const closing of ['---', '...']) {
		const text = `---\nexample: |\n${block(data('metadata'))}\n${closing}\n${block(data('root'))}`;
		assert.deepEqual(scanCircuitBlocks(text).map(item => item.circuitId), ['root']);
	}
	const unclosed = `---\nexample: |\n${block(data('metadata'))}`;
	assert.deepEqual(scanCircuitBlocks(unclosed), []);
});

void test('metadata scanning preserves BOM/CRLF and does not treat later thematic breaks as metadata', () => {
	const prefix = `\uFEFF---\r\nexample: |\r\n${block(data('metadata'), '```', '\r\n')}\r\n---\r\n`;
	const text = `${prefix}${block(data('root'), '~~~~', '\r\n')}\r\n---\r\n${block(data('after'), '```', '\r\n')}`;
	assert.deepEqual(scanCircuitBlocks(text).map(item => item.circuitId), ['root', 'after']);
	const target = scanCircuitBlocks(text)[0]!;
	const updated = updateCircuitBlock(text, { circuitId: 'root', content: target.content }, { ...data('root'), view: { preferredScale: 2 } });
	assert.ok(updated.text.startsWith(prefix));
	assert.equal(updated.text.replace(/\r\n/g, '').includes('\n'), false);
});

void test('out-of-range replacement data is rejected without rewriting any Markdown', () => {
	const text = `Before\n${block(data())}\n${block(data('other'))}\nAfter`;
	const baseline = scanCircuitBlocks(text)[0]!;
	const invalid: CircuitData = { ...data(), nodes: [{ id: 'huge', type: 'input', position: { x: 1e308, y: 0 } }] };
	assert.throws(() => updateCircuitBlock(text, { circuitId: 'one', content: baseline.content }, invalid), /between -10000 and 10000/);
	assert.equal(text, `Before\n${block(data())}\n${block(data('other'))}\nAfter`);
	assert.deepEqual(scanCircuitBlocks(text).map(item => item.circuitId), ['one', 'other']);
});
