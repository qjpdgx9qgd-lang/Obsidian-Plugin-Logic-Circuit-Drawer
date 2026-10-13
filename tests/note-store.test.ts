import test from 'node:test';
import assert from 'node:assert/strict';
import type { App, Editor } from 'obsidian';
import { MarkdownView, TFile } from './obsidian-stub';
import { NoteStore } from '../src/integration/note-store';
import { newCircuit, parseCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks, updateCircuitBlock } from '../src/storage/blocks';
import type { CircuitData } from '../src/model/types';
import { CircuitSession } from '../src/integration/session';
import { structuralBaseline } from '../src/storage/block-operations';

interface Position { line: number; ch: number; }
class MemoryEditor {
	transactions = 0;
	lastChangeCount = 0;
	selection: Position | undefined;
	focusCount = 0;
	constructor(public value: string) {}
	getValue(): string { return this.value; }
	offsetToPos(offset: number): Position {
		const lines = this.value.slice(0, offset).split('\n');
		return { line: lines.length - 1, ch: lines.at(-1)!.length };
	}
	private offset(position: Position): number {
		const lines = this.value.split('\n');
		return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
	}
	focus(): void { this.focusCount++; }
	transaction(transaction: { changes: { from: Position; to: Position; text: string }[]; selection?: { from: Position } }): void {
		this.lastChangeCount = transaction.changes.length;
		for (const change of [...transaction.changes].reverse()) {
			const from = this.offset(change.from);
			const to = this.offset(change.to);
			this.value = this.value.slice(0, from) + change.text + this.value.slice(to);
		}
		if (transaction.selection) this.selection = transaction.selection.from;
		this.transactions++;
	}
}

const blockFor = (circuit: CircuitData): string => `\`\`\`logic-circuit\n${serializeCircuit(circuit)}\n\`\`\``;
const withScale = (circuit: CircuitData, scale: number): CircuitData => ({ ...circuit, view: { preferredScale: scale } });
function setup() {
	const circuit = newCircuit();
	const other = newCircuit();
	const text = `Before\n\n${blockFor(circuit)}\n\nMiddle\n\n${blockFor(other)}\n\nAfter`;
	const file = new TFile('circuit.md') as unknown as import('obsidian').TFile;
	const vault = {
		text,
		writes: 0,
		beforeProcess: undefined as (() => void) | undefined,
		read: () => Promise.resolve(vault.text),
		process: (_file: unknown, action: (text: string) => string) => {
			vault.beforeProcess?.();
			vault.text = action(vault.text);
			vault.writes++;
			return Promise.resolve(vault.text);
		},
	};
	const views: MarkdownView[] = [];
	const app = { vault, workspace: { iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => {
		for (const view of views) callback({ view });
	} } } as unknown as App;
	const first = scanCircuitBlocks(text)[0]!;
	const baseline = { circuitId: circuit.circuitId, content: first.content, from: first.from };
	const store = new NoteStore(app);
	return { circuit, other, text, file, vault, views, baseline, store };
}

void test('active editor contents are authoritative and only the circuit payload is transacted', async () => {
	const { circuit, text, file, vault, views, baseline, store } = setup();
	const editor = new MemoryEditor(`Unsaved heading\n${text}`);
	views.push(new MarkdownView(file, editor));
	const saved = await store.write(file, editor as unknown as Editor, baseline, withScale(circuit, 1.5));
	assert.equal(editor.transactions, 1);
	assert.equal(vault.writes, 0);
	assert.equal(vault.text, text);
	assert.ok(editor.value.startsWith('Unsaved heading\nBefore\n\n'));
	assert.ok(editor.value.endsWith('\n\nAfter'));
	assert.equal(scanCircuitBlocks(editor.value)[1]!.content, scanCircuitBlocks(text)[1]!.content);
	assert.equal(parseCircuit(saved.content).view.preferredScale, 1.5);
	assert.equal(await store.read(file), editor.value);
});

void test('target edits in an active editor are rejected before transaction', async () => {
	const { circuit, text, file, views, baseline, store } = setup();
	const changed = updateCircuitBlock(text, baseline, withScale(circuit, 2)).text;
	const editor = new MemoryEditor(changed);
	views.push(new MarkdownView(file, editor));
	await assert.rejects(store.write(file, undefined, baseline, withScale(circuit, 1.5)), /changed elsewhere/);
	assert.equal(editor.transactions, 0);
	assert.equal(editor.value, changed);
});

