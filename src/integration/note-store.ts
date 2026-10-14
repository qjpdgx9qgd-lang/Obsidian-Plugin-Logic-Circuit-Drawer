import { App, Editor, MarkdownView, TFile } from 'obsidian';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { beforeCircuitResizeWrite, disposeCircuitResizeView } from './resize-scroll';
import { scanCircuitBlocks, updateCircuitBlock } from '../storage/blocks';
import { deleteCircuitBlock, insertCircuitBlockLine, moveCircuitBlock } from '../storage/block-operations';
import type { BlockMoveTarget, BlockOperationResult, StructuralBlockBaseline } from '../storage/block-operations';
import type { CircuitData } from '../model/types';
import { beforeCircuitFocusWrite, cancelCircuitFocusView } from './focus-continuity';

export interface BlockBaseline { circuitId: string; content: string; from?: number; identityText?: string; }

/** Writes are serialized by TFile and guarded inside the actual mutation. */
export class NoteStore {
	private readonly queues = new WeakMap<TFile, Promise<unknown>>();
	private readonly editorViews = new WeakMap<Editor, { view: EditorView; owner: object }>();
	constructor(private readonly app: App) {}
	/** A replaced view must not unregister the successor using the same editor. */
	retainEditorView(editor: Editor, view: EditorView): () => void {
		const owner = {};
		this.editorViews.set(editor, { view, owner });
		return () => {
			const retained = this.editorViews.get(editor);
			if (retained?.view === view && retained.owner !== owner) return;
			disposeCircuitResizeView(view);
			cancelCircuitFocusView(view);
			if (retained?.owner === owner) this.editorViews.delete(editor);
		};
	}
	/** Native Live Preview rendering can mount before its editor view is retained. */
	editorView(editor: Editor): EditorView | undefined { return this.editorViews.get(editor)?.view; }
	private editors(file: TFile): Editor[] {
		const editors: Editor[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.getMode() === 'source') {
				if (!editors.includes(leaf.view.editor)) editors.push(leaf.view.editor);
			}
		});
		return editors;
	}
	private editor(file: TFile, preferred?: Editor): Editor | undefined {
		const editors = this.editors(file);
		if (new Set(editors.map((item) => item.getValue())).size > 1) {
			throw new Error('This note has different unsaved contents in another pane. Resolve those changes before editing the circuit.');
		}
		return preferred && editors.includes(preferred) ? preferred : editors[0];
	}
	async read(file: TFile, preferred?: Editor): Promise<string> {
		const editor = this.editor(file, preferred);
		return editor ? editor.getValue() : this.app.vault.read(file);
	}
	queue<T>(file: TFile, action: () => Promise<T>): Promise<T> {
		const next = (this.queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(action);
		this.queues.set(file, next);
		return next;
	}
	deleteBlock(file: TFile, preferred: Editor | undefined, baseline: StructuralBlockBaseline): Promise<BlockOperationResult> {
		return this.changeBlock(file, preferred, (current) => deleteCircuitBlock(current, baseline));
	}
	insertBlockLine(file: TFile, preferred: Editor | undefined, baseline: StructuralBlockBaseline, side: 'before' | 'after'): Promise<BlockOperationResult> {
		return this.changeBlock(file, preferred, (current) => insertCircuitBlockLine(current, baseline, side));
	}
	moveBlock(file: TFile, preferred: Editor | undefined, baseline: StructuralBlockBaseline, target: BlockMoveTarget): Promise<BlockOperationResult> {
		return this.changeBlock(file, preferred, (current) => moveCircuitBlock(current, baseline, target));
	}
	private changeBlock(file: TFile, preferred: Editor | undefined,
		operation: (current: string) => BlockOperationResult): Promise<BlockOperationResult> {
		return this.queue(file, async () => {
			const editor = this.editor(file, preferred);
			if (editor) {
				const result = operation(editor.getValue());
				if (result.changes.length) {
					const prefix = result.cursorOffset !== undefined ? result.text.slice(0, result.cursorOffset).split('\n') : undefined;
					const selection = prefix ? { from: { line: prefix.length - 1, ch: prefix.at(-1)!.length } } : undefined;
					editor.transaction({ changes: result.changes.map((change) => ({
						from: editor.offsetToPos(change.from), to: editor.offsetToPos(change.to), text: change.text,
					})), selection }, 'logic-circuit');
					if (selection) editor.focus();
				}
				return result;
			}
			let result: BlockOperationResult | undefined;
			await this.app.vault.process(file, (current) => {
				result = operation(current);
				return result.text;
			});
			if (!result) throw new Error('The circuit block could not be changed.');
			return result;
		});
	}
	async write(file: TFile, preferred: Editor | undefined, baseline: BlockBaseline, circuit: CircuitData) {
		const checkOccurrence = (current: string): void => {
			if (baseline.identityText !== undefined && current !== baseline.identityText) {
				throw new Error('The note changed while identifying a copied circuit. Reload from note before editing.');
			}
			const candidates = scanCircuitBlocks(current).filter((block) => block.circuitId === baseline.circuitId);
			if (candidates.length > 1 && (baseline.identityText === undefined || circuit.circuitId === baseline.circuitId)) {
				throw new Error('A copied circuit appeared before this save. This occurrence cannot be updated safely. Reload from note before editing.');
			}
		};
		const editor = this.editor(file, preferred);
		if (editor) {
			// No await between the authoritative read, validation, and transaction.
			const current = editor.getValue();
			checkOccurrence(current);
			const result = updateCircuitBlock(current, baseline, circuit);
			const oldBlock = scanCircuitBlocks(current).find((block) => block.from === result.block.from);
			if (!oldBlock) throw new Error('The circuit block was removed.');
			const payload = result.text.slice(result.block.contentFrom, result.block.contentTo);
			const view = this.editorViews.get(editor)?.view;
			if (view) {
				if (view.state.doc.toString() !== current) {
					throw new Error('The note editor changed before this circuit save. Reload from note before editing.');
				}
				// Editor.transaction always scrolls the Markdown caret into view.
				// A circuit-only save maps that caret without moving its viewport.
				const finishResize = beforeCircuitResizeWrite(view);
				beforeCircuitFocusWrite(view);
				try {
					view.dispatch({ changes: { from: oldBlock.contentFrom, to: oldBlock.contentTo, insert: payload },
						annotations: Transaction.userEvent.of('logic-circuit'), scrollIntoView: false });
				} finally { finishResize(); }
			} else {
				editor.transaction({ changes: [{ from: editor.offsetToPos(oldBlock.contentFrom),
					to: editor.offsetToPos(oldBlock.contentTo), text: payload,
				}] }, 'logic-circuit');
			}
			return result.block;
		}
		let saved: ReturnType<typeof updateCircuitBlock> | undefined;
		await this.app.vault.process(file, (current) => {
			// Vault.process locks the file; validate within that operation.
			checkOccurrence(current);
			saved = updateCircuitBlock(current, baseline, circuit);
			return saved.text;
		});
		if (!saved) throw new Error('The circuit could not be saved.');
		return saved.block;
	}
}
