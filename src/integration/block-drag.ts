import { Notice, editorInfoField } from 'obsidian';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { CircuitSession } from './session';
import { sessionBlockBaseline } from './block-actions';
import { scanCircuitBlocks } from '../storage/blocks';
import { validateBlockMoveTarget } from '../storage/block-operations';
import { createId } from '../model/circuit';
import { eventElement } from '../ui/dom';

export const BLOCK_DRAG_MIME = 'application/x-obsidian-logic-block';
export interface BlockDrag { token: string; session: CircuitSession; }
const drags = new WeakMap<Document, BlockDrag>();
export function getBlockDrag(document: Document): BlockDrag | undefined { return drags.get(document); }

export function startBlockDrag(session: CircuitSession, document: Document, event: DragEvent): void {
	if (!event.dataTransfer) return;
	const token = createId();
	drags.set(document, { token, session });
	event.dataTransfer.setData(BLOCK_DRAG_MIME, token);
	event.dataTransfer.effectAllowed = 'move';
}
export function cancelBlockDrag(document: Document): void { drags.delete(document); }

function dropPosition(view: EditorView, event: DragEvent): { offset: number; y: number } | null {
	const point = { x: event.clientX, y: event.clientY };
	const position = view.posAtCoords(point, false);
	if (position === null) return null;
	const text = view.state.doc.toString();
	const block = scanCircuitBlocks(text).find(block => position >= block.from && position <= block.to);
	if (block) {
		const widget = eventElement(event.target)?.closest<HTMLElement>('.logic-circuit-widget');
		const rect = widget?.getBoundingClientRect();
		const before = rect ? event.clientY <= (rect.top + rect.bottom) / 2 : position <= (block.from + block.to) / 2;
		const line = view.state.doc.lineAt(before ? block.from : block.to);
		const offset = before ? line.from : line.to === view.state.doc.length ? line.to : line.to + 1;
		return { offset, y: rect ? before ? rect.top : rect.bottom : event.clientY };
	}
	const line = view.state.doc.lineAt(position);
	const coordinates = view.coordsAtPos(line.from);
	const after = Boolean(coordinates && event.clientY > (coordinates.top + coordinates.bottom) / 2);
	const offset = after ? line.to === view.state.doc.length ? line.to : line.to + 1 : line.from;
	return { offset, y: coordinates ? after ? coordinates.bottom : coordinates.top : event.clientY };
}

/** Host-owned document listeners also receive drops over ignored circuit widgets. */
export const circuitBlockDragExtension = ViewPlugin.fromClass(class {
	private readonly document: Document;
	private readonly indicator: HTMLDivElement;
	private scrollFrame = 0;
	private lastPointer: DragEvent | null = null;
	constructor(private readonly view: EditorView) {
		this.document = view.dom.ownerDocument;
		this.indicator = this.document.createElement('div');
		this.indicator.className = 'logic-block-drop-indicator';
		this.indicator.hidden = true;
		this.document.body.appendChild(this.indicator);
		this.document.addEventListener('dragover', this.over);
		this.document.addEventListener('drop', this.drop);
		this.document.addEventListener('dragend', this.clear);
	}
	private matching(event: DragEvent): BlockDrag | undefined {
		const drag = drags.get(this.document);
		const info = this.view.state.field(editorInfoField, false);
		return drag && info?.file === drag.session.host.file && info.editor === drag.session.host.editor
			&& event.dataTransfer?.types.includes(BLOCK_DRAG_MIME) && this.view.dom.contains(eventElement(event.target)) ? drag : undefined;
	}
	private show(event: DragEvent): void {
		const target = dropPosition(this.view, event);
		if (!target) { this.indicator.hidden = true; return; }
		try { validateBlockMoveTarget(this.view.state.doc.toString(), target.offset); }
		catch { this.indicator.hidden = true; return; }
		const rect = this.view.contentDOM.getBoundingClientRect();
		this.indicator.style.left = `${rect.left}px`;
		this.indicator.style.top = `${target.y}px`;
		this.indicator.style.width = `${rect.width}px`;
		this.indicator.hidden = false;
	}
	private over = (event: DragEvent): void => {
		if (!this.matching(event)) { this.stop(); return; }
		event.preventDefault(); event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		this.lastPointer = event; this.show(event);
		if (!this.scrollFrame) this.scrollFrame = this.document.defaultView?.requestAnimationFrame(this.scroll) ?? 0;
	};
	private scroll = (): void => {
		this.scrollFrame = 0;
		const event = this.lastPointer;
		if (!event || !this.matching(event)) return;
		const rect = this.view.scrollDOM.getBoundingClientRect();
		const delta = event.clientY < rect.top + 40 ? -12 : event.clientY > rect.bottom - 40 ? 12 : 0;
		if (!delta) return;
		this.view.scrollDOM.scrollTop += delta;
		this.show(event);
		this.scrollFrame = this.document.defaultView?.requestAnimationFrame(this.scroll) ?? 0;
	};
	private drop = (event: DragEvent): void => {
		const drag = this.matching(event);
		if (!drag) return;
		event.preventDefault(); event.stopPropagation();
		const target = dropPosition(this.view, event);
		const noteText = this.view.state.doc.toString();
		this.clear();
		if (!target) return;
		void (async () => {
			await drag.session.flush();
			const baseline = await sessionBlockBaseline(drag.session, noteText);
			await drag.session.host.store.moveBlock(drag.session.host.file, drag.session.host.editor, baseline, { offset: target.offset, noteText });
		})().catch((reason: unknown) => { new Notice(reason instanceof Error ? reason.message : 'The circuit block could not be moved.'); });
	};
	private stop = (): void => {
		this.indicator.hidden = true; this.lastPointer = null;
		if (this.scrollFrame) this.document.defaultView?.cancelAnimationFrame(this.scrollFrame);
		this.scrollFrame = 0;
	};
	private clear = (): void => {
		this.stop(); cancelBlockDrag(this.document);
	};
	destroy(): void {
		this.document.removeEventListener('dragover', this.over);
		this.document.removeEventListener('drop', this.drop);
		this.document.removeEventListener('dragend', this.clear);
		this.stop();
		const drag = getBlockDrag(this.document);
		const info = this.view.state.field(editorInfoField, false);
		if (drag && info?.file === drag.session.host.file && info.editor === drag.session.host.editor) cancelBlockDrag(this.document);
		this.indicator.remove();
	}
});
