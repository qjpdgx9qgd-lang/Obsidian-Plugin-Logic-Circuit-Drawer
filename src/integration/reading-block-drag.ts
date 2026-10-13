import { Notice } from 'obsidian';
import type { MarkdownPostProcessorContext, MarkdownSectionInformation } from 'obsidian';
import type { CircuitSession } from './session';
import { BLOCK_DRAG_MIME, cancelBlockDrag, getBlockDrag, startBlockDrag } from './block-drag';
import { sessionBlockBaseline } from './block-actions';
import { eventElement } from '../ui/dom';
import { readingDropBoundary, readingLineOffset } from './reading-drop-target';

const normalized = (text: string): string => text.replace(/\r\n/g, '\n');

interface ReadingDrop { line: number; noteText: string; y: number; }

/** Each source widget owns one temporary drag; all listeners leave with its render child. */
export class ReadingBlockDrag {
	private readonly document: Document;
	private readonly indicator: HTMLDivElement;
	private scrollFrame = 0;
	private lastPointer: DragEvent | null = null;
	constructor(private readonly session: CircuitSession, private readonly preview: HTMLElement,
		private readonly context: MarkdownPostProcessorContext) {
		this.document = preview.ownerDocument;
		this.indicator = this.document.createElement('div');
		this.indicator.className = 'logic-block-drop-indicator';
		this.indicator.hidden = true;
		this.document.body.appendChild(this.indicator);
		this.document.addEventListener('dragover', this.over);
		this.document.addEventListener('drop', this.drop);
		this.document.addEventListener('dragend', this.clear);
	}
	start = (event: DragEvent): void => { startBlockDrag(this.session, this.document, event); };
	private matching(event: DragEvent): boolean {
		return getBlockDrag(this.document)?.session === this.session && !this.session.host.editor
			&& event.dataTransfer?.types.includes(BLOCK_DRAG_MIME) === true
			&& this.preview.contains(eventElement(event.target));
	}
	private position(event: DragEvent): ReadingDrop | null {
		let element = this.document.elementFromPoint(event.clientX, event.clientY)?.parentElement
			?? eventElement(event.target)?.parentElement;
		let section: MarkdownSectionInformation | null = null;
		let bounds: DOMRect | undefined;
		while (element && element !== this.preview && this.preview.contains(element)) {
			const current = this.context.getSectionInfo(element);
			if (current) {
				if (section && (current.lineStart !== section.lineStart || current.lineEnd !== section.lineEnd)) break;
				section = current; bounds = element.getBoundingClientRect();
			}
			element = element.parentElement;
		}
		if (!section || !bounds) {
			// Blank margins still choose the closest rendered block, rather than a guessed source line.
			let distance = Infinity;
			for (const candidate of Array.from(this.preview.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,pre,ul,ol,blockquote,table,hr,.logic-circuit-widget'))) {
				const rect = candidate.getBoundingClientRect();
				const nextDistance = Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0);
				if (nextDistance >= distance) continue;
				const current = this.context.getSectionInfo(candidate);
				if (current) { section = current; bounds = rect; distance = nextDistance; }
			}
		}
		if (!section || !bounds) return null;
		const after = event.clientY > (bounds.top + bounds.bottom) / 2;
		const boundary = readingDropBoundary(section, after);
		return { line: boundary.line, noteText: boundary.noteText, y: after ? bounds.bottom : bounds.top };
	}
	private show(event: DragEvent): void {
		try {
			const target = this.position(event);
			if (!target) { this.indicator.hidden = true; return; }
			const rect = this.preview.getBoundingClientRect();
			this.indicator.style.left = `${rect.left}px`;
			this.indicator.style.top = `${target.y}px`;
			this.indicator.style.width = `${rect.width}px`;
			this.indicator.hidden = false;
		} catch { this.indicator.hidden = true; }
	}
	private over = (event: DragEvent): void => {
		if (!this.matching(event)) { this.indicator.hidden = true; this.lastPointer = null; return; }
		event.preventDefault(); event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		this.lastPointer = event; this.show(event);
		if (!this.scrollFrame) this.scrollFrame = this.document.defaultView?.requestAnimationFrame(this.scroll) ?? 0;
	};
	private scroll = (): void => {
		this.scrollFrame = 0;
		const event = this.lastPointer;
		if (!event || getBlockDrag(this.document)?.session !== this.session) return;
		const rect = this.preview.getBoundingClientRect();
		const delta = event.clientY < rect.top + 40 ? -12 : event.clientY > rect.bottom - 40 ? 12 : 0;
		if (!delta) return;
		this.preview.scrollTop += delta; this.show(event);
		this.scrollFrame = this.document.defaultView?.requestAnimationFrame(this.scroll) ?? 0;
	};
	private drop = (event: DragEvent): void => {
		if (!this.matching(event)) return;
		event.preventDefault(); event.stopPropagation();
		let target: ReadingDrop | null = null;
		try {
			target = this.position(event);
			if (!target) new Notice('Drop the circuit between rendered Markdown blocks.');
		}
		catch (reason) { new Notice(reason instanceof Error ? reason.message : 'Drop the circuit between Markdown blocks.'); }
		this.clear();
		if (!target) return;
		const chosen = target;
		void (async () => {
			await this.session.flush();
			const { file, editor, store } = this.session.host;
			const current = await store.read(file, editor);
			if (normalized(current) !== normalized(chosen.noteText)) throw new Error('The note changed while choosing the drop position. Drag the circuit again.');
			const baseline = await sessionBlockBaseline(this.session, current);
			await store.moveBlock(file, editor, baseline, { offset: readingLineOffset(current, chosen.line), noteText: current });
		})().catch((reason: unknown) => { new Notice(reason instanceof Error ? reason.message : 'The circuit block could not be moved.'); });
	};
	clear = (): void => {
		this.indicator.hidden = true; this.lastPointer = null;
		if (this.scrollFrame) this.document.defaultView?.cancelAnimationFrame(this.scrollFrame);
		this.scrollFrame = 0;
		if (getBlockDrag(this.document)?.session === this.session) cancelBlockDrag(this.document);
	};
	dispose(): void {
		this.document.removeEventListener('dragover', this.over);
		this.document.removeEventListener('drop', this.drop);
		this.document.removeEventListener('dragend', this.clear);
		this.clear(); this.indicator.remove();
	}
}