void test('different unsaved pane contents prevent writes to either pane', async () => {
	const { circuit, text, file, views, baseline, store, vault } = setup();
	const first = new MemoryEditor(text);
	const second = new MemoryEditor(`Different unsaved text\n${text}`);
	views.push(new MarkdownView(file, first), new MarkdownView(file, second));
	await assert.rejects(store.write(file, first as unknown as Editor, baseline, withScale(circuit, 1.5)), /different unsaved contents/);
	assert.equal(first.transactions, 0);
	assert.equal(second.transactions, 0);
	assert.equal(vault.writes, 0);
});

void test('vault guard uses the content at mutation time and preserves intervening surrounding text', async () => {
	const { circuit, text, file, vault, baseline, store } = setup();
	await store.read(file);
	const prefix = 'An intervening note edit\n\n';
	vault.beforeProcess = () => { vault.text = prefix + text; };
	await store.write(file, undefined, baseline, withScale(circuit, 1.5));
	assert.equal(vault.writes, 1);
	assert.ok(vault.text.startsWith(prefix + 'Before'));
	assert.equal(scanCircuitBlocks(vault.text)[1]!.content, scanCircuitBlocks(text)[1]!.content);
});

void test('intervening circuit edits inside vault.process reject the update atomically', async () => {
	const { circuit, text, file, vault, baseline, store } = setup();
	const external = updateCircuitBlock(text, baseline, withScale(circuit, 2)).text;
	vault.beforeProcess = () => { vault.text = external; };
	await assert.rejects(store.write(file, undefined, baseline, withScale(circuit, 1.5)), /changed elsewhere/);
	assert.equal(vault.writes, 0);
	assert.equal(vault.text, external);
});

void test('copied-circuit identity is guarded against intervening shifts at mutation time', async () => {
	const { circuit, text, file, vault, baseline, store } = setup();
	const duplicate = blockFor(circuit);
	vault.text = `${text}\n\n${duplicate}`;
	const identityText = vault.text;
	const shifted = `${duplicate}\n\n${identityText}`;
	vault.beforeProcess = () => { vault.text = shifted; };
	await assert.rejects(store.write(file, undefined, { ...baseline, identityText },
		{ ...circuit, circuitId: 'independent-circuit' }), /note changed while identifying/);
	assert.equal(vault.writes, 0);
	assert.equal(vault.text, shifted);
});

void test('a duplicate introduced after a unique read cannot select the pasted copy at mutation time', async () => {
	const { circuit, text, file, vault, baseline, store } = setup();
	assert.equal(await store.read(file), text);
	const pasted = text.slice(0, baseline.from) + blockFor(circuit) + '\n\n' + text.slice(baseline.from);
	vault.beforeProcess = () => { vault.text = pasted; };
	await assert.rejects(store.write(file, undefined, baseline, withScale(circuit, 1.5)), /copied circuit appeared/);
	assert.equal(vault.writes, 0);
	assert.equal(vault.text, pasted);
});

void test('ambiguous editor updates require an explicit guarded reidentity', async () => {
	const { circuit, text, file, views, baseline, store } = setup();
	const duplicateText = `${text}\n\n${blockFor(circuit)}`;
	const editor = new MemoryEditor(duplicateText);
	views.push(new MarkdownView(file, editor));
	await assert.rejects(store.write(file, undefined, { ...baseline, identityText: duplicateText }, withScale(circuit, 1.5)), /copied circuit appeared/);
	assert.equal(editor.transactions, 0);
	const saved = await store.write(file, undefined, { ...baseline, identityText: duplicateText },
		{ ...circuit, circuitId: 'independent-circuit' });
	assert.equal(saved.circuitId, 'independent-circuit');
	assert.equal(editor.transactions, 1);
	assert.equal(scanCircuitBlocks(editor.value).at(-1)!.circuitId, circuit.circuitId);
});

void test('a copied-block save race retains the local draft and Done reports a conflict', async () => {
	const { circuit, text, file, vault, baseline, store } = setup();
	const session = new CircuitSession({ store, file, activate: () => Promise.resolve() }, scanCircuitBlocks(text)[0]!);
	await session.startEditing();
	const pasted = text.slice(0, baseline.from) + blockFor(circuit) + '\n\n' + text.slice(baseline.from);
	vault.beforeProcess = () => { vault.text = pasted; };
	session.commit(withScale(circuit, 1.5));
	await assert.rejects(session.finish(), /copied circuit appeared/);
	assert.equal(vault.writes, 0);
	assert.equal(vault.text, pasted);
	assert.equal(session.getSnapshot().conflict, true);
	assert.equal(session.getSnapshot().editing, true);
	assert.equal(session.getSnapshot().saving, false);
	assert.equal(session.getSnapshot().circuit?.view.preferredScale, 1.5);
	assert.match(session.getSnapshot().error!, /draft is preserved/);
});

