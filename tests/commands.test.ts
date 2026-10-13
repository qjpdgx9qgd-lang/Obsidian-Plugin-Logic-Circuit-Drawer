import test from 'node:test';
import assert from 'node:assert/strict';
import type { Command, Editor, MarkdownFileInfo, MarkdownView as HostView, Menu, Plugin } from 'obsidian';
import { MarkdownView, TFile } from './obsidian-stub';
import { registerCircuitCommands } from '../src/integration/commands';
import type { SessionManager } from '../src/integration/session-manager';
import { parseCircuit } from '../src/model/circuit';
import { scanCircuitBlocks } from '../src/storage/blocks';

type Context = HostView | MarkdownFileInfo;
class Item {
	title = ''; section = ''; action: (() => void) | undefined;
	setTitle(value: string) { this.title = value; return this; }
	setIcon(_value: string) { return this; }
	setSection(value: string) { this.section = value; return this; }
	onClick(action: () => void) { this.action = action; return this; }
}
function fixture(extension = 'md') {
	let text = '# Test\n';
	const editor = {
		getValue: () => text, getCursor: () => ({ line: 1, ch: 0 }), posToOffset: () => text.length,
		offsetToPos: () => ({ line: 1, ch: 0 }), setCursor: () => {},
		replaceRange: (insert: string) => { text += insert; },
	} as unknown as Editor;
	const file = new TFile(`Test.${extension}`);
	const view = new MarkdownView(file, editor);
	const commands: Command[] = [];
	let menuCallback: (menu: Menu, editor: Editor, info: Context) => void = () => {};
	const leaves = [{ view }];
	const plugin = {
		app: { workspace: {
			iterateAllLeaves: (callback: (leaf: typeof leaves[number]) => void) => leaves.forEach(callback),
			on: (_name: string, callback: typeof menuCallback) => { menuCallback = callback; },
		} },
		addCommand: (command: Command) => { commands.push(command); }, registerEvent: () => {},
	} as unknown as Plugin;
	let activations = 0; let recoveries = 0;
	const manager = { activateInserted: () => { activations++; }, showRecovery: () => { recoveries++; } } as unknown as SessionManager;
	registerCircuitCommands(plugin, manager, () => ({ defaultScale: 1.25 }));
	const context = view as unknown as HostView;
	const menu = (info: Context = context, target: Editor = editor) => {
		const items: Item[] = [];
		menuCallback({ addItem: (build: (item: Item) => void) => { const item = new Item(); build(item); items.push(item); } } as unknown as Menu, target, info);
		return items;
	};
	return { editor, view, file, context, commands, menu, text: () => text, activations: () => activations, recoveries: () => recoveries };
}

void test('insertion and recovery stay separate commands with only insertion receiving the default Mod shortcut', () => {
	const f = fixture();
	assert.deepEqual(f.commands.map(command => command.id), ['insert-logic-circuit', 'recover-circuit-drafts']);
	assert.deepEqual(f.commands[0]!.hotkeys, [{ modifiers: ['Mod', 'Shift'], key: 'L' }]);
	assert.equal(f.commands[1]!.hotkeys, undefined);
	f.commands[1]!.callback?.();
	assert.equal(f.recoveries(), 1);
});

void test('the note menu groups insertion with insert actions and applies the configured scale', () => {
	const f = fixture();
	const items = f.menu();
	assert.equal(items.length, 1);
	assert.equal(items[0]!.title, 'Insert logic circuit');
	assert.equal(items[0]!.section, 'insert');
	items[0]!.action?.();
	const blocks = scanCircuitBlocks(f.text());
	assert.equal(blocks.length, 1);
	assert.equal(parseCircuit(blocks[0]!.content).view.preferredScale, 1.25);
	assert.equal(f.activations(), 1);
});

void test('Canvas, other files, Reading view and fileless contexts have neither an insertion item nor an enabled command', () => {
	for (const extension of ['canvas', 'pdf', 'base']) {
		const f = fixture(extension);
		assert.deepEqual(f.menu(), []);
		assert.equal(f.commands[0]!.editorCheckCallback?.(true, f.editor, f.context), false);
	}
	const f = fixture();
	f.view.mode = 'preview';
	assert.deepEqual(f.menu(), []);
	assert.equal(f.commands[0]!.editorCheckCallback?.(false, f.editor, f.context), false);
	f.view.mode = 'source'; f.view.file = null;
	assert.deepEqual(f.menu(), []);
	assert.equal(scanCircuitBlocks(f.text()).length, 0);
});

void test('plain Markdown contexts resolve the exact note editor without using the active pane', () => {
	const f = fixture();
	const plain = { file: f.file } as unknown as MarkdownFileInfo;
	assert.equal(f.menu(plain).length, 1);
	assert.equal(f.menu(plain, {} as Editor).length, 0);
	const before = f.text();
	assert.equal(f.commands[0]!.editorCheckCallback?.(true, f.editor, plain), true);
	assert.equal(f.text(), before, 'checking a command must never insert');
	assert.equal(f.commands[0]!.editorCheckCallback?.(false, f.editor, plain), true);
	assert.equal(scanCircuitBlocks(f.text()).length, 1);
});

void test('an old note menu cannot insert after its pane navigates or stops editing', () => {
	const f = fixture();
	const item = f.menu()[0]!;
	f.view.file = new TFile('Other.md');
	item.action?.();
	assert.equal(scanCircuitBlocks(f.text()).length, 0);
	f.view.file = f.file;
	const readingItem = f.menu()[0]!;
	f.view.mode = 'preview'; readingItem.action?.();
	assert.equal(scanCircuitBlocks(f.text()).length, 0);
});
