import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitSession } from '../src/integration/session';
import type { SessionHost } from '../src/integration/session';
import type { NoteStore, BlockBaseline } from '../src/integration/note-store';
import type { CircuitData } from '../src/model/types';
import { newCircuit, parseCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks, updateCircuitBlock } from '../src/storage/blocks';

class MemoryStore {
	text: string;
	writes = 0;
	private tail: Promise<unknown> = Promise.resolve();
	constructor(circuit: CircuitData) {
		this.text = `Before\n\n\`\`\`logic-circuit\n${serializeCircuit(circuit)}\n\`\`\`\n\nAfter`;
	}
	queue<T>(_file: unknown, action: () => Promise<T>): Promise<T> {
		const next = this.tail.catch(() => undefined).then(action);
		this.tail = next;
		return next;
	}
	read(): Promise<string> { return Promise.resolve(this.text); }
	write(_file: unknown, _editor: unknown, baseline: BlockBaseline, circuit: CircuitData) {
		const result = updateCircuitBlock(this.text, baseline, circuit);
		this.text = result.text;
		this.writes++;
		return Promise.resolve(result.block);
	}
}
function setup() {
	const circuit = newCircuit();
	const store = new MemoryStore(circuit);
	const host = { store: store as unknown as NoteStore, file: {}, activate: () => Promise.resolve() } as unknown as SessionHost;
	const block = scanCircuitBlocks(store.text)[0]!;
	return { session: new CircuitSession(host, block), store, circuit };
}
const withScale = (circuit: CircuitData, scale: number): CircuitData => ({ ...circuit, view: { preferredScale: scale } });

void test('completed actions save in order and Done waits for all writes', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	session.commit(withScale(circuit, 1.2));
	session.commit(withScale(circuit, 1.4));
	session.commit(withScale(circuit, 1.6));
	assert.equal(session.getSnapshot().saving, true);
	await session.finish();
	assert.equal(store.writes, 3);
	assert.equal(parseCircuit(scanCircuitBlocks(store.text)[0]!.content).view.preferredScale, 1.6);
	assert.equal(session.getSnapshot().saving, false);
	assert.equal(session.getSnapshot().editing, false);
	assert.ok(store.text.startsWith('Before\n\n'));
	assert.ok(store.text.endsWith('\n\nAfter'));
});

void test('a shifted block saves without changing surrounding edits', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	store.text = `New heading\n\n${store.text}`;
	session.commit(withScale(circuit, 1.5));
	await session.finish();
	assert.ok(store.text.startsWith('New heading\n\nBefore'));
	assert.equal(store.writes, 1);
});

void test('conflict prevents overwrite, retains latest draft, and stops queued writes', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	const block = scanCircuitBlocks(store.text)[0]!;
	store.text = updateCircuitBlock(store.text, { circuitId: circuit.circuitId, content: block.content }, withScale(circuit, 2)).text;
	const externalText = store.text;
	session.commit(withScale(circuit, 1.2));
	session.commit(withScale(circuit, 1.4));
	await assert.rejects(session.finish());
	assert.equal(store.text, externalText);
	assert.equal(store.writes, 0);
	assert.equal(session.getSnapshot().conflict, true);
	assert.equal(session.getSnapshot().circuit?.view.preferredScale, 1.4);
	assert.equal(session.getSnapshot().editing, true);
	assert.equal(session.hasDraft, true);
});

void test('explicit reload replaces conflicted draft and resets action history', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	const block = scanCircuitBlocks(store.text)[0]!;
	store.text = updateCircuitBlock(store.text, { circuitId: circuit.circuitId, content: block.content }, withScale(circuit, 2)).text;
	session.commit(withScale(circuit, 1.5));
	await assert.rejects(session.finish());
	await session.reload();
	assert.equal(session.getSnapshot().conflict, false);
	assert.equal(session.getSnapshot().circuit?.view.preferredScale, 2);
	assert.equal(session.getSnapshot().canUndo, false);
});