void test('changing to Reading view ignores the dormant editor and uses guarded vault contents', async () => {
	const { circuit, text, file, vault, views, baseline, store } = setup();
	const editor = new MemoryEditor(`Dormant editor\n${text}`);
	const view = new MarkdownView(file, editor);
	views.push(view);
	view.mode = 'preview';
	assert.equal(await store.read(file, editor as unknown as Editor), text);
	await store.write(file, editor as unknown as Editor, baseline, withScale(circuit, 1.5));
	assert.equal(editor.transactions, 0);
	assert.equal(vault.writes, 1);
	assert.ok(!vault.text.includes('Dormant editor'));
});

void test('switching into an editor before save preserves its unsaved surrounding edits', async () => {
	const { circuit, text, file, vault, views, baseline, store } = setup();
	assert.equal(await store.read(file), text);
	const editor = new MemoryEditor(`New unsaved text\n${text}`);
	views.push(new MarkdownView(file, editor));
	await store.write(file, undefined, baseline, withScale(circuit, 1.5));
	assert.equal(editor.transactions, 1);
	assert.ok(editor.value.startsWith('New unsaved text\nBefore'));
	assert.equal(vault.writes, 0);
});

void test('block deletion transacts the authoritative editor and preserves unsaved surrounding text', async () => {
	const { text, file, vault, views, store } = setup();
	const block = scanCircuitBlocks(text)[0]!;
	const baseline = structuralBaseline(text, block);
	const editor = new MemoryEditor(`Unsaved text\n${text}`);
	views.push(new MarkdownView(file, editor));
	const result = await store.deleteBlock(file, editor as unknown as Editor, baseline);
	assert.equal(editor.transactions, 1);
	assert.equal(editor.lastChangeCount, 1);
	assert.equal(editor.value, `Unsaved text\n${text.slice(0, block.from)}${text.slice(block.to)}`);
	assert.equal(result.text, editor.value);
	assert.deepEqual(editor.selection, { line: 3, ch: 0 });
	assert.equal(result.cursorOffset, 'Unsaved text\n'.length + block.from);
	assert.equal(editor.focusCount, 1);
	assert.equal(scanCircuitBlocks(editor.value).length, 1);
	assert.equal(vault.writes, 0);
});

void test('line insertion puts the caret outside the fence in the same single editor transaction', async () => {
	for (const side of ['before', 'after'] as const) {
		const { text, file, vault, views, store } = setup();
		const first = scanCircuitBlocks(text)[0]!;
		const editor = new MemoryEditor(text);
		views.push(new MarkdownView(file, editor));
		const result = await store.insertBlockLine(file, editor as unknown as Editor, structuralBaseline(text, first), side);
		assert.equal(editor.transactions, 1);
		assert.equal(editor.lastChangeCount, 1);
		assert.deepEqual(editor.selection, { line: side === 'before' ? first.startLine : first.endLine + 1, ch: 0 });
		assert.equal(editor.value.split('\n')[editor.selection.line], '');
		assert.equal(editor.focusCount, 1);
		assert.equal(result.text, editor.value);
		assert.equal(editor.value.slice(result.block!.from, result.block!.to), text.slice(first.from, first.to));
		assert.equal(vault.writes, 0);
	}
});

void test('caret placement at an EOF fence is computed from the resulting document', async () => {
	const { circuit, file, vault, views, store } = setup();
	const text = blockFor(circuit).replaceAll('\n', '\r\n');
	const editor = new MemoryEditor(text);
	views.push(new MarkdownView(file, editor));
	const block = scanCircuitBlocks(text)[0]!;
	const result = await store.insertBlockLine(file, editor as unknown as Editor, structuralBaseline(text, block), 'after');
	assert.equal(editor.value, `${text}\r\n`);
	assert.equal(result.cursorOffset, editor.value.length);
	assert.deepEqual(editor.selection, { line: block.endLine + 1, ch: 0 });
	assert.equal(editor.transactions, 1);
	assert.equal(editor.focusCount, 1);
	assert.equal(vault.writes, 0);
});

