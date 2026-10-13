import type { CircuitData } from '../model/types';
import { createId, parseCircuit, serializeCircuit } from '../model/circuit';
import { scanCircuitBlocks } from '../storage/blocks';
import type { LogicBlock } from '../storage/blocks';
import type { BlockBaseline, NoteStore } from './note-store';
import type { Editor, TFile } from 'obsidian';

export interface CircuitSnapshot {
	circuit: CircuitData | null;
	error: string | null;
	editing: boolean;
	saving: boolean;
	conflict: boolean;
	canUndo: boolean;
	canRedo: boolean;
	blockSelected: boolean;
	actionErrorId: number;
}
export interface SessionHost {
	store: NoteStore;
	file: TFile;
	editor?: Editor;
	activate: (session: CircuitSession) => Promise<void>;
	locate?: (text: string) => number | undefined;
	blockSelectionChanged?: (selected: boolean) => void;
}
const copy = (circuit: CircuitData): CircuitData => JSON.parse(JSON.stringify(circuit)) as CircuitData;
const message = (error: unknown): string => error instanceof Error ? error.message : 'The circuit could not be saved.';

/** Drafts outlive their widgets until writes succeed or recovery is explicit. */
export class CircuitSession {
	private snapshot: CircuitSnapshot;
	private readonly listeners = new Set<() => void>();
	private readonly past: CircuitData[] = [];
	private readonly future: CircuitData[] = [];
	private baseline: BlockBaseline;
	private pending = 0;
	private saves: Promise<void> = Promise.resolve();
	private opening: Promise<void> | null = null;
	private pendingIdentity: string | null = null;
	private transientError = false;
	private disposed = false;
	readonly host: SessionHost;
	constructor(host: SessionHost, block: LogicBlock) {
		this.host = host;
		this.baseline = { circuitId: block.circuitId ?? '', content: block.content, from: block.from };
		let circuit: CircuitData | null = null;
		let error: string | null = null;
		try { circuit = parseCircuit(block.content); } catch (reason) { error = message(reason); }
		this.snapshot = { circuit, error, editing: false, saving: false, conflict: false, canUndo: false, canRedo: false,
			blockSelected: false, actionErrorId: 0 };
	}
	getSnapshot = (): CircuitSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	};
	get from(): number | undefined { return this.baseline.from; }
	get circuitId(): string { return this.baseline.circuitId; }
	/** A synchronous editor transaction can render a copied block's new ID before write returns. */
	matchesIdentity(circuitId: string): boolean {
		return circuitId === this.baseline.circuitId || circuitId === this.pendingIdentity;
	}
	getBlockBaseline(): BlockBaseline { return { ...this.baseline }; }
	get hasDraft(): boolean { return this.snapshot.conflict || this.pending > 0; }
	setBlockSelected(selected: boolean): void {
		if (this.disposed || this.snapshot.blockSelected === selected) return;
		this.host.blockSelectionChanged?.(selected);
		this.update({ blockSelected: selected });
	}
	get hasTransientError(): boolean { return this.transientError && !!this.snapshot.error; }
	dismissTransientError(actionErrorId = this.snapshot.actionErrorId): void {
		if (this.disposed || actionErrorId !== this.snapshot.actionErrorId || !this.hasTransientError
			|| this.snapshot.conflict || !this.snapshot.circuit) return;
		this.update({ error: null });
	}
	private update(patch: Partial<CircuitSnapshot>, transientError = false): void {
		if (this.disposed) return;
		if ('error' in patch) this.transientError = transientError && !!patch.error;
		this.snapshot = { ...this.snapshot, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
		for (const listener of this.listeners) listener();
	}
	mapPosition(map: (position: number) => number): void {
		if (this.baseline.from !== undefined) this.baseline.from = map(this.baseline.from);
	}
	observe(block: LogicBlock): void {
		this.baseline.from = block.from;
		if (block.content === this.baseline.content || this.snapshot.saving || this.snapshot.conflict) return;
		if (this.snapshot.editing) {
			this.update({ conflict: true, error: 'The circuit changed in the note. Your draft is preserved. Reload from note or copy your draft.' });
			return;
		}
		this.baseline = { circuitId: block.circuitId ?? '', content: block.content, from: block.from };
		this.past.length = 0;
		this.future.length = 0;
		try { this.update({ circuit: parseCircuit(block.content), error: null }); }
		catch (reason) { this.update({ circuit: null, error: message(reason) }); }
	}
	private async prepareIdentity(): Promise<void> {
		const text = await this.host.store.read(this.host.file, this.host.editor);
		const blocks = scanCircuitBlocks(text).filter((block) => block.circuitId === this.baseline.circuitId);
		const located = this.host.locate?.(text);
		const from = located ?? this.baseline.from;
		if (from !== undefined) this.baseline.from = from;
		if (!blocks.length) throw new Error('This circuit was removed or changed in the note.');
		if (blocks.length === 1 && blocks[0]?.content !== this.baseline.content) {
			throw new Error('This circuit changed elsewhere in the note. Reload from note before editing.');
		}
		if (blocks.length > 1) {
			if (this.host.locate && located === undefined) {
				throw new Error('Copied circuits share an ID and the rendered note is out of date. Reopen the note before editing.');
			}
			const selected = blocks.find((block) => block.from === this.baseline.from && block.content === this.baseline.content);
			if (!selected) throw new Error('Copied circuits share an ID and this occurrence cannot be identified safely. Reload from note.');
			if (!this.snapshot.circuit) throw new Error('The circuit data is invalid.');
			// Reidentity the persisted baseline, without saving a later queued draft early.
			const independent = { ...parseCircuit(this.baseline.content), circuitId: createId() };
			this.pendingIdentity = independent.circuitId;
			try {
				const saved = await this.host.store.write(this.host.file, this.host.editor,
					{ ...this.baseline, identityText: text }, independent);
				this.baseline = { circuitId: independent.circuitId, content: saved.content, from: saved.from };
				this.update({ circuit: { ...this.snapshot.circuit, circuitId: independent.circuitId } });
			} finally { this.pendingIdentity = null; }
		}
	}
	startEditing(): Promise<void> {
		if (this.opening) return this.opening;
		if (!this.snapshot.circuit || this.snapshot.conflict || this.disposed) return Promise.resolve();
		this.opening = (async () => {
			try {
				await this.host.activate(this);
				await this.host.store.queue(this.host.file, async () => { await this.prepareIdentity(); });
				if (!this.disposed && !this.snapshot.conflict) this.update({ editing: true, error: null });
			} catch (reason) { this.update({ conflict: true, error: message(reason) }); }
		})().finally(() => { this.opening = null; });
		return this.opening;
	}
	commit(circuit: CircuitData): void {
		if (this.disposed || this.snapshot.conflict || !this.snapshot.circuit) return;
		try { parseCircuit(serializeCircuit(circuit)); }
		catch (reason) { this.update({ error: message(reason), actionErrorId: this.snapshot.actionErrorId + 1 }, true); return; }
		if (serializeCircuit(circuit) === serializeCircuit(this.snapshot.circuit)) return;
		this.past.push(copy(this.snapshot.circuit));
		this.future.length = 0;
		this.update({ circuit: copy(circuit), error: null });
		this.enqueue(circuit);
	}
	private enqueue(circuit: CircuitData): void {
		this.pending += 1;
		this.update({ saving: true });
		const draft = copy(circuit);
		this.saves = this.host.store.queue(this.host.file, async () => {
			if (this.disposed || this.snapshot.conflict) return;
			await this.prepareIdentity();
			draft.circuitId = this.baseline.circuitId;
			const saved = await this.host.store.write(this.host.file, this.host.editor, this.baseline, draft);
			this.baseline = { circuitId: draft.circuitId, content: saved.content, from: saved.from };
			if (this.snapshot.circuit?.circuitId !== draft.circuitId && this.snapshot.circuit) {
				this.update({ circuit: { ...this.snapshot.circuit, circuitId: draft.circuitId } });
			}
		}).catch((reason: unknown) => {
			this.update({ conflict: true, error: `${message(reason)} Your draft is preserved. Reload from note or copy your draft.` });
		}).finally(() => {
			this.pending -= 1;
			this.update({ saving: this.pending > 0 });
		});
	}
	undo(): void {
		if (this.snapshot.conflict || !this.snapshot.circuit) return;
		const previous = this.past.pop();
		if (!previous) return;
		this.future.push(copy(this.snapshot.circuit));
		this.update({ circuit: copy(previous), error: null });
		this.enqueue(previous);
	}
	redo(): void {
		if (this.snapshot.conflict || !this.snapshot.circuit) return;
		const next = this.future.pop();
		if (!next) return;
		this.past.push(copy(this.snapshot.circuit));
		this.update({ circuit: copy(next), error: null });
		this.enqueue(next);
	}
	async flush(): Promise<void> {
		await this.opening;
		do { await this.saves; } while (this.pending > 0);
		if (this.snapshot.conflict) throw new Error(this.snapshot.error ?? 'The circuit has unsaved changes.');
	}
	async finish(shouldClose: () => boolean = () => true): Promise<void> {
		await this.opening;
		do { await this.saves; } while (this.pending > 0);
		// A widget can be recreated while its save is still pending. Only its
		// current owner may close it; Done and switching circuits always close.
		if (!shouldClose()) return;
		if (this.snapshot.conflict) throw new Error(this.snapshot.error ?? 'The circuit has unsaved changes.');
		this.update({ editing: false });
	}
	async reload(): Promise<void> {
		await this.saves;
		try {
			const text = await this.host.store.read(this.host.file, this.host.editor);
			const candidates = scanCircuitBlocks(text).filter((block) => block.circuitId === this.baseline.circuitId);
			const located = this.host.locate?.(text);
			if (candidates.length > 1 && this.host.locate && located === undefined) {
				throw new Error('Copied circuit occurrences cannot be distinguished in this outdated view. Copy your draft and reopen the note.');
			}
			const from = located ?? this.baseline.from;
			const block = candidates.length === 1 ? candidates[0] : candidates.find((item) => item.from === from);
			if (!block) throw new Error('The circuit block was removed or cannot be identified. Copy your draft to recover it.');
			const circuit = parseCircuit(block.content);
			this.baseline = { circuitId: circuit.circuitId, content: block.content, from: block.from };
			this.past.length = 0;
			this.future.length = 0;
			this.update({ circuit, error: null, conflict: false, editing: false });
		} catch (reason) { this.update({ error: message(reason) }); }
	}
	async copyDraft(): Promise<void> {
		if (!this.snapshot.circuit) throw new Error('There is no valid circuit draft to copy.');
		await navigator.clipboard.writeText(`\`\`\`logic-circuit\n${serializeCircuit(this.snapshot.circuit)}\n\`\`\``);
	}
	dispose(): void { this.disposed = true; this.listeners.clear(); }
}
