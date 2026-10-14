import test from 'node:test';
import assert from 'node:assert/strict';
import type { EditorView } from '@codemirror/view';
import type { App, Editor } from 'obsidian';
import { NoteStore } from '../src/integration/note-store';
import { preserveResizeScroll } from '../src/integration/resize-scroll';

/** Deterministic layout geometry exercises viewport ownership without a browser. */
function viewport() {
	const ownerWindow = Object.assign(new EventTarget(), {
		getComputedStyle: () => ({ overflowY: 'auto' }),
	});
	const document = Object.assign(new EventTarget(), { defaultView: ownerWindow });
	const scroller = Object.assign(new EventTarget(), {
		scrollTop: 100, scrollLeft: 0, scrollHeight: 1000, scrollWidth: 600,
		clientHeight: 300, clientWidth: 600,
		getBoundingClientRect: () => ({ top: 0 }),
	});
	let reflow = 0;
	const widget = {
		ownerDocument: document, isConnected: true,
		contains: () => false,
		getBoundingClientRect: () => ({ top: 300 + reflow - scroller.scrollTop, height: 100 }),
	};
	const measurements: { read: () => unknown; write: (value: unknown) => void }[] = [];
	const view = {
		dom: { ownerDocument: document, isConnected: true, contains: (element: unknown) => element === widget },
		scrollDOM: scroller, scaleY: 1,
		requestMeasure: (measurement: typeof measurements[number]) => { measurements.push(measurement); },
	} as unknown as EditorView;
	const resize = preserveResizeScroll(view, widget as unknown as HTMLElement);
	return { view, resize, scroller,
		shift: (pixels: number) => { reflow += pixels; },
		measure: async () => {
			for (const measurement of measurements.splice(0)) measurement.write(measurement.read());
			await Promise.resolve();
		},
	};
}

void test('a stale same-view retention release preserves the successor viewport controller', async () => {
	const store = new NoteStore({} as App);
	const editor = {} as Editor;
	const current = viewport();
	const releasePrevious = store.retainEditorView(editor, current.view);
	const releaseCurrent = store.retainEditorView(editor, current.view);
	try {
		current.resize.beforeResize(false);
		releasePrevious();
		assert.equal(store.editorView(editor), current.view, 'the current retention owns the same editor view');
		current.shift(40);
		current.resize.afterResize();
		await current.measure();
		assert.equal(current.scroller.scrollTop, 140, 'the successor still corrects a real 40px widget reflow');
		current.resize.beforeResize(false);
		releaseCurrent();
		assert.equal(store.editorView(editor), undefined);
		current.shift(40);
		current.resize.afterResize();
		await current.measure();
		assert.equal(current.scroller.scrollTop, 140, 'releasing the actual owner disposes its viewport corrections');
	} finally { releasePrevious(); releaseCurrent(); current.resize.dispose(); }
});

void test('releasing a different predecessor view disposes only its viewport controller', async () => {
	const store = new NoteStore({} as App);
	const editor = {} as Editor;
	const previous = viewport();
	const current = viewport();
	const releasePrevious = store.retainEditorView(editor, previous.view);
	const releaseCurrent = store.retainEditorView(editor, current.view);
	try {
		previous.resize.beforeResize(false);
		current.resize.beforeResize(false);
		releasePrevious();
		previous.shift(40); current.shift(40);
		previous.resize.afterResize(); current.resize.afterResize();
		await Promise.all([previous.measure(), current.measure()]);
		assert.equal(previous.scroller.scrollTop, 100, 'the retired view cannot apply a pending correction');
		assert.equal(current.scroller.scrollTop, 140, 'the successor keeps its own correction');
		assert.equal(store.editorView(editor), current.view);
	} finally { releasePrevious(); releaseCurrent(); previous.resize.dispose(); current.resize.dispose(); }
});
