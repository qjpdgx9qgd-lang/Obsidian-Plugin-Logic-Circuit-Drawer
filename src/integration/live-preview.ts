import { StateField } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import type { Editor, TFile } from 'obsidian';
import { scanCircuitBlocks } from '../storage/blocks';
import { mountCircuit } from '../ui/mount';
import type { SessionManager } from './session-manager';
import type { CircuitSession } from './session';
import { circuitBlockActions } from './block-actions';
import { cancelBlockDrag, circuitBlockDragExtension, startBlockDrag } from './block-drag';

class CircuitWidget extends WidgetType {
	private unmount: (() => void) | undefined;
	constructor(private readonly session: CircuitSession, private readonly manager: SessionManager) { super(); }
	eq(other: CircuitWidget): boolean { return this.session === other.session; }
	toDOM(view: EditorView): HTMLElement {
		const element = view.dom.ownerDocument.createElement('div');
		element.className = 'logic-circuit-widget';
		this.unmount = mountCircuit(element, this.session, this.manager, circuitBlockActions(this.session,
			event => startBlockDrag(this.session, element.ownerDocument, event), () => cancelBlockDrag(element.ownerDocument)));
		return element;
	}
	ignoreEvent(): boolean { return true; }
	destroy(): void { this.unmount?.(); }
}

export function livePreviewExtension(manager: SessionManager): Extension {
	const build = (state: EditorState): DecorationSet => {
		const info = state.field(editorInfoField, false);
		if (!info?.file || !info.editor) return Decoration.none;
		const livePreview = !!state.field(editorLivePreviewField, false);
		manager.setLivePreview(info.editor, livePreview);
		if (!livePreview) {
			manager.reconcileEditor(info.editor, new Set());
			return Decoration.none;
		}
		const sessions = new Set<CircuitSession>();
		const blocks = scanCircuitBlocks(state.doc.toString());
		const ranges = blocks.map((block) => {
			const unique = Boolean(block.circuitId && blocks.filter(item => item.circuitId === block.circuitId).length === 1);
			const session = manager.open(info.file!, manager.editorPane(info.editor!), block, info.editor, undefined, unique);
			sessions.add(session);
			return Decoration.replace({ widget: new CircuitWidget(session, manager), block: true }).range(block.from, block.to);
		});
		manager.reconcileEditor(info.editor, sessions);
		return Decoration.set(ranges, true);
	};
	interface Rendered { decorations: DecorationSet; editor?: Editor; file?: TFile | null; live: boolean; }
	const rendered = (state: EditorState): Rendered => ({ decorations: build(state), editor: state.field(editorInfoField, false)?.editor, file: state.field(editorInfoField, false)?.file, live: !!state.field(editorLivePreviewField, false) });
	const field = StateField.define<Rendered>({
		create: rendered,
		update: (previous, transaction) => {
			const info = transaction.state.field(editorInfoField, false);
			const hostChanged = previous.file !== info?.file || previous.editor !== info?.editor;
			if (hostChanged && previous.editor) manager.reconcileEditor(previous.editor, new Set());
			if (transaction.docChanged && previous.editor && !hostChanged) {
				manager.mapEditor(previous.editor, (position) => transaction.changes.mapPos(position, 1));
			}
			// Obsidian's info can be a mutable MarkdownView shared by old/new states.
			// Compare captured values rather than rereading the same mutated object.
			if (transaction.docChanged || previous.live !== !!transaction.state.field(editorLivePreviewField, false)
				|| previous.file !== info?.file || previous.editor !== info?.editor) {
				return rendered(transaction.state);
			}
			return previous;
		},
		provide: (field) => EditorView.decorations.from(field, value => value.decorations),
	});
	return [field,
		EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
		ViewPlugin.fromClass(class {
			private editor: Editor | undefined;
			private release: (() => void) | undefined;
			constructor(view: EditorView) { this.sync(view); }
			private sync(view: EditorView): void {
				const editor = view.state.field(editorInfoField, false)?.editor;
				if (editor === this.editor) return;
				const previous = this.release;
				this.editor = editor; this.release = editor ? manager.retainEditor(editor) : undefined;
				previous?.();
			}
			update(update: ViewUpdate): void { this.sync(update.view); }
			destroy(): void {
				this.release?.();
			}
		}),
		circuitBlockDragExtension,
	];
}