void test('line insertion rejects mutation-time conflicts and leaves editor selection and focus unchanged', async () => {
	const { text, circuit, file, views, store } = setup();
	const baseline = structuralBaseline(text, scanCircuitBlocks(text)[0]!);
	const editor = new MemoryEditor(`${blockFor(circuit)}\n${text}`);
	views.push(new MarkdownView(file, editor));
	await assert.rejects(store.insertBlockLine(file, editor as unknown as Editor, baseline, 'before'), /cannot be distinguished/);
	assert.equal(editor.transactions, 0);
	assert.equal(editor.focusCount, 0);
	assert.equal(editor.selection, undefined);
});

void test('moving an editor block submits removal and insertion together as one undoable transaction', async () => {
	const { text, file, vault, views, store } = setup();
	const first = scanCircuitBlocks(text)[0]!;
	const editor = new MemoryEditor(text);
	views.push(new MarkdownView(file, editor));
	const result = await store.moveBlock(file, editor as unknown as Editor, structuralBaseline(text, first),
		{ offset: text.indexOf('After'), noteText: text });
	assert.equal(editor.transactions, 1);
	assert.equal(editor.lastChangeCount, 2);
	assert.equal(editor.value, result.text);
	const second = scanCircuitBlocks(text)[1]!;
	const firstRaw = text.slice(first.from, first.to);
	const secondRaw = text.slice(second.from, second.to);
	assert.equal(editor.value, `Before\n\n\nMiddle\n\n${secondRaw}\n\n${firstRaw}\nAfter`);
	assert.equal(scanCircuitBlocks(editor.value).at(-1)!.circuitId, first.circuitId);
	assert.equal(editor.value.slice(result.block!.from, result.block!.to), text.slice(first.from, first.to));
	assert.equal(vault.writes, 0);
});

void test('deleting a block rejects changed circuit data within the actual vault mutation', async () => {
	const { text, file, vault, store, circuit, baseline } = setup();
	const structural = structuralBaseline(text, scanCircuitBlocks(text)[0]!);
	const changed = updateCircuitBlock(text, baseline, withScale(circuit, 2)).text;
	vault.beforeProcess = () => { vault.text = changed; };
	await assert.rejects(store.deleteBlock(file, undefined, structural), /changed/);
	assert.equal(vault.writes, 0);
	assert.equal(vault.text, changed);
});

void test('moving a block rejects a shifted drop position within the actual vault mutation', async () => {
	const { text, file, vault, store } = setup();
	const baseline = structuralBaseline(text, scanCircuitBlocks(text)[0]!);
	vault.beforeProcess = () => { vault.text = `Added text\n${text}`; };
	await assert.rejects(store.moveBlock(file, undefined, baseline, { offset: 0, noteText: text }), /drop position/);
	assert.equal(vault.writes, 0);
	assert.equal(vault.text, `Added text\n${text}`);
});

void test('deleting a block refuses a newly pasted duplicate at mutation time', async () => {
	const { text, file, vault, store, circuit } = setup();
	const baseline = structuralBaseline(text, scanCircuitBlocks(text)[0]!);
	const changed = `${blockFor(circuit)}\n\n${text}`;
	vault.beforeProcess = () => { vault.text = changed; };
	await assert.rejects(store.deleteBlock(file, undefined, baseline), /cannot be distinguished/);
	assert.equal(vault.writes, 0);
	assert.equal(vault.text, changed);
});

void test('structural operations serialize with other note operations and relocate independent blocks', async () => {
	const { text, file, vault, store } = setup();
	const blocks = scanCircuitBlocks(text);
	await Promise.all(blocks.map((block) => store.deleteBlock(file, undefined, structuralBaseline(text, block))));
	assert.equal(vault.writes, 2);
	assert.equal(vault.text, 'Before\n\n\n\nMiddle\n\n\n\nAfter');
	assert.deepEqual(scanCircuitBlocks(vault.text), []);
});

void test('a no-op block drop creates no editor transaction and divergent panes forbid deletion', async () => {
	const { text, file, views, store } = setup();
	const block = scanCircuitBlocks(text)[0]!;
	const baseline = structuralBaseline(text, block);
	const first = new MemoryEditor(text);
	views.push(new MarkdownView(file, first));
	const result = await store.moveBlock(file, undefined, baseline, { offset: block.from, noteText: text });
	assert.equal(result.text, text);
	assert.equal(first.transactions, 0);
	const second = new MemoryEditor(`Unsaved text\n${text}`);
	views.push(new MarkdownView(file, second));
	await assert.rejects(store.deleteBlock(file, undefined, baseline), /different unsaved contents/);
	assert.equal(first.transactions, 0);
	assert.equal(second.transactions, 0);
});
