import { ChangeSet, Text } from '@codemirror/state';
import type { App, Editor, TFile as ObsidianFile } from 'obsidian';
import { MarkdownView, TFile } from './obsidian-stub';
import { SessionManager } from '../src/integration/session-manager';
import { newCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks } from '../src/storage/blocks';

interface Position { line: number; ch: number; }
class MemoryEditor {
	onChange: ((changes: ChangeSet) => void) | undefined;
	transactions = 0;
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
	transaction(transaction: { changes: { from: Position; to: Position; text: string }[] }): void {
		const changes = ChangeSet.of(transaction.changes.map(change => ({
			from: this.offset(change.from), to: this.offset(change.to), insert: change.text,
		})), this.value.length);
		this.value = changes.apply(importText(this.value)).toString();
		this.transactions += 1;
		this.onChange?.(changes);
	}
}

// Preserve CodeMirror's real change mapping when a guarded save rebuilds widgets.
export const importText = (value: string): Text => Text.of(value.split('\n'));
export const settle = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

export function setupSessionManager() {
	const circuit = newCircuit();
	const text = `Before\n\n\`\`\`logic-circuit\n${serializeCircuit(circuit)}\n\`\`\`\n\nAfter`;
	const file = new TFile('circuit.md') as unknown as ObsidianFile;
	const memory = new MemoryEditor(text);
	const editor = memory as unknown as Editor;
	const pane = new MarkdownView(file, editor);
	const views = [pane];
	const vault = { text, read: () => Promise.resolve(vault.text), process: (_file: unknown, action: (current: string) => string) => {
		vault.text = action(vault.text);
		return Promise.resolve(vault.text);
	} };
	const app = { vault, workspace: { iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => {
		for (const view of views) callback({ view });
	} } } as unknown as App;
	const manager = new SessionManager(app);
	const currentBlock = () => scanCircuitBlocks(memory.value)[0]!;
	const session = manager.open(file, pane, currentBlock(), editor);
	return { app, circuit, file, memory, editor, pane, manager, session, currentBlock, views };
}
