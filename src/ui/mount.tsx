import { createRoot } from 'react-dom/client';
import { CircuitEditor } from './CircuitEditor';
import type { CircuitSession } from '../integration/session';
import type { SessionManager } from '../integration/session-manager';
import type { CircuitBlockActions } from './BlockTools';

export function mountCircuit(container: HTMLElement, session: CircuitSession, manager: SessionManager,
	blockActions?: CircuitBlockActions, onUnmount?: () => void): () => void {
	const root = createRoot(container);
	root.render(<CircuitEditor session={session} blockActions={blockActions} />);
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