void test('editing one copied occurrence establishes an independent ID', async () => {
	const { session, store, circuit } = setup();
	const original = store.text;
	store.text += `\n\n${original}`;
	await session.startEditing();
	assert.equal(session.getSnapshot().conflict, false);
	assert.notEqual(session.circuitId, circuit.circuitId);
	const blocks = scanCircuitBlocks(store.text);
	assert.equal(blocks[0]!.circuitId, session.circuitId);
	assert.equal(blocks[1]!.circuitId, circuit.circuitId);
	assert.equal(blocks[1]!.content, scanCircuitBlocks(original)[0]!.content);
	session.commit(withScale(session.getSnapshot().circuit!, 1.5));
	await session.finish();
	assert.equal(scanCircuitBlocks(store.text)[1]!.content, blocks[1]!.content);
});

void test('deleted blocks preserve the draft and cannot be recovered by reload', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	store.text = 'Circuit removed by another editor.';
	session.commit(withScale(circuit, 1.5));
	await assert.rejects(session.finish());
	await session.reload();
	assert.equal(store.text, 'Circuit removed by another editor.');
	assert.equal(session.getSnapshot().conflict, true);
	assert.equal(session.getSnapshot().circuit?.view.preferredScale, 1.5);
});

void test('undo and redo are persisted completed actions', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	session.commit(withScale(circuit, 1.5));
	session.undo();
	await session.finish();
	assert.equal(parseCircuit(scanCircuitBlocks(store.text)[0]!.content).view.preferredScale, 1);
	assert.equal(session.getSnapshot().canRedo, true);
	session.redo();
	await session.finish();
	assert.equal(parseCircuit(scanCircuitBlocks(store.text)[0]!.content).view.preferredScale, 1.5);
});

void test('an identical copy pasted after editing starts cannot use a stale Reading location', async () => {
	const { session, store, circuit } = setup();
	const renderedText = store.text;
	const renderedFrom = session.from;
	session.host.locate = text => text === renderedText ? renderedFrom : undefined;
	await session.startEditing();
	store.text = `${renderedText}\n\n${renderedText}`;
	const pasted = store.text;
	session.commit(withScale(circuit, 1.5));
	await assert.rejects(session.finish());
	assert.equal(store.text, pasted);
	assert.equal(store.writes, 0);
	assert.equal(session.getSnapshot().circuit?.view.preferredScale, 1.5);
	assert.equal(session.getSnapshot().conflict, true);
});

void test('a mapped Live Preview occurrence gets a new ID after a copy is pasted before it', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	const original = store.text;
	store.text = `${original}\n\n${original}`;
	session.mapPosition(position => position + original.length + 2);
	session.commit(withScale(circuit, 1.5));
	await session.finish();
	const blocks = scanCircuitBlocks(store.text);
	assert.equal(blocks[0]!.circuitId, circuit.circuitId);
	assert.equal(blocks[0]!.content, scanCircuitBlocks(original)[0]!.content);
	assert.notEqual(blocks[1]!.circuitId, circuit.circuitId);
	assert.equal(parseCircuit(blocks[1]!.content).view.preferredScale, 1.5);
});

void test('Done waits for an in-flight opening and leaves the editor closed', async () => {
	const { session } = setup();
	let activate: (() => void) | undefined;
	session.host.activate = () => new Promise<void>(resolve => { activate = resolve; });
	const opening = session.startEditing();
	const finishing = session.finish();
	activate!();
	await Promise.all([opening, finishing]);
	assert.equal(session.getSnapshot().editing, false);
});

