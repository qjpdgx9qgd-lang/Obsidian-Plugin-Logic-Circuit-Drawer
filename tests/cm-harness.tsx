import { EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo } from '@codemirror/commands';
import type { App, Editor, EditorChange, EditorPosition, EditorTransaction, MarkdownPostProcessorContext, TFile } from 'obsidian';
import { editorInfoField, editorLivePreviewField, MarkdownView, TFile as BrowserFile } from './browser-obsidian';
import { livePreviewExtension } from '../src/integration/live-preview';
import { SessionManager } from '../src/integration/session-manager';
import { renderReadingCircuit } from '../src/integration/reading-view';
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
let readingNote: string | undefined;
let releaseReadingScroll = () => {};
let forceNativeReplacement = new URLSearchParams(location.search).get('nativeReplacement') === '1';
let nativeReplacementGeneration = 0;
let holdNativeRendering = false;
const pendingNativeRendering = new Map<{ onload(): void; onunload(): void }, string>();
const nativeReplacementGaps: { scrollTop: number; maxScroll: number; rendered: number; active: string }[] = [];
const redrawNativeWidgets = StateEffect.define<null>();
const mountedNativeWidgets = new Set<NativeFallbackWidget>();
const nativeEarlyRemovals: { renderedBefore: number; focusedBefore: boolean; focusedAfter: boolean }[] = [];
const transactions: { before: string; after: string; changes: number; origin: string; scrollIntoView: boolean }[] = [];
const recordTransactions = EditorView.updateListener.of(update => {
	for (const transaction of update.transactions) {
		if (!transaction.docChanged) continue;
		let changes = 0;
		transaction.changes.iterChanges(() => { changes++; });
		transactions.push({ before:transaction.startState.doc.toString(), after:transaction.newDoc.toString(),
			changes, origin:transaction.annotation(Transaction.userEvent) ?? '', scrollIntoView:transaction.scrollIntoView });
		if (forceNativeReplacement) nativeReplacementGaps.push({ scrollTop:update.view.scrollDOM.scrollTop,
			maxScroll:update.view.scrollDOM.scrollHeight - update.view.scrollDOM.clientHeight,
			rendered:update.view.contentDOM.querySelectorAll('.native-fallback-widget .logic-circuit').length,
			active:document.activeElement?.className ?? '' });
	}
});
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
		const changes = (spec.changes ?? []).map((change: EditorChange) => ({ from: this.posToOffset(change.from), to: this.posToOffset(change.to ?? change.from), insert: change.text }));
		const changeSet = this.cm.state.changes(changes);
		const next = changeSet.apply(this.cm.state.doc);
		const position = spec.selection?.from;
		const anchor = position ? next.line(position.line + 1).from + position.ch : undefined;
		// Obsidian's Editor.transaction requests cursor scrolling for every
		// transaction, including circuit saves that do not set a selection.
		this.cm.dispatch({ changes: changeSet, ...(anchor === undefined ? {} : { selection: { anchor } }), annotations: Transaction.userEvent.of(origin), scrollIntoView: true });
	}
}
const editor = new BrowserEditor();
const view = new MarkdownView(file, editor, container);
const workspaceListeners = new Map<string, Set<() => void>>();
const app = {
	workspace: {
		iterateAllLeaves: (visit: (leaf: { view: MarkdownView }) => void) => visit({ view }),
		on: (event: string, listener: () => void) => {
			const listeners = workspaceListeners.get(event) ?? new Set();
			listeners.add(listener); workspaceListeners.set(event, listeners);
			return { event, listener };
		},
		offref: (ref: { event: string; listener: () => void }) => workspaceListeners.get(ref.event)?.delete(ref.listener),
	},
	vault: {
		read: () => Promise.resolve(readingNote ?? editor.getValue()),
		getAbstractFileByPath: (path: string) => path === file.path ? file : null,
		process: (_file: TFile, update: (text: string) => string) => {
			if (readingNote === undefined) throw new Error('A Live Preview circuit must write through the open CodeMirror editor.');
			readingNote = update(readingNote);
			return Promise.resolve(readingNote);
		},
	},
} as unknown as App;
const manager = new SessionManager(app);
/** Compete with the custom replacement as Obsidian's native renderer does. */
class NativeFallbackWidget extends WidgetType {
	private child: { onload(): void; onunload(): void } | undefined;
	constructor(private readonly circuitId: string, private readonly generation = 0) { super(); }
	eq(other: NativeFallbackWidget) { return this.circuitId === other.circuitId && this.generation === other.generation; }
	toDOM(cm: EditorView) {
		mountedNativeWidgets.add(this);
		const element = cm.dom.ownerDocument.createElement('div');
		element.className = 'cm-preview-code-block cm-embed-block cm-lang-logic-circuit native-fallback-widget';
		const content = element.appendChild(cm.dom.ownerDocument.createElement('div'));
		content.className = 'native-fallback-content';
		const block = scanCircuitBlocks(cm.state.doc.toString()).find(item => item.circuitId === this.circuitId)!;
		const context = {
			sourcePath:file.path,
			addChild:(child:typeof this.child) => {
				this.child = child;
				if (child && holdNativeRendering) pendingNativeRendering.set(child, this.circuitId); else child?.onload();
			},
			getSectionInfo:() => {
				const text = cm.state.doc.toString();
				const current = scanCircuitBlocks(text).find(item => item.circuitId === this.circuitId)!;
				return { text, lineStart:current.startLine, lineEnd:current.endLine };
			},
		} as unknown as MarkdownPostProcessorContext;
		renderReadingCircuit(app, manager, block.content, content, context);
		return element;
	}
	ignoreEvent() { return true; }
	clearRender() { this.child?.onunload(); }
	destroy() {
		mountedNativeWidgets.delete(this);
		if (this.child) pendingNativeRendering.delete(this.child);
		this.child?.onunload();
	}
}
const nativeFallbackField = StateField.define<DecorationSet>({
	create: state => Decoration.set(scanCircuitBlocks(state.doc.toString()).map(block =>
		Decoration.replace({ widget:new NativeFallbackWidget(block.circuitId!), block:true }).range(block.from, block.to)), true),
	update: (previous, transaction) => {
		const redraw = transaction.effects.some(effect => effect.is(redrawNativeWidgets));
		if (!transaction.docChanged && !redraw) return previous;
		if (forceNativeReplacement) {
			// The native renderer can unload its RenderChildren while resolving a
			// new editor state, before any ViewPlugin.update callback runs.
			const before = Array.from(container.querySelectorAll<HTMLElement>('.native-fallback-widget .logic-circuit'));
			const focusedBefore = before.some(element => element.contains(document.activeElement));
			for (const widget of [...mountedNativeWidgets]) widget.clearRender();
			nativeEarlyRemovals.push({ renderedBefore:before.length, focusedBefore,
				focusedAfter:Array.from(container.querySelectorAll<HTMLElement>('.native-fallback-widget .logic-circuit')).some(element => element.contains(document.activeElement)) });
		}
		if (forceNativeReplacement) nativeReplacementGeneration++;
		return Decoration.set(scanCircuitBlocks(transaction.newDoc.toString()).map(block =>
			Decoration.replace({ widget:new NativeFallbackWidget(block.circuitId!, nativeReplacementGeneration), block:true }).range(block.from, block.to)), true);
	},
	provide: field => EditorView.decorations.from(field),
});
const fallbackFirst = new URLSearchParams(location.search).get('host') === 'fallback';
const mutableInfo: { file?: BrowserFile; editor?: BrowserEditor } = fallbackFirst ? {} : { file, editor };
const extensions = (livePreview = true, nativeFallback = false) => [history(), keymap.of([...historyKeymap, ...defaultKeymap]),
	editorInfoField.init(() => mutableInfo), editorLivePreviewField.init(() => livePreview),
	livePreviewExtension(manager),
	nativeFallback ? Prec.highest(nativeFallbackField) : [], EditorView.lineWrapping, recordTransactions];
