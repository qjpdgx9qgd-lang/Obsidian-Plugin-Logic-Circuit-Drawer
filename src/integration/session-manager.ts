import { App, Editor, MarkdownView, Modal, Notice, TFile } from 'obsidian';
import type { LogicBlock } from '../storage/blocks';
import { CircuitSession } from './session';
import { NoteStore } from './note-store';

interface SessionEntry { session: CircuitSession; pane: object; mounts: number; referenced: boolean; releaseVersion: number; }

export class SessionManager {
	readonly store: NoteStore;
	private readonly entries = new Set<SessionEntry>();
	private readonly active = new WeakMap<object, CircuitSession>();
	private readonly activations = new WeakMap<object, Promise<void>>();
	private readonly roots = new Set<() => void>();
	private readonly modals = new Set<Modal>();
	private readonly insertions = new Map<Editor, string>();
	private readonly liveModes = new WeakMap<Editor, boolean>();
	private readonly editorOwners = new WeakMap<Editor, object>();
	private disposed = false;
	constructor(private readonly app: App) { this.store = new NoteStore(app); }

	open(file: TFile, pane: object, block: LogicBlock, editor?: Editor, locate?: (text: string) => number | undefined,
		allowRelocate = false): CircuitSession {
		const candidates = [...this.entries].filter((entry) => entry.pane === pane && entry.session.host.file === file);
		// A removed fence can map onto another block's opening position. Its ID
		// must match too, otherwise that other circuit inherits the wrong draft.
		const exact = candidates.find((entry) => entry.session.from === block.from
			&& entry.session.matchesIdentity(block.circuitId ?? ''));
		const sameIdentity = allowRelocate && block.circuitId
			? candidates.filter((entry) => entry.session.circuitId === block.circuitId) : [];
		// The caller enables relocation only for IDs unique in the new document.
		// Copied occurrences always use their mapped positions instead.
		const existing = exact ?? (sameIdentity.length === 1 ? sameIdentity[0] : undefined);
		if (existing) {
			// Obsidian can run its Markdown renderer underneath a Live Preview
			// widget. That temporary mount must not remove the active editor host.
			const retainEditor = !editor && existing.referenced && !!existing.session.host.editor
				&& (!(pane instanceof MarkdownView) || pane.getMode() === 'source');
			if (!retainEditor) {
				existing.session.host.editor = editor;
				existing.session.host.locate = locate;
			}
			existing.session.observe(block);
			existing.referenced = !!existing.session.host.editor || pane instanceof MarkdownView;
			existing.releaseVersion += 1;
			return existing.session;
		}
		const session = new CircuitSession({ store: this.store, file, editor, locate,
			blockSelectionChanged: selected => {
				if (!selected) return;
				for (const entry of this.entries) {
					if (entry.pane === pane && entry.session.host.file === file && entry.session !== session) {
						entry.session.setBlockSelected(false);
					}
				}
			},
			activate: (next) => {
				const activation = (this.activations.get(pane) ?? Promise.resolve()).catch(() => undefined).then(async () => {
					const previous = this.active.get(pane);
					if (previous && previous !== next) await previous.finish();
					if (!this.disposed) this.active.set(pane, next);
				});
				this.activations.set(pane, activation);
				return activation;
			} }, block);
		this.entries.add({ session, pane, mounts: 0, referenced: !!editor || pane instanceof MarkdownView, releaseVersion: 0 });
		return session;
	}

