import type { EditorView } from '@codemirror/view';
import type { CircuitSession } from './session';

type ViewHost = () => EditorView | undefined;
type RegisterCleanup = (cleanup: () => void) => () => void;
interface ResizeController {
	mount: (widget: HTMLElement, host: ViewHost) => void;
	before: (widget: HTMLElement, dragging: boolean) => void;
	after: (widget: HTMLElement) => void;
	settle: () => void;
	beforeWrite: () => (() => void) | undefined;
	release: (widget: HTMLElement) => void;
	dispose: () => void;
}
const sessions = new WeakMap<CircuitSession, WeakMap<EditorView, ResizeController>>();
const views = new WeakMap<EditorView, Set<ResizeController>>();

/** Capture before Obsidian can replace native widgets during a payload save. */
export function beforeCircuitResizeWrite(view: EditorView): () => void {
	const complete = [...(views.get(view) ?? [])].flatMap(controller => {
		const finish = controller.beforeWrite();
		return finish ? [finish] : [];
	});
	return () => { for (const finish of complete) finish(); };
}

/** A retired editor cannot hand its viewport to a different view or mode. */
export function disposeCircuitResizeView(view: EditorView): void {
	for (const controller of [...(views.get(view) ?? [])]) controller.dispose();
}

function createController(view: EditorView, session: CircuitSession | undefined,
	registerCleanup?: RegisterCleanup): ResizeController {
	const scroller = view.scrollDOM;
	const document = view.dom.ownerDocument;
	const window = document.defaultView;
	const mounts = new Map<HTMLElement, ViewHost>();
	let pending: { top: number; left: number; replaced: boolean } | null = null;
	let dragging = false;
	let revision = 0;
	let disposed = false;
	let unregister = () => {};
	const valid = (widget: HTMLElement) => !disposed && mounts.get(widget)?.() === view
		&& widget.isConnected && view.dom.contains(widget) && !!widget.getBoundingClientRect().height;
	const attached = () => [...mounts.keys()].find(valid);
	const cancel = () => {
		pending = null;
		if (!mounts.size) controller.dispose();
	};
	const cancelKey = (event: KeyboardEvent) => {
		// A modifier alone performs no action. Owned undo during an empty native
		// handoff is handled earlier on the window, before the document listener.
		if (!['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) cancel();
	};
	const before = (widget: HTMLElement, isDragging: boolean) => {
		dragging = isDragging; revision++;
		if (pending || !valid(widget) || !window || !scroller.clientHeight) return;
		// An overflow-visible editor scrolls its containing page instead.
		if (!/^(auto|scroll|overlay)$/.test(window.getComputedStyle(scroller).overflowY)) return;
		const rect = widget.getBoundingClientRect();
		pending = { top: rect.top - scroller.getBoundingClientRect().top, left: scroller.scrollLeft, replaced: false };
	};
	const after = (widget: HTMLElement) => {
		const snapshot = pending;
		const committedRevision = revision;
		if (!snapshot || !valid(widget)) return;
		const restore = () => {
			if (pending !== snapshot || !valid(widget) || !scroller.clientHeight) return;
			const scale = view.scaleY;
			if (!Number.isFinite(scale) || scale <= 0) return;
			const top = widget.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
			const target = scroller.scrollTop + (top - snapshot.top) / scale;
			scroller.scrollTop = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
			scroller.scrollLeft = Math.min(snapshot.left, Math.max(0, scroller.scrollWidth - scroller.clientWidth));
		};
		restore();
		view.requestMeasure({
			key: controller,
			read: () => snapshot,
			write: () => queueMicrotask(() => {
				// CodeMirror's anchor adjustment follows measurement writes. If the
				// widget was removed in that adjustment, its replacement claims this
				// same snapshot after React renders; an empty gap cannot consume it.
				restore();
				// The focused successor can render before its neighboring native
				// widgets. Wait for connected empty render containers, rather than
				// cached heights or offscreen widgets that CodeMirror virtualizes.
				const recovered = !snapshot.replaced || !view.dom.querySelector('.logic-circuit-widget:empty');
				if (pending === snapshot && valid(widget) && recovered && !dragging && revision === committedRevision) pending = null;
			}),
		});
	};
	const controller: ResizeController = {
		mount: (widget, host) => { mounts.set(widget, host); },
		before,
		after,
		settle: () => { const widget = attached(); if (widget) after(widget); },
		beforeWrite: () => {
			const widget = [...mounts.keys()].find(widget => valid(widget) && widget.contains(document.activeElement));
			if (!widget && !pending) return;
			if (widget) before(widget, false);
			return () => { const current = attached(); if (current) after(current); };
		},
		release: widget => {
			const host = mounts.get(widget);
			mounts.delete(widget);
			if (pending) pending.replaced = true;
			if (!mounts.size && (!pending || host?.() !== view || !view.dom.isConnected)) controller.dispose();
		},
		dispose: () => {
			if (disposed) return;
			disposed = true; pending = null; mounts.clear();
			document.removeEventListener('wheel', cancel, true);
			document.removeEventListener('keydown', cancelKey, true);
			document.removeEventListener('pointerdown', cancel, true);
			window?.removeEventListener('blur', cancel);
			window?.removeEventListener('resize', cancel);
			views.get(view)?.delete(controller);
			if (session && sessions.get(session)?.get(view) === controller) sessions.get(session)?.delete(view);
			unregister();
		},
	};
	const controllers = views.get(view) ?? new Set<ResizeController>();
	controllers.add(controller); views.set(view, controllers);
	document.addEventListener('wheel', cancel, { capture: true, passive: true });
	document.addEventListener('keydown', cancelKey, true);
	document.addEventListener('pointerdown', cancel, true);
	window?.addEventListener('blur', cancel);
	window?.addEventListener('resize', cancel);
	unregister = registerCleanup?.(controller.dispose) ?? (() => {});
	return controller;
}

/** Keep a session's viewport through resize and native widget replacement. */
export function preserveResizeScroll(host: EditorView | ViewHost, widget: HTMLElement,
	session?: CircuitSession, registerCleanup?: RegisterCleanup): { beforeResize: (dragging: boolean) => void; afterResize: () => void; dispose: () => void } {
	const currentView: ViewHost = typeof host === 'function' ? host : () => host;
	let controller: ResizeController | undefined;
	let view: EditorView | undefined;
	let disposed = false;
	const attach = () => {
		const current = currentView();
		if (disposed || !current) return;
		if (controller && view !== current) { controller.release(widget); controller = undefined; }
		if (!controller) {
			view = current;
			const entries = session ? sessions.get(session) ?? new WeakMap<EditorView, ResizeController>() : undefined;
			controller = entries?.get(current) ?? createController(current, session, registerCleanup);
			if (session && entries) { entries.set(current, controller); sessions.set(session, entries); }
			controller.mount(widget, currentView);
		}
		return controller;
	};
	const beforeResize = (dragging: boolean) => attach()?.before(widget, dragging);
	// finish() can await saving. Capture its synchronous state transition before
	// React subscribers remove chrome, rather than the earlier Done click.
	let editing = session?.getSnapshot().editing;
	const unsubscribe = session?.subscribe(() => {
		const next = session.getSnapshot().editing;
		if (next !== editing) { editing = next; beforeResize(false); }
	});
	attach();
	return {
		beforeResize,
		afterResize: () => {
			const current = attach();
			current?.after(widget);
			// A neighboring replacement becoming measurable can complete another
			// circuit's pending handoff without rerendering that circuit itself.
			if (view) for (const other of views.get(view) ?? []) if (other !== current) other.settle();
		},
		dispose: () => {
			if (disposed) return;
			// A preceding circuit can unload before the focused circuit. Capture
			// the view's owned anchor before any child removes its footprint.
			const hostView = currentView();
			if (hostView) queueMicrotask(beforeCircuitResizeWrite(hostView));
			disposed = true; unsubscribe?.(); controller?.release(widget);
		},
	};
}
