import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet } from '@codemirror/state';
import { newCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks } from '../src/storage/blocks';
import { setupSessionManager as setup, importText, settle } from './session-manager-fixture';

void test('adding nodes preserves the editing session across its own save and fallback Markdown rendering', async () => {
	const { circuit, file, memory, editor, pane, manager, session, currentBlock } = setup();
	try {
		await session.startEditing();
		let rebuilt = false;
		memory.onChange = changes => {
			manager.mapEditor(editor, position => changes.mapPos(position, 1));
			const live = manager.open(file, pane, currentBlock(), editor);
			manager.reconcileEditor(editor, new Set([live]));
			assert.equal(live, session);
			const underlyingRender = manager.open(file, pane, currentBlock());
			assert.equal(underlyingRender, session);
			manager.refreshWorkspace();
			rebuilt = true;
		};
		session.commit({ ...circuit, nodes: [{ id: 'new-input', type: 'input', position: { x: 0, y: 0 }, label: 'A' }] });
		await manager.store.queue(file, () => Promise.resolve());
		await settle();
		assert.equal(rebuilt, true);
		assert.equal(session.host.editor, editor);
		assert.equal(session.getSnapshot().editing, true);
		assert.equal(session.getSnapshot().saving, false);
		assert.equal(session.getSnapshot().conflict, false);
		assert.equal(session.getSnapshot().circuit?.nodes.length, 1);
	} finally { manager.dispose(); }
});

void test('reacquiring a widget during a pending save cancels the old asynchronous close', async () => {
	const { circuit, file, editor, pane, manager, session, currentBlock } = setup();
	try {
		await session.startEditing();
		const releaseWidget = manager.mount(session, () => undefined);
		let resume: (() => void) | undefined;
		const gate = new Promise<void>(resolve => { resume = resolve; });
		void manager.store.queue(file, () => gate);
		session.commit({ ...circuit, view: { preferredScale: 1.5 } });
		manager.reconcileEditor(editor, new Set());
		releaseWidget();
		const replacement = manager.open(file, pane, currentBlock(), editor);
		assert.equal(replacement, session);
		manager.mount(replacement, () => undefined);
		manager.reconcileEditor(editor, new Set([replacement]));
		resume!();
		await manager.store.queue(file, () => Promise.resolve());
		await settle();
		assert.equal(session.getSnapshot().editing, true);
		assert.equal(session.getSnapshot().saving, false);
		assert.equal(manager.open(file, pane, currentBlock(), editor), session);
	} finally { manager.dispose(); }
});

void test('mapping a preceding note insertion preserves the exact session and its draft', async () => {
	const { file, memory, editor, pane, manager, session, currentBlock } = setup();
	try {
		await session.startEditing();
		const changes = ChangeSet.of({ from: 0, insert: 'New text\n\n' }, memory.value.length);
		memory.value = changes.apply(importText(memory.value)).toString();
		manager.mapEditor(editor, position => changes.mapPos(position, 1));
		const shifted = manager.open(file, pane, currentBlock(), editor);
		manager.reconcileEditor(editor, new Set([shifted]));
		await settle();
		assert.equal(shifted, session);
		assert.equal(session.getSnapshot().editing, true);
		assert.equal(session.getSnapshot().conflict, false);
	} finally { manager.dispose(); }
});

void test('a stale CodeMirror view cannot close the replacement that reuses its editor', async () => {
	const { editor, manager, session } = setup();
	try {
		const releasePrevious = manager.retainEditor(editor);
		await session.startEditing();
		const releaseCurrent = manager.retainEditor(editor);
		releasePrevious();
		await settle();
		assert.equal(session.getSnapshot().editing, true);
		releaseCurrent();
		await settle();
		assert.equal(session.getSnapshot().editing, false);
	} finally { manager.dispose(); }
});

void test('leaving the editor still closes and disposes an unreferenced session', async () => {
	const { file, editor, pane, manager, session, currentBlock } = setup();
	try {
		await session.startEditing();
		const releaseWidget = manager.mount(session, () => undefined);
		manager.closeEditor(editor);
		releaseWidget();
		await settle();
		assert.equal(session.getSnapshot().editing, false);
		const reopened = manager.open(file, pane, currentBlock(), editor);
		assert.notEqual(reopened, session);
		assert.equal(reopened.getSnapshot().editing, false);
	} finally { manager.dispose(); }
});

void test('switching from Live Preview to Reading view releases the dormant editor host', async () => {
	const { file, editor, pane, manager, session, currentBlock } = setup();
	try {
		await session.startEditing();
		manager.reconcileEditor(editor, new Set());
		pane.mode = 'preview';
		const reading = manager.open(file, pane, currentBlock());
		await settle();
		assert.equal(reading, session);
		assert.equal(reading.host.editor, undefined);
		manager.refreshWorkspace();
		assert.equal(reading.getSnapshot().conflict, false);
	} finally { manager.dispose(); }
});

