import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, historyKeymap, undo } from '@codemirror/commands';
import type { App, Editor, EditorChange, EditorPosition, EditorTransaction, MarkdownPostProcessorContext, TFile } from 'obsidian';
import { editorInfoField, editorLivePreviewField, MarkdownView, TFile as BrowserFile } from './browser-obsidian';
import { livePreviewExtension } from '../src/integration/live-preview';
import { SessionManager } from '../src/integration/session-manager';
import { renderReadingCircuit } from '../src/integration/reading-view';
import { ReadingBlockDrag } from '../src/integration/reading-block-drag';
import { mountCircuit } from '../src/ui/mount';
import { newCircuit, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks } from '../src/storage/blocks';
import { verifyDetachedReading } from './reading-lifecycle-fixtures';

const first = { ...newCircuit(), circuitId: 'first-circuit', nodes: [{ id: 'original-and', type: 'and' as const, position: { x: 64, y: 0 } }] };
const second = { ...newCircuit(), circuitId: 'second-circuit', nodes: [{ id: 'keep-output', type: 'output' as const, label: 'Keep me', position: { x: 64, y: 0 } }] };
const fence = (data: typeof first | typeof second) => `\`\`\`logic-circuit\n${serializeCircuit(data)}\n\`\`\``;
const initial = `# Browser integration\n\nBefore first circuit.\n\n${fence(first)}\n\nBetween circuit blocks.\n\n${fence(second)}\n\nAfter second circuit.\n\nDrop target paragraph.\n`;
const container = document.getElementById('editor')!;
const file = new BrowserFile('Browser integration.md');
const otherFile = new BrowserFile('Other note.md');
let savedNote = '';
const transactions: { before: string; after: string; changes: number; origin: string }[] = [];
const dragEvents: { type: string; target: string | null; types: string[]; x: number; y: number }[] = [];
for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) document.addEventListener(type, event => {
	const drag = event as DragEvent;
	const target = (event.target as Element).closest('button') ?? event.target as Element;
	const label = target.getAttribute('aria-labelledby')?.split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ');
	dragEvents.push({ type, target: label ?? target.getAttribute('aria-label') ?? target.getAttribute('class'), types: [...(drag.dataTransfer?.types ?? [])], x: drag.clientX, y: drag.clientY });
}, true);
class BrowserEditor {
	cm!: EditorView;
	getValue() { return this.cm.state.doc.toString(); }
	focus() { this.cm.focus(); }
	offsetToPos(offset: number): EditorPosition { const line = this.cm.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; }
	posToOffset(position: EditorPosition) { return this.cm.state.doc.line(position.line + 1).from + position.ch; }
	transaction(spec: EditorTransaction, origin = '') {
		const before = this.getValue();
		const changes = (spec.changes ?? []).map((change: EditorChange) => ({ from: this.posToOffset(change.from), to: this.posToOffset(change.to ?? change.from), insert: change.text }));
		const changeSet = this.cm.state.changes(changes);
		const next = changeSet.apply(this.cm.state.doc);
		const position = spec.selection?.from;
		const anchor = position ? next.line(position.line + 1).from + position.ch : undefined;
		this.cm.dispatch({ changes: changeSet, ...(anchor === undefined ? {} : { selection: { anchor } }), annotations: Transaction.userEvent.of(origin) });
		transactions.push({ before, after: this.getValue(), changes: changes.length, origin });
	}
}
const editor = new BrowserEditor();
const view = new MarkdownView(file, editor, container);
const app = {
	workspace: { iterateAllLeaves: (visit: (leaf: { view: MarkdownView }) => void) => visit({ view }) },
	vault: {
		read: () => Promise.resolve(editor.getValue()),
		getAbstractFileByPath: (path: string) => path === file.path ? file : null,
		process: () => { throw new Error('A Live Preview circuit must write through the open CodeMirror editor.'); },
	},
} as unknown as App;
const manager = new SessionManager(app);
const fallbackFirst = new URLSearchParams(location.search).get('host') === 'fallback';
const mutableInfo: { file?: BrowserFile; editor?: BrowserEditor } = fallbackFirst ? {} : { file, editor };
const extensions = (livePreview = true) => [history(), keymap.of(historyKeymap),
	editorInfoField.init(() => mutableInfo), editorLivePreviewField.init(() => livePreview),
	livePreviewExtension(manager), EditorView.lineWrapping];