void test('block selection publishes to every mount without history, saves or drafts and survives Done', async () => {
	const { session, store } = setup();
	const firstMount: boolean[] = [];
	const secondMount: boolean[] = [];
	const releaseFirst = session.subscribe(() => firstMount.push(session.getSnapshot().blockSelected));
	const releaseSecond = session.subscribe(() => secondMount.push(session.getSnapshot().blockSelected));
	assert.equal(session.getSnapshot().blockSelected, false);
	session.setBlockSelected(true);
	session.setBlockSelected(true);
	assert.deepEqual(firstMount, [true]);
	assert.deepEqual(secondMount, [true]);
	assert.equal(session.hasDraft, false);
	assert.equal(session.getSnapshot().canUndo, false);
	await session.startEditing();
	await session.finish();
	assert.equal(session.getSnapshot().blockSelected, true);
	assert.equal(store.writes, 0);
	session.setBlockSelected(false);
	assert.equal(firstMount.at(-1), false);
	assert.equal(secondMount.at(-1), false);
	releaseFirst(); releaseSecond(); session.dispose();
});

void test('rejected action errors can be dismissed without changing the diagram, history or note', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	const original = store.text;
	session.commit(withScale(circuit, 0));
	const firstActionErrorId = session.getSnapshot().actionErrorId;
	assert.equal(session.hasTransientError, true);
	assert.match(session.getSnapshot().error ?? '', /scale must be between/);
	session.commit(withScale(circuit, 0));
	assert.equal(session.getSnapshot().actionErrorId, firstActionErrorId + 1, 'identical rejected actions reset their notification deadline');
	session.dismissTransientError(firstActionErrorId);
	assert.equal(session.hasTransientError, true, 'an older notification timer cannot dismiss a newer action error');
	assert.equal(session.getSnapshot().editing, true);
	assert.equal(session.getSnapshot().conflict, false);
	assert.equal(session.getSnapshot().canUndo, false);
	assert.deepEqual(session.getSnapshot().circuit, circuit);
	session.dismissTransientError();
	assert.equal(session.hasTransientError, false);
	assert.equal(session.getSnapshot().error, null);
	assert.equal(session.hasDraft, false);
	assert.equal(store.text, original);
	assert.equal(store.writes, 0);
	session.commit(withScale(circuit, 1.5));
	await session.finish();
	assert.equal(store.writes, 1);
	assert.equal(session.getSnapshot().editing, false);
});

void test('a later save conflict cannot be hidden by an earlier transient-error dismissal', async () => {
	const { session, store, circuit } = setup();
	await session.startEditing();
	session.commit(withScale(circuit, 0));
	assert.equal(session.hasTransientError, true);
	const block = scanCircuitBlocks(store.text)[0]!;
	store.text = updateCircuitBlock(store.text, { circuitId: circuit.circuitId, content: block.content }, withScale(circuit, 2)).text;
	const externallyChanged = store.text;
	session.commit(withScale(circuit, 1.5));
	await assert.rejects(session.finish());
	const error = session.getSnapshot().error;
	session.dismissTransientError();
	assert.equal(session.hasTransientError, false);
	assert.equal(session.getSnapshot().error, error);
	assert.equal(session.getSnapshot().conflict, true);
	assert.equal(session.getSnapshot().editing, true, 'outside-click Done must not hide a conflicted draft');
	assert.equal(session.hasDraft, true);
	session.commit(withScale(circuit, 1.8));
	assert.equal(store.text, externallyChanged);
	assert.equal(store.writes, 0);
	assert.equal(session.getSnapshot().circuit?.view.preferredScale, 1.5);
});

void test('malformed-data errors remain visible when transient action errors are dismissed', () => {
	const { session, store } = setup();
	store.text = 'Before\n\n```logic-circuit\n{broken\n```\n\nAfter';
	const source = store.text;
	const malformed = new CircuitSession(session.host, scanCircuitBlocks(source)[0]!);
	const error = malformed.getSnapshot().error;
	malformed.dismissTransientError();
	assert.equal(malformed.hasTransientError, false);
	assert.equal(malformed.getSnapshot().error, error);
	assert.equal(malformed.getSnapshot().circuit, null);
	assert.equal(store.text, source);
	assert.equal(store.writes, 0);
});
