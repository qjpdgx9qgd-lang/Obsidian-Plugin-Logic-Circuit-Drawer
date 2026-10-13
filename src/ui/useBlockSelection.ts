import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react';
import type { CircuitBlockActions } from './BlockTools';
import { eventElement } from './dom';
import type { CircuitSession } from '../integration/session';

const containers = new WeakMap<CircuitSession, Set<HTMLElement>>();
const closing = new WeakMap<CircuitSession, Promise<void>>();
const menus = new WeakSet<CircuitSession>();
export const TRANSIENT_MESSAGE_MS = 4000;
const containsEvent = (element: HTMLElement, event: Event) => {
	if (event.composedPath().includes(element)) return true;
	const target = event.target;
	return Boolean(target && 'nodeType' in target && element.contains(target as Node));
};

/** A new occurrence, including identical text, starts a fresh display interval. */
export function useTransientMessage(container: RefObject<HTMLElement | null>) {
	const [notice, setNotice] = useState({ text: '', revision: 0 });
	const setMessage = useCallback((text: string) => setNotice(previous => ({ text, revision: previous.revision + 1 })), []);
	useEffect(() => {
		const window = container.current?.ownerDocument.defaultView;
		if (!window || !notice.text) return;
		const timeout = window.setTimeout(() => setNotice(previous => previous.revision === notice.revision ? { ...previous, text: '' } : previous), TRANSIENT_MESSAGE_MS);
		return () => window.clearTimeout(timeout);
	}, [container, notice]);
	return [notice.text, setMessage] as const;
}

export function useBlockSelection(session: CircuitSession, actions?: CircuitBlockActions) {
	const container = useRef<HTMLDivElement>(null);
	const selection = useCallback(() => session.getSnapshot().blockSelected, [session]);
	const selected = useSyncExternalStore(session.subscribe, selection);
	const select = useCallback((value: boolean) => session.setBlockSelected(value), [session]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useTransientMessage(container);
	const dragging = useRef(false);
	useEffect(() => {
		const element = container.current;
		if (!element) return;
		const roots = containers.get(session) ?? new Set<HTMLElement>();
		roots.add(element); containers.set(session, roots);
		const document = element.ownerDocument;
		const window = document.defaultView;
		const outside = (event: Event) => {
			// A native fallback and a CodeMirror widget may share this session.
			if ([...(containers.get(session) ?? [])].some(root => containsEvent(root, event))) {
				// A deliberate return cancels an earlier outside-click completion
				// that may still be waiting for a save. Rebuilt-widget focus does not.
				if (event.type === 'pointerdown') closing.delete(session);
				return;
			}
			if (menus.has(session) && eventElement(event.target)?.closest('.menu,[role="menu"]')) return;
			select(false);
			// Pointer-down is the user's completed outside action. Focus changes
			// during React/CodeMirror replacement must not close a live editor.
			if (event.type !== 'pointerdown' || dragging.current || !session.getSnapshot().editing || closing.has(session)) return;
			const active = eventElement(document.activeElement);
			if (active?.matches('input,textarea') && [...(containers.get(session) ?? [])].some(root => root.contains(active))) {
				(active as HTMLElement).blur();
			}
			// Let the outside click's default focus change commit an active label
			// or percentage field before finish waits for the resulting writes.
			const finish: Promise<void> = new Promise<void>(resolve => { if (window) window.setTimeout(resolve, 0); else resolve(); }).then(() => session.finish(() => closing.get(session) === finish)).catch(() => {
				// Saving failures already expose the preserved draft and recovery.
			}).finally(() => { if (closing.get(session) === finish) closing.delete(session); });
			closing.set(session, finish);
		};
		const blur = () => select(false);
		const dragStart = (event: Event) => { if ([...(containers.get(session) ?? [])].some(root => containsEvent(root, event))) dragging.current = true; };
		const dragEnd = () => { dragging.current = false; };
		// Capture also receives clicks that CodeMirror or another widget consumes.
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('focusin', outside, true);
		document.addEventListener('dragstart', dragStart, true);
		document.addEventListener('dragend', dragEnd, true);
		document.addEventListener('drop', dragEnd, true);
		window?.addEventListener('blur', blur);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('focusin', outside, true);
			document.removeEventListener('dragstart', dragStart, true);
			document.removeEventListener('dragend', dragEnd, true);
			document.removeEventListener('drop', dragEnd, true);
			window?.removeEventListener('blur', blur);
			roots.delete(element);
			if (!roots.size) { containers.delete(session); select(false); }
		};
	}, [session, select]);
	const remove = () => {
		if (!actions || busy) return;
		setBusy(true); setError('');
		void actions.remove().catch((reason: unknown) => {
			setError(reason instanceof Error ? reason.message : 'The circuit block could not be deleted.');
		}).finally(() => setBusy(false));
	};
	const contextMenu = (event: MouseEvent) => {
		if (!actions || eventElement(event.target)?.closest('input,textarea')) return;
		event.preventDefault(); event.stopPropagation(); select(true);
		menus.add(session);
		actions.menu(event.nativeEvent, remove, () => { menus.delete(session); });
	};
	return { container, selected, select, busy, error, remove, contextMenu };
}
