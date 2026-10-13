import { MarkdownView, Notice } from 'obsidian';
import type { Editor, MarkdownFileInfo, Plugin } from 'obsidian';
import { newCircuit } from '../model/circuit';
import type { LogicCircuitSettings } from '../settings';
import type { SessionManager } from './session-manager';
import { insertionForCircuit } from './insertion';

export function registerCircuitCommands(plugin: Plugin, manager: SessionManager, settings: () => LogicCircuitSettings): void {
	const noteView = (editor: Editor, info: MarkdownView | MarkdownFileInfo): MarkdownView | undefined => {
		if (info.file?.extension.toLowerCase() !== 'md') return undefined;
		const matches = (view: MarkdownView) => view.file === info.file && view.editor === editor
			&& view.getViewType() === 'markdown' && view.getMode() === 'source';
		if (info instanceof MarkdownView) return matches(info) ? info : undefined;
		let found: MarkdownView | undefined;
		plugin.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof MarkdownView && matches(leaf.view)) found = leaf.view;
		});
		return found;
	};
	const insert = (editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
		if (!noteView(editor, info)) return;
		if (!info.file) { new Notice('Save this note before inserting a circuit.'); return; }
		const circuit = newCircuit(settings().defaultScale);
		const cursor = editor.getCursor('head');
		const offset = editor.posToOffset(cursor);
		let insertion;
		try { insertion = insertionForCircuit(editor.getValue(), offset, circuit); }
		catch (reason) { new Notice(reason instanceof Error ? reason.message : 'The circuit cannot be inserted here.'); return; }
		manager.activateInserted(editor, circuit.circuitId);
		editor.replaceRange(insertion.text, cursor, cursor, 'logic-circuit');
		editor.setCursor(editor.offsetToPos(insertion.cursorOffset));
	};
	plugin.addCommand({ id: 'insert-logic-circuit', name: 'Insert logic circuit', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'L' }],
		editorCheckCallback: (checking, editor, info) => {
			if (!noteView(editor, info)) return false;
			if (!checking) insert(editor, info);
			return true;
		} });
	plugin.addCommand({ id: 'recover-circuit-drafts', name: 'Recover unsaved circuit drafts', callback: () => manager.showRecovery() });
	plugin.registerEvent(plugin.app.workspace.on('editor-menu', (menu, editor, info) => {
		if (!noteView(editor, info)) return;
		const file = info.file;
		menu.addItem((item) => item.setTitle('Insert logic circuit').setIcon('workflow').setSection('insert')
			.onClick(() => { if (info.file === file) insert(editor, info); }));
	}));
}