const createView = (doc: string) => {
	const parent = document.createElement('div'); parent.className = 'cm-host'; container.append(parent);
	return new EditorView({ state: EditorState.create({ doc, extensions: extensions() }), parent });
};
editor.cm = createView(initial);
let releaseInitialFallback = () => {};
if (fallbackFirst) {
	const block = scanCircuitBlocks(initial)[0]!;
	const element = document.createElement('div'); element.className = 'reading-fallback'; container.prepend(element);
	let child: { onload(): void; onunload(): void } | undefined;
	const context = {
		sourcePath:file.path,
		addChild:(next:typeof child) => { child = next; next?.onload(); },
		getSectionInfo:() => ({ text:editor.getValue(), lineStart:block.startLine, lineEnd:block.endLine }),
	} as unknown as MarkdownPostProcessorContext;
	renderReadingCircuit(app, manager, block.content, element, context);
	releaseInitialFallback = () => { child?.onunload(); element.remove(); };
}
const sessionFor = (id: string) => {
	const block = scanCircuitBlocks(editor.getValue()).find(block => block.circuitId === id)!;
	// Inspection must not repair a host that an earlier mount accidentally lost.
	return manager.open(file as unknown as TFile, view, block);
};
const api = {
	text: () => editor.getValue(),
	cursor: () => { const position = editor.cm.state.selection.main.head; return { offset: position, ...editor.offsetToPos(position), lineText: editor.cm.state.doc.lineAt(position).text }; },
	initial: () => initial,
	transactions: () => transactions,
	dragEvents: () => dragEvents,
	blocks: () => scanCircuitBlocks(editor.getValue()).map(block => ({ id: block.circuitId, raw: editor.getValue().slice(block.from, block.to), from: block.from })),
	snapshot: (id: string) => sessionFor(id).getSnapshot(),
	flush: (id: string) => sessionFor(id).flush(),
	undo: () => undo(editor.cm),
	insertBefore: (text: string) => editor.cm.dispatch({ changes: { from: 0, insert: text } }),
	makeMalformed: () => {
		const block = scanCircuitBlocks(editor.getValue())[0]!;
		editor.cm.dispatch({ changes:{ from:block.contentFrom, to:block.contentTo, insert:'{"schemaVersion":999,"circuitId":"first-circuit"}' } });
	},
	refreshWorkspace: () => manager.refreshWorkspace(),
	assignInfo: () => {
		mutableInfo.file = file; mutableInfo.editor = editor;
		editor.cm.dispatch({});
		releaseInitialFallback();
	},
	rebuild: () => {
		const previous = editor.cm;
		const parent = previous.dom.parentElement!;
		editor.cm = createView(editor.getValue());
		previous.destroy(); parent.remove();
	},
	navigateAway: async () => {
		const previous = editor.cm;
		const parent = previous.dom.parentElement!;
		savedNote = editor.getValue();
		view.file = otherFile; mutableInfo.file = otherFile;
		previous.destroy(); parent.remove(); manager.refreshWorkspace();
		await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
		editor.cm = createView('# Other note\n\nOther note text.\n');
	},
	navigateBack: async () => {
		const previous = editor.cm;
		const parent = previous.dom.parentElement!;
		view.file = file; mutableInfo.file = file;
		previous.destroy(); parent.remove(); manager.refreshWorkspace();
		await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
		editor.cm = createView(savedNote);
	},
	setLivePreview: (enabled: boolean) => {
		editor.cm.setState(EditorState.create({ doc:editor.getValue(), extensions:extensions(enabled) }));
	},
	readingFallback: async () => {
		const session = sessionFor('first-circuit');
		const block = scanCircuitBlocks(editor.getValue())[0]!;
		const element = document.createElement('div');
		element.className = 'reading-fallback-hidden';
		container.append(element);
		let child: { onload(): void; onunload(): void } | undefined;
		const context = {
			sourcePath: file.path,
			addChild: (next: typeof child) => { child = next; next?.onload(); },
			getSectionInfo: () => ({ text: editor.getValue(), lineStart: block.startLine, lineEnd: block.endLine }),
		} as unknown as MarkdownPostProcessorContext;
		renderReadingCircuit(app, manager, block.content, element, context);
		await new Promise(resolve => setTimeout(resolve, 0));
		const preserved = session.host.editor === (editor as unknown as Editor);
		child?.onunload(); element.remove();
		return preserved;
	},
	verifyUnmountCleanup: async () => {
		const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const block = scanCircuitBlocks(editor.getValue())[0]!;
		const element = document.createElement('div'); element.className = 'reading-fallback-hidden'; container.append(element);
		const cleanupManager = new SessionManager(app);
		const session = cleanupManager.open(file as unknown as TFile, view, block, editor as unknown as Editor);
		let calls = 0;
		const unmount = mountCircuit(element, session, cleanupManager, undefined, () => { calls++; });
		await frame();
		const mounted = Boolean(element.querySelector('.logic-circuit'));
		cleanupManager.dispose();
		const firstUnmount = { calls, empty:element.childElementCount === 0 };
		unmount(); cleanupManager.dispose();
		const repeatedUnmount = { calls, empty:element.childElementCount === 0 };
		element.remove();
		const lateManager = new SessionManager(app);
		const lateSession = lateManager.open(file as unknown as TFile, view, block, editor as unknown as Editor);
		lateManager.dispose();
		const lateElement = document.createElement('div');
		let lateCalls = 0;
		const lateUnmount = mountCircuit(lateElement, lateSession, lateManager, undefined, () => { lateCalls++; });
		await frame(); lateUnmount();
		const late = { calls:lateCalls, empty:lateElement.childElementCount === 0 };
		const indicatorCount = document.querySelectorAll('.logic-block-drop-indicator').length;
		const preview = document.createElement('div'); preview.className = 'markdown-preview-view reading-fallback-hidden'; container.append(preview);
		const readingElement = document.createElement('div'); preview.append(readingElement);
		const readingManager = new SessionManager(app);
		// eslint-disable-next-line @typescript-eslint/unbound-method -- The spy calls this method with its original instance and restores it below.
		const originalDispose = ReadingBlockDrag.prototype.dispose;
		let readingCalls = 0;
		ReadingBlockDrag.prototype.dispose = function () { readingCalls++; originalDispose.call(this); };
		let child: { onload(): void; onunload(): void } | undefined;
		const context = {
			sourcePath:file.path,
			addChild:(next:typeof child) => { child = next; next?.onload(); },
			getSectionInfo:() => ({ text:editor.getValue(), lineStart:block.startLine, lineEnd:block.endLine }),
		} as unknown as MarkdownPostProcessorContext;
		let reading;
		view.mode = 'preview';
		try {
			renderReadingCircuit(app, readingManager, block.content, readingElement, context);
			await frame();
			const readingMounted = Boolean(readingElement.querySelector('.logic-circuit'));
			const hasIndicator = document.querySelectorAll('.logic-block-drop-indicator').length === indicatorCount + 1;
			readingManager.dispose();
			const afterDispose = { calls:readingCalls, empty:readingElement.childElementCount === 0, indicators:document.querySelectorAll('.logic-block-drop-indicator').length };
			child?.onunload(); readingManager.dispose();
			reading = { mounted:readingMounted, hasIndicator, afterDispose, afterRepeat:readingCalls, originalIndicators:indicatorCount };
		} finally {
			view.mode = 'source'; ReadingBlockDrag.prototype.dispose = originalDispose; preview.remove();
		}
		return { mounted, firstUnmount, repeatedUnmount, late, reading };
	},
	verifyDetachedReading: () => verifyDetachedReading({ app, parent:container,
		pane:view as unknown as { file:TFile | null; mode:'source' | 'preview' }, file:file as unknown as TFile,
		otherFile:new BrowserFile('Different note.md') as unknown as TFile, editor:editor as unknown as Editor,
		text:() => editor.getValue() }),
};
declare global { interface Window { cmCircuitTest: typeof api; } }
window.cmCircuitTest = api;