void test('moving a unique circuit preserves its editor and never assigns its session to a neighbouring block', async () => {
	const { circuit, file, memory, editor, pane, manager, session } = setup();
	try {
		const otherCircuit = newCircuit();
		const first = scanCircuitBlocks(memory.value)[0]!;
		const otherFence = `\`\`\`logic-circuit\n${serializeCircuit(otherCircuit)}\n\`\`\``;
		memory.value = memory.value.slice(0, first.to) + `\n\n${otherFence}` + memory.value.slice(first.to);
		const [beforeFirst, beforeSecond] = scanCircuitBlocks(memory.value);
		const otherSession = manager.open(file, pane, beforeSecond!, editor);
		await session.startEditing();
		const fence = memory.value.slice(beforeFirst!.from, beforeFirst!.to);
		const insertion = beforeSecond!.to + 2;
		const changes = ChangeSet.of([
			{ from: beforeFirst!.from, to: beforeSecond!.from },
			{ from: insertion, insert: `${fence}\n\n` },
		], memory.value.length);
		memory.value = changes.apply(importText(memory.value)).toString();
		manager.mapEditor(editor, position => changes.mapPos(position, 1));
		const [afterFirst, afterSecond] = scanCircuitBlocks(memory.value);
		// Both old fence starts now map to the neighbour's opening. Position alone
		// cannot identify which session belongs to that block.
		assert.equal(session.from, afterFirst!.from);
		assert.equal(otherSession.from, afterFirst!.from);
		const renderedNeighbour = manager.open(file, pane, afterFirst!, editor, undefined, true);
		const moved = manager.open(file, pane, afterSecond!, editor, undefined, true);
		manager.reconcileEditor(editor, new Set([renderedNeighbour, moved]));
		await settle();
		assert.equal(renderedNeighbour, otherSession);
		assert.equal(moved, session);
		assert.equal(moved.circuitId, circuit.circuitId);
		assert.equal(moved.from, afterSecond!.from);
		assert.equal(moved.getSnapshot().editing, true);
		assert.equal(moved.getSnapshot().conflict, false);
		assert.ok(memory.value.startsWith('Before\n\n'));
		assert.ok(memory.value.endsWith('\n\nAfter'));
	} finally { manager.dispose(); }
});

void test('position-based copied occurrences remain separate without unique-ID relocation', async () => {
	const { file, memory, editor, pane, manager, session } = setup();
	try {
		const first = scanCircuitBlocks(memory.value)[0]!;
		const fence = memory.value.slice(first.from, first.to);
		memory.value += `\n\n${fence}`;
		const blocks = scanCircuitBlocks(memory.value);
		const copied = manager.open(file, pane, blocks[1]!, editor);
		assert.notEqual(copied, session);
		assert.equal(copied.circuitId, session.circuitId);
		const changes = ChangeSet.of({ from: 0, insert: 'Heading\n' }, memory.value.length);
		memory.value = changes.apply(importText(memory.value)).toString();
		manager.mapEditor(editor, position => changes.mapPos(position, 1));
		const shifted = scanCircuitBlocks(memory.value);
		assert.equal(manager.open(file, pane, shifted[0]!, editor), session);
		assert.equal(manager.open(file, pane, shifted[1]!, editor), copied);
	} finally { manager.dispose(); }
});

void test('reidentifying a copied circuit retains its session during the synchronous editor transaction', async () => {
	const { circuit, file, memory, editor, pane, manager, session } = setup();
	try {
		const first = scanCircuitBlocks(memory.value)[0]!;
		memory.value += `\n\n${memory.value.slice(first.from, first.to)}`;
		const copiedBlock = scanCircuitBlocks(memory.value)[1]!;
		const copied = manager.open(file, pane, copiedBlock, editor);
		let activeRender = session;
		memory.onChange = changes => {
			manager.mapEditor(editor, position => changes.mapPos(position, 1));
			const blocks = scanCircuitBlocks(memory.value);
			activeRender = manager.open(file, pane, blocks[0]!, editor, undefined, true);
			const duplicateRender = manager.open(file, pane, blocks[1]!, editor, undefined, true);
			assert.equal(duplicateRender, copied);
			manager.reconcileEditor(editor, new Set([activeRender, duplicateRender]));
		};
		await session.startEditing();
		await settle();
		assert.equal(activeRender, session);
		assert.notEqual(session.circuitId, circuit.circuitId);
		assert.equal(session.getSnapshot().editing, true);
		assert.equal(session.getSnapshot().conflict, false);
		assert.equal(copied.circuitId, circuit.circuitId);
	} finally { manager.dispose(); }
});
