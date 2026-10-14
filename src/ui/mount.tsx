import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import { CircuitEditor } from './CircuitEditor';
import type { CircuitSession } from '../integration/session';
import type { SessionManager } from '../integration/session-manager';
import type { CircuitBlockActions } from './BlockTools';

export interface CircuitInteractionMode {
	isEditable: () => boolean;
	subscribe: (listener: () => void) => () => void;
}

function MountedCircuit({ session, blockActions, mode }: {
	session: CircuitSession;
	blockActions?: CircuitBlockActions;
	mode?: CircuitInteractionMode;
}) {
	const editable = useSyncExternalStore(mode?.subscribe ?? (() => () => undefined), mode?.isEditable ?? (() => true));
	return <CircuitEditor session={session} blockActions={blockActions} readOnly={!editable} canEdit={mode?.isEditable} />;
}

export function mountCircuit(container: HTMLElement, session: CircuitSession, manager: SessionManager,
	blockActions?: CircuitBlockActions, onUnmount?: () => void, mode?: CircuitInteractionMode): () => void {
	const root = createRoot(container);
	root.render(<MountedCircuit session={session} blockActions={blockActions} mode={mode} />);
	let released = false;
	let release = (): void => undefined;
	const unmount = (): void => {
		if (released) return;
		released = true;
		try { onUnmount?.(); }
		finally {
			try { root.unmount(); }
			finally { release(); }
		}
	};
	release = manager.mount(session, unmount);
	return unmount;
}
