import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFile as ObsidianFile } from 'obsidian';
import { MarkdownView, TFile } from './obsidian-stub';
import { newCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks } from '../src/storage/blocks';
import { setupSessionManager as setup, settle } from './session-manager-fixture';

void test('a reopened circuit starts unselected without cross-session selection memory or saves', async () => {
	const { file, memory, editor, pane, manager, session, currentBlock } = setup();
	try {
		session.setBlockSelected(true);
		manager.closeEditor(editor);
		await settle();
		const reopened = manager.open(file, pane, currentBlock(), editor, undefined, true);
		assert.notEqual(reopened, session);
		assert.equal(reopened.getSnapshot().blockSelected, false);
		assert.equal(reopened.hasDraft, false);
		assert.equal(reopened.getSnapshot().canUndo, false);
		assert.equal(memory.transactions, 0);
	} finally { manager.dispose(); }
});

void test('selecting another current block deselects only its peers in the same note pane', () => {
	const { file, memory, editor, pane, manager, session, currentBlock } = setup();
	try {
		const otherFile = new TFile('another.md') as unknown as ObsidianFile;
		const otherPane = new MarkdownView(file, editor);
		const anotherNote = manager.open(otherFile, pane, currentBlock(), editor);
		const anotherPane = manager.open(file, otherPane, currentBlock(), editor);
		anotherNote.setBlockSelected(true);
		anotherPane.setBlockSelected(true);
		session.setBlockSelected(true);
		memory.value += `\n\n\`\`\`logic-circuit\n${serializeCircuit(newCircuit())}\n\`\`\``;
		const second = manager.open(file, pane, scanCircuitBlocks(memory.value)[1]!, editor);
		second.setBlockSelected(true);
		assert.equal(session.getSnapshot().blockSelected, false);
		assert.equal(second.getSnapshot().blockSelected, true);
		assert.equal(anotherNote.getSnapshot().blockSelected, true);
		assert.equal(anotherPane.getSnapshot().blockSelected, true);
		manager.clearBlockSelection(editor, file);
		assert.equal(second.getSnapshot().blockSelected, false);
		assert.equal(anotherNote.getSnapshot().blockSelected, true);
		assert.equal(anotherPane.getSnapshot().blockSelected, true);
		assert.equal(memory.transactions, 0);
	} finally { manager.dispose(); }
});
