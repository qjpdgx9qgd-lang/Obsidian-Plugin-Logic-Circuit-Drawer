import test from 'node:test';
import assert from 'node:assert/strict';
import type { App, Editor, EditorPosition, EditorTransaction, TFile as HostFile } from 'obsidian';
import { MarkdownView, Menu, Notice, TFile } from './obsidian-stub';
import { newCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks } from '../src/storage/blocks';
import { NoteStore } from '../src/integration/note-store';
import { CircuitSession } from '../src/integration/session';
import { circuitBlockActions } from '../src/integration/block-actions';

const settled = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(reading = false) {
	const circuit = newCircuit();
	const raw = `\`\`\`logic-circuit\n${serializeCircuit(circuit)}\n\`\`\``;
	const original = `Before\n${raw}\nAfter`;
	let text = original;
	let focusCount = 0;
	let transactions = 0;
	let selection: EditorPosition | undefined;
	const offset = (position: EditorPosition) => text.split('\n').slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
	const editor = {
		getValue: () => text,
		offsetToPos: (value: number) => { const lines = text.slice(0, value).split('\n'); return { line: lines.length - 1, ch: lines.at(-1)!.length }; },
		focus: () => { focusCount++; },
		transaction: (spec: EditorTransaction) => {
			for (const change of [...(spec.changes ?? [])].reverse()) {
				const from = offset(change.from); const to = offset(change.to ?? change.from);
				text = text.slice(0, from) + change.text + text.slice(to);
			}
			selection = spec.selection?.from; transactions++;
		},
	} as unknown as Editor;
	const file = new TFile('Block.md');
	const view = new MarkdownView(file, editor);
	if (reading) view.mode = 'preview';
	const app = { workspace: { iterateAllLeaves: (visit: (leaf: { view: MarkdownView }) => void) => visit({ view }) },
		vault: { read: () => Promise.resolve(text), process: (_file: unknown, mutate: (current: string) => string) => { text = mutate(text); return Promise.resolve(text); } },
	} as unknown as App;
	const store = new NoteStore(app);
	const session = new CircuitSession({ store, file: file as unknown as HostFile, editor: reading ? undefined : editor,
		activate: () => Promise.resolve() }, scanCircuitBlocks(text)[0]!);
	return { raw, original, session, text: () => text, change: (value: string) => { text = value; },
		focusCount: () => focusCount, transactions: () => transactions, selection: () => selection };
}

void test('block context menu inserts exactly one line before or after, with an undoable caret and menu-close callback', async () => {
	for (const side of ['before', 'after'] as const) {
		const f = fixture();
		await f.session.startEditing(); f.session.setBlockSelected(true);
		const actions = circuitBlockActions(f.session);
		let closed = 0;
		actions.menu({} as MouseEvent, () => {}, () => { closed++; });
		const menu = Menu.last!;
		assert.deepEqual(menu.items.map(item => item.title), ['Insert line before', 'Insert line after', 'Delete circuit block']);
		menu.hide();
		assert.equal(closed, 1);
		menu.items.find(item => item.title === `Insert line ${side}`)!.action?.();
		await settled();
		assert.equal(f.text(), side === 'before' ? `Before\n\n${f.raw}\nAfter` : `Before\n${f.raw}\n\nAfter`);
		assert.equal(f.transactions(), 1);
		assert.equal(f.focusCount(), 1);
		assert.equal(f.text().split('\n')[f.selection()!.line], '');
		assert.equal(f.session.getSnapshot().blockSelected, false);
		assert.equal(f.session.getSnapshot().editing, false);
	}
});

void test('block context deletion focuses the surviving blank line without changing surrounding text', async () => {
	const f = fixture();
	await circuitBlockActions(f.session).remove();
	assert.equal(f.text(), 'Before\n\nAfter');
	assert.deepEqual(f.selection(), { line: 1, ch: 0 });
	assert.equal(f.transactions(), 1);
	assert.equal(f.focusCount(), 1);
});

void test('line insertion from Reading view preserves the fence and never focuses its dormant editor', async () => {
	const f = fixture(true);
	circuitBlockActions(f.session).menu({} as MouseEvent, () => {});
	Menu.last!.items.find(item => item.title === 'Insert line after')!.action?.();
	await settled();
	assert.equal(f.text(), `Before\n${f.raw}\n\nAfter`);
	assert.equal(f.transactions(), 0);
	assert.equal(f.focusCount(), 0);
	assert.equal(f.selection(), undefined);
});

void test('context line insertion reports a changed-fence conflict and preserves the original editor state', async () => {
	const f = fixture();
	await f.session.startEditing();
	const changed = f.original.replace('"preferredScale": 1', '"preferredScale": 2');
	f.change(changed);
	Notice.messages.length = 0;
	circuitBlockActions(f.session).menu({} as MouseEvent, () => {});
	Menu.last!.items.find(item => item.title === 'Insert line before')!.action?.();
	await settled();
	assert.equal(f.text(), changed);
	assert.equal(f.transactions(), 0);
	assert.equal(f.focusCount(), 0);
	assert.equal(f.selection(), undefined);
	assert.equal(f.session.getSnapshot().editing, true);
	assert.match(Notice.messages.at(-1)!, /changed in the note/);
});

void test('a stale block menu cannot insert, remove, or move after its host becomes read-only', async () => {
	const f = fixture();
	let editable = true;
	let removeCalls = 0;
	let moveCalls = 0;
	const actions = circuitBlockActions(f.session, () => { moveCalls++; }, undefined, () => editable);
	actions.menu({} as MouseEvent, () => { removeCalls++; });
	const menu = Menu.last!;
	editable = false;
	for (const item of menu.items) item.action?.();
	await actions.remove();
	actions.move?.({} as DragEvent);
	await settled();
	assert.equal(f.text(), f.original);
	assert.equal(f.transactions(), 0);
	assert.equal(f.focusCount(), 0);
	assert.equal(removeCalls, 0);
	assert.equal(moveCalls, 0);
});

void test('a mode change while a block action waits for saves cancels its pending structural edit', async () => {
	for (const action of ['remove', 'line'] as const) {
		const f = fixture();
		let editable = true;
		let release = () => {};
		const pending = new Promise<void>(resolve => { release = resolve; });
		f.session.flush = () => pending;
		const actions = circuitBlockActions(f.session, undefined, undefined, () => editable);
		let removing: Promise<void> | undefined;
		if (action === 'remove') removing = actions.remove();
		else {
			actions.menu({} as MouseEvent, () => {});
			Menu.last!.items.find(item => item.title === 'Insert line after')!.action?.();
		}
		editable = false; release();
		await removing; await settled();
		assert.equal(f.text(), f.original);
		assert.equal(f.transactions(), 0);
		assert.equal(f.focusCount(), 0);
	}
});
