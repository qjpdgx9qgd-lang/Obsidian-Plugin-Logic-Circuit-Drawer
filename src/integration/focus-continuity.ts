import type { EditorView } from '@codemirror/view';
import type { CircuitSession } from './session';

interface FocusSnapshot {
	view: EditorView;
	editor: CircuitSession['host']['editor'];
	document: Document;
	cancel: () => void;
}
interface FocusMount {
	capture: (view: EditorView) => void;
}
const snapshots = new WeakMap<CircuitSession, FocusSnapshot>();
const viewSnapshots = new WeakMap<EditorView, Set<FocusSnapshot>>();
const mounts = new Set<FocusMount>();

/** Capture before Obsidian's native renderer can remove a focused circuit. */
export function beforeCircuitFocusWrite(view: EditorView): void {
	for (const mount of mounts) mount.capture(view);
}

/** A destroyed editor cannot transfer focus to a later editor incarnation. */
export function cancelCircuitFocusView(view: EditorView): void {
	for (const snapshot of viewSnapshots.get(view) ?? []) snapshot.cancel();
}

/** Explicit Reading output is authoritative even before its mode notification. */
export function cancelCircuitFocusSession(session: CircuitSession): void {
	snapshots.get(session)?.cancel();
}

/** Focus ownership survives a payload save's temporary widget replacement. */
export function preserveCircuitFocus(host: () => EditorView | undefined, widget: HTMLElement, session: CircuitSession,
	canEdit: () => boolean, trackCleanup: (cleanup: () => void) => () => void): {
	afterRender: () => void; dispose: () => void;
} {
	let disposed = false;
	const capture = (view: EditorView) => {
		const document = widget.ownerDocument;
		if (disposed || host() !== view || !canEdit() || !widget.isConnected
			|| !view.dom.contains(widget) || !widget.contains(document.activeElement)) return;
		snapshots.get(session)?.cancel();
		const window = document.defaultView;
		let releaseCleanup = () => {};
		const keydown = (event: KeyboardEvent) => {
			const current = session.getSnapshot();
			if (event.target === document.body && document.activeElement === document.body
				&& host() === view && session.host.editor === snapshot.editor && canEdit()
				&& !current.conflict && !current.error && !event.defaultPrevented) {
				// Modifier presses precede the shortcut's actual key. Keep ownership
				// until that key decides whether this is an undo or unrelated input.
				if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) {
					event.stopImmediatePropagation(); return;
				}
				const key = event.key.toLowerCase();
				if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === 'z' || key === 'y')) {
					// Window capture runs before document handlers can discard the
					// resize/focus handoff while this circuit temporarily has no DOM.
					event.preventDefault(); event.stopImmediatePropagation();
					if (key === 'y' || event.shiftKey) session.redo(); else session.undo();
					return;
				}
			}
			cancel();
		};
		const cancel = () => {
			if (snapshots.get(session) !== snapshot) return;
			snapshots.delete(session);
			viewSnapshots.get(view)?.delete(snapshot);
			document.removeEventListener('pointerdown', cancel, true);
			window?.removeEventListener('keydown', keydown, true);
			document.removeEventListener('wheel', cancel, true);
			document.removeEventListener('focusin', cancel, true);
			window?.removeEventListener('blur', cancel);
			window?.removeEventListener('resize', cancel);
			releaseCleanup();
		};
		const snapshot: FocusSnapshot = { view, editor: session.host.editor, document, cancel };
		snapshots.set(session, snapshot);
		const pending = viewSnapshots.get(view) ?? new Set<FocusSnapshot>();
		pending.add(snapshot); viewSnapshots.set(view, pending);
		// Every subsequent deliberate action takes precedence over the transfer.
		// Removing the focused DOM itself produces no focusin event on the body.
		document.addEventListener('pointerdown', cancel, true);
		window?.addEventListener('keydown', keydown, true);
		document.addEventListener('wheel', cancel, { capture: true, passive: true });
		document.addEventListener('focusin', cancel, true);
		window?.addEventListener('blur', cancel);
		window?.addEventListener('resize', cancel);
		releaseCleanup = trackCleanup(cancel);
	};
	const mount = { capture };
	mounts.add(mount);
	return {
		afterRender: () => {
			const snapshot = snapshots.get(session);
			if (!snapshot || disposed) return;
			if (host() !== snapshot.view || session.host.editor !== snapshot.editor || !canEdit()) {
				snapshot.cancel(); return;
			}
			if (!widget.isConnected || !snapshot.view.dom.contains(widget)) return;
			const document = widget.ownerDocument;
			if (document !== snapshot.document) { snapshot.cancel(); return; }
			const root = widget.querySelector<HTMLElement>('.logic-circuit:not(.is-read-only)');
			if (!root) return;
			const bounds = root.getBoundingClientRect();
			if (!bounds.width || !bounds.height) return;
			// A surviving mount already owns focus, or the user moved it elsewhere.
			if (document.activeElement !== document.body) {
				if (widget.contains(document.activeElement)) snapshot.cancel();
				return;
			}
			snapshot.cancel();
			root.focus({ preventScroll: true });
		},
		dispose: () => {
			if (disposed) return;
			// Native render-child unload runs before the editor's plugin updates.
			// Capture while its focused root is still attached, before React removes it.
			const view = host();
			if (view) beforeCircuitFocusWrite(view);
			disposed = true;
			mounts.delete(mount);
			const snapshot = snapshots.get(session);
			if (snapshot && (host() !== snapshot.view || !canEdit())) snapshot.cancel();
			// A captured transfer is owned by the manager until the successor
			// claims it, user input cancels it, or the plugin is unloaded.
		},
	};
}
