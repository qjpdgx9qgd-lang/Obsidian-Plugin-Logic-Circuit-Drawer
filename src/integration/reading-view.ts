import { MarkdownRenderChild, MarkdownView, TFile } from 'obsidian';
import type { App, MarkdownPostProcessorContext } from 'obsidian';
import { scanCircuitBlocks } from '../storage/blocks';
import { mountCircuit } from '../ui/mount';
import type { SessionManager } from './session-manager';
import { circuitBlockActions } from './block-actions';
import { ReadingBlockDrag } from './reading-block-drag';
import { cancelBlockDrag, startBlockDrag } from './block-drag';

class CircuitRenderChild extends MarkdownRenderChild {
	private unmount: (() => void) | undefined;
	private ended = false;
	private readonly controller = new AbortController();
	private readonly releasePending: () => void;
	constructor(container: HTMLElement, manager: SessionManager, private readonly mount: (signal: AbortSignal) => Promise<() => void>) {
		super(container);
		this.releasePending = manager.trackCleanup(() => this.controller.abort());
	}
	onload(): void {
		void this.mount(this.controller.signal).then((unmount) => {
			if (this.ended) unmount(); else this.unmount = unmount;
		}).catch((reason: unknown) => {
			if (!this.ended && !this.controller.signal.aborted) {
				this.containerEl.empty();
				this.containerEl.createEl('p', { cls: 'logic-circuit-error', text: reason instanceof Error ? reason.message : 'Could not load this circuit.' });
			}
		}).finally(this.releasePending);
	}
	onunload(): void { this.ended = true; this.controller.abort(); this.releasePending(); this.unmount?.(); }
}

function waitForAttachment(element: HTMLElement, signal: AbortSignal): Promise<boolean> {
	if (signal.aborted) return Promise.resolve(false);
	if (element.isConnected) return Promise.resolve(true);
	return new Promise(resolve => {
		const observer = new MutationObserver(() => { if (element.isConnected) finish(true); });
		const finish = (attached: boolean) => { observer.disconnect(); signal.removeEventListener('abort', cancel); resolve(attached); };
		const cancel = () => finish(false);
		signal.addEventListener('abort', cancel, { once: true });
		observer.observe(element.ownerDocument, { childList: true, subtree: true });
		if (signal.aborted) finish(false); else if (element.isConnected) finish(true);
	});
}

function containingPane(app: App, element: HTMLElement): object {
	let pane: object = element.closest('.workspace-leaf') ?? element.parentElement ?? element;
	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(element)) pane = leaf.view;
	});
	return pane;
}

export function renderReadingCircuit(app: App, manager: SessionManager, source: string,
	element: HTMLElement, context: MarkdownPostProcessorContext): void {
	element.addClass('logic-circuit-widget');
	const file = app.vault.getAbstractFileByPath(context.sourcePath);
	if (!(file instanceof TFile)) {
		element.createEl('p', { text: 'This circuit needs a saved Markdown note to be edited.' });
		return;
	}
	context.addChild(new CircuitRenderChild(element, manager, async signal => {
		const initialPane = containingPane(app, element);
		const text = await manager.store.read(file);
		if (!await waitForAttachment(element, signal)) return () => undefined;
		const pane = containingPane(app, element);
		if (signal.aborted || initialPane instanceof MarkdownView && initialPane.file !== file
			|| pane instanceof MarkdownView && pane.file !== file) return () => undefined;
		const blocks = scanCircuitBlocks(text);
		const section = context.getSectionInfo(element);
		const normalized = (content: string): string => content.replace(/\r\n/g, '\n');
		const matching = blocks.filter((block) => normalized(block.content).trimEnd() === normalized(source).trimEnd());
		if (matching.length > 1 && (!section || normalized(section.text) !== normalized(text))) {
			throw new Error('Copied circuit occurrences cannot be distinguished in this outdated view. Reopen the note before editing.');
		}
		const inside = section ? matching.filter((item) => item.startLine >= section.lineStart && item.endLine <= section.lineEnd) : [];
		const exact = section ? matching.find((item) => item.startLine === section.lineStart) : undefined;
		const block = exact ?? (inside.length === 1 ? inside[0] : matching.length === 1 ? matching[0] : undefined);
		if (!block) throw new Error('This circuit occurrence cannot be located safely in the note. Switch to Live Preview or reopen the note.');
		const locate = (authoritative: string): number | undefined => {
			const current = context.getSectionInfo(element);
			if (!current || normalized(current.text) !== normalized(authoritative)) return undefined;
			return scanCircuitBlocks(authoritative).find((item) => item.startLine === current.lineStart)?.from;
		};
		const unique = Boolean(block.circuitId && blocks.filter(item => item.circuitId === block.circuitId).length === 1);
		// Native code-block rendering can precede the Live Preview decoration.
		// Bind to its public editor host immediately so saves cannot close it.
		const editor = pane instanceof MarkdownView && pane.file === file && pane.getMode() === 'source' ? pane.editor : undefined;
		const session = manager.open(file, pane, block, editor, editor ? undefined : locate, unique);
		const preview = element.closest<HTMLElement>('.markdown-preview-view');
		const drag = preview && !session.host.editor ? new ReadingBlockDrag(session, preview, context) : undefined;
		const move = editor ? (event: DragEvent) => startBlockDrag(session, element.ownerDocument, event) : drag?.start;
		const cancel = editor ? () => cancelBlockDrag(element.ownerDocument) : drag?.clear;
		return mountCircuit(element, session, manager, circuitBlockActions(session, move, cancel), () => drag?.dispose());
	}));
}