const createView = (doc: string) => {
	const parent = document.createElement('div'); parent.className = 'cm-host'; container.append(parent);
	return new EditorView({ state: EditorState.create({ doc, extensions: extensions(true, forceNativeReplacement) }), parent });
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
let releaseCircuitWrite: (() => void) | undefined;
const api = {
	text: () => editor.getValue(),
	resetNote: (doc: string) => editor.cm.setState(EditorState.create({ doc, extensions:extensions() })),
	setCursor: (anchor: number, head = anchor) => { editor.cm.dispatch({ selection:{ anchor, head } }); editor.cm.focus(); },
	selectionRange: () => { const { from, to, anchor, head } = editor.cm.state.selection.main; return { from, to, anchor, head }; },
	cursor: () => { const position = editor.cm.state.selection.main.head; return { offset: position, ...editor.offsetToPos(position), lineText: editor.cm.state.doc.lineAt(position).text }; },
	initial: () => initial,
	setMode: (mode: 'source' | 'preview', notify = true) => {
		view.mode = mode;
		if (notify) for (const listener of workspaceListeners.get('layout-change') ?? []) listener();
	},
	modeListeners: () => [...workspaceListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0),
	prepareNoteScrollScenario: async (doc: string, circuitId: string, nativeFallback = false) => {
		editor.cm.setState(EditorState.create({ doc, extensions:extensions(true, nativeFallback) }));
		const block = scanCircuitBlocks(editor.getValue()).find(block => block.circuitId === circuitId)!;
		editor.cm.dispatch({ effects:EditorView.scrollIntoView(block.from, { y:'center' }) });
		await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
		return sessionFor(circuitId).startEditing();
	},
	forceNativeReplacements: (enabled = true) => { forceNativeReplacement = enabled; },
	redrawNativeWidgets: () => editor.cm.dispatch({ effects:redrawNativeWidgets.of(null) }),
	nativeReplacementGaps: () => nativeReplacementGaps,
	nativeEarlyRemovals: () => nativeEarlyRemovals,
	measureEditor: () => new Promise<void>(resolve => editor.cm.requestMeasure({
		read: () => null, write: () => queueMicrotask(resolve),
	})),
	holdNativeRendering: () => { holdNativeRendering = true; },
	releaseNativeRendering: (circuitId?: string) => {
		if (!circuitId) holdNativeRendering = false;
		for (const [child, id] of [...pendingNativeRendering]) {
			if (circuitId && id !== circuitId) continue;
			pendingNativeRendering.delete(child); child.onload();
		}
	},
	prepareScrollScenario: async (bottom = false, nativeFallback = false) => {
		const before = Array.from({ length:40 }, (_, index) => `Study paragraph before the circuit ${index + 1}.`).join('\n\n');
		const after = bottom ? '' : '\n\n' + Array.from({ length:40 }, (_, index) => `Study paragraph after the circuit ${index + 1}.`).join('\n\n');
		const scrollingCircuit = { ...first, nodes:[{ ...first.nodes[0]!, position:{ x:64, y:160 } }, { ...first.nodes[0]!, id:'fixed-top', position:{ x:240, y:0 } }] };
		editor.cm.setState(EditorState.create({ doc:`${before}\n\n${fence(scrollingCircuit)}${after}`, extensions:extensions(true, nativeFallback) }));
		const block = scanCircuitBlocks(editor.getValue())[0]!;
		editor.cm.dispatch({ effects:EditorView.scrollIntoView(block.from, { y:'center' }) });
		await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
		return sessionFor('first-circuit').startEditing();
	},
	prepareReadingScrollScenario: async (prefetch = false) => {
		const data = { ...first, nodes:[{ ...first.nodes[0]!, position:{ x:64, y:160 } }, { ...first.nodes[0]!, id:'fixed-top', position:{ x:240, y:0 } }] };
		const before = Array.from({ length:24 }, (_, index) => `Study paragraph before the circuit ${index + 1}.`);
		const after = Array.from({ length:24 }, (_, index) => `Study paragraph after the circuit ${index + 1}.`);
		readingNote = prefetch ? editor.getValue() : [...before, fence(data), ...after].join('\n\n');
		view.mode = prefetch ? 'source' : 'preview';
		const cmHost = editor.cm.dom.parentElement!;
		cmHost.hidden = true;
		const preview = document.createElement('div');
		preview.className = 'markdown-preview-view reading-scroll-host';
		container.append(preview);
		for (const text of before) {
			const paragraph = document.createElement('p'); paragraph.textContent = text; preview.append(paragraph);
		}
		const element = document.createElement('div'); preview.append(element);
		for (const text of after) {
			const paragraph = document.createElement('p'); paragraph.textContent = text; preview.append(paragraph);
		}
		let child: { onload(): void; onunload(): void } | undefined;
		const block = scanCircuitBlocks(readingNote)[0]!;
		const context = {
			sourcePath:file.path,
			addChild:(next:typeof child) => { child = next; next?.onload(); },
			getSectionInfo:() => ({ text:readingNote!, lineStart:block.startLine, lineEnd:block.endLine }),
		} as unknown as MarkdownPostProcessorContext;
		renderReadingCircuit(app, manager, block.content, element, context);
		releaseReadingScroll = () => { child?.onunload(); preview.remove(); cmHost.hidden = false; view.mode = 'source'; readingNote = undefined; };
		await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
	},
	readingSnapshot: () => manager.open(file as unknown as TFile, view, scanCircuitBlocks(readingNote!)[0]!).getSnapshot(),
	readingText: () => readingNote,
	readingFlush: () => manager.open(file as unknown as TFile, view, scanCircuitBlocks(readingNote!)[0]!).flush(),
	unloadReadingScroll: () => releaseReadingScroll(),
	scrollCircuitIntoView: () => editor.cm.dispatch({ effects:EditorView.scrollIntoView(scanCircuitBlocks(editor.getValue())[0]!.from, { y:'center' }) }),
	transactions: () => transactions,
	dragEvents: () => dragEvents,
	blocks: () => scanCircuitBlocks(editor.getValue()).map(block => ({ id: block.circuitId, raw: editor.getValue().slice(block.from, block.to), from: block.from })),
	snapshot: (id: string) => sessionFor(id).getSnapshot(),
	flush: (id: string) => sessionFor(id).flush(),
	holdCircuitWrites: () => {
		if (releaseCircuitWrite) throw new Error('Circuit writes are already held.');
		const gate = new Promise<void>(resolve => { releaseCircuitWrite = resolve; });
		void manager.store.queue(file as unknown as TFile, () => gate);
	},
	releaseCircuitWrites: () => { releaseCircuitWrite?.(); releaseCircuitWrite = undefined; },
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
			const controls = readingElement.querySelectorAll('button,input,textarea').length;
			const modeListeners = [...workspaceListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
			const hasIndicator = document.querySelectorAll('.logic-block-drop-indicator').length > indicatorCount;
			readingManager.dispose();
			const afterDispose = { empty:readingElement.childElementCount === 0, indicators:document.querySelectorAll('.logic-block-drop-indicator').length, modeListeners:[...workspaceListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0) };
			child?.onunload(); readingManager.dispose();
			reading = { mounted:readingMounted, controls, modeListeners, hasIndicator, afterDispose, afterRepeat:readingElement.childElementCount, originalIndicators:indicatorCount };
		} finally {
			view.mode = 'source'; preview.remove();
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