	editorPane(editor: Editor): object {
		let pane: object = editor;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.editor === editor) pane = leaf.view;
		});
		return pane;
	}

	/** Clear selection even when its circuit widget is outside the visible viewport. */
	clearBlockSelection(editor: Editor, file: TFile): void {
		const pane = this.editorPane(editor);
		for (const entry of this.entries) {
			if (entry.pane === pane && entry.session.host.file === file && entry.session.getSnapshot().blockSelected) {
				entry.session.setBlockSelected(false);
			}
		}
	}

	refreshWorkspace(): void {
		const views = new Set<MarkdownView>();
		this.app.workspace.iterateAllLeaves((leaf) => { if (leaf.view instanceof MarkdownView) views.add(leaf.view); });
		for (const entry of this.entries) {
			if (!(entry.pane instanceof MarkdownView)) continue;
			if (!views.has(entry.pane) || entry.pane.file !== entry.session.host.file) {
				entry.referenced = false;
				this.releaseEntry(entry);
			} else if (!entry.session.host.editor && entry.pane.getMode() !== 'preview') {
				entry.referenced = false;
				this.releaseEntry(entry);
			}
		}
	}

	mapEditor(editor: Editor, map: (position: number) => number): void {
		for (const entry of this.entries) {
			if (entry.session.host.editor === editor) entry.session.mapPosition(map);
		}
	}

	closeEditor(editor: Editor): void {
		for (const entry of this.entries) {
			if (entry.session.host.editor !== editor) continue;
			entry.referenced = false;
			this.releaseEntry(entry);
		}
		this.insertions.delete(editor);
	}

	/** A replaced CodeMirror view must not close the successor using this editor. */
	retainEditor(editor: Editor): () => void {
		const owner = {};
		this.editorOwners.set(editor, owner);
		return () => {
			if (this.editorOwners.get(editor) !== owner) return;
			this.editorOwners.delete(editor);
			this.closeEditor(editor);
		};
	}

	reconcileEditor(editor: Editor, sessions: ReadonlySet<CircuitSession>): void {
		for (const entry of this.entries) {
			if (entry.session.host.editor !== editor) continue;
			entry.referenced = sessions.has(entry.session);
			if (entry.referenced) entry.releaseVersion += 1;
			if (!entry.referenced) this.releaseEntry(entry);
		}
	}

	private releaseEntry(entry: SessionEntry): void {
		const version = ++entry.releaseVersion;
		const stillReleased = (): boolean => version === entry.releaseVersion && !entry.referenced && !this.disposed;
		void entry.session.finish(stillReleased).catch(() => undefined).then(() => {
			if (stillReleased() && !entry.mounts && !entry.session.hasDraft) {
				this.entries.delete(entry);
				entry.session.dispose();
			}
		});
	}

	setLivePreview(editor: Editor, enabled: boolean): void { this.liveModes.set(editor, enabled); }
	activateInserted(editor: Editor, circuitId: string): void {
		if (this.liveModes.get(editor)) this.insertions.set(editor, circuitId);
	}

	/** Pending Markdown mounts also need cancellation if the plugin unloads. */
	trackCleanup(cleanup: () => void): () => void {
		if (this.disposed) { cleanup(); return () => undefined; }
		this.roots.add(cleanup);
		return () => { this.roots.delete(cleanup); };
	}

	mount(session: CircuitSession, unmount: () => void): () => void {
		const entry = [...this.entries].find((item) => item.session === session);
		if (!entry || this.disposed) { unmount(); return () => undefined; }
		entry.mounts += 1;
		entry.releaseVersion += 1;
		this.roots.add(unmount);
		const editor = session.host.editor;
		if (editor && this.insertions.get(editor) === session.circuitId) {
			this.insertions.delete(editor);
			void session.startEditing();
		}
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.roots.delete(unmount);
			entry.mounts -= 1;
			if (entry.mounts !== 0 || entry.referenced || this.disposed) return;
			this.releaseEntry(entry);
		};
	}

	showRecovery(): void {
		const drafts = [...this.entries].filter((entry) => entry.session.hasDraft);
		if (!drafts.length) { new Notice('There are no unsaved circuit drafts.'); return; }
		const modal = new Modal(this.app);
		this.modals.add(modal);
		modal.onClose = () => { this.modals.delete(modal); };
		modal.titleEl.setText('Recover circuit drafts');
		modal.contentEl.createEl('p', { text: 'These drafts are held in memory until the plugin unloads. Copy a draft before reloading its note.' });
		for (const { session } of drafts) {
			const row = modal.contentEl.createDiv({ cls: 'logic-circuit-recovery-row' });
			row.createEl('p', { text: session.host.file.path });
			row.createEl('p', { text: session.getSnapshot().error ?? 'A save is still pending.' });
			const button = row.createEl('button', { text: 'Copy draft' });
			button.addEventListener('click', () => {
				void session.copyDraft().then(() => { new Notice('Circuit draft copied.'); })
					.catch(() => { new Notice('Could not copy the circuit draft.'); });
			});
			const reload = row.createEl('button', { text: 'Reload from note' });
			reload.addEventListener('click', () => {
				void session.reload().then(() => {
					if (session.getSnapshot().conflict) new Notice(session.getSnapshot().error ?? 'The circuit could not be reloaded.');
					else row.remove();
				});
			});
		}
		modal.open();
	}

	dispose(): void {
		this.disposed = true;
		for (const unmount of [...this.roots]) unmount();
		this.roots.clear();
		for (const modal of this.modals) modal.close();
		this.modals.clear();
		for (const { session } of this.entries) session.dispose();
		this.entries.clear();
		this.insertions.clear();
	}
}
