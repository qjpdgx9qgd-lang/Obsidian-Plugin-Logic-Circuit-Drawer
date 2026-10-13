import type { App, Editor, MarkdownPostProcessorContext, TFile } from 'obsidian';
import { SessionManager } from '../src/integration/session-manager';
import { renderReadingCircuit } from '../src/integration/reading-view';
import { scanCircuitBlocks } from '../src/storage/blocks';
import type { LogicBlock } from '../src/storage/blocks';

interface Host {
	app: App;
	parent: HTMLElement;
	pane: { file: TFile | null; mode: 'source' | 'preview' };
	file: TFile;
	otherFile: TFile;
	editor: Editor;
	text: () => string;
}

interface Fixture {
	manager: SessionManager;
	element: HTMLDivElement;
	block: LogicBlock;
	load: () => void;
	unload: () => void;
}

/** Exercise the actual postprocessor before Obsidian attaches its output DOM. */
export async function verifyDetachedReading(host: Host) {
	const frame = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
	const originalObserver = window.MutationObserver;
	const activeObservers = new Set<MutationObserver>();
	class TrackedObserver extends originalObserver {
		observe(target: Node, options?: MutationObserverInit) {
			activeObservers.add(this); super.observe(target, options);
		}
		disconnect() { activeObservers.delete(this); super.disconnect(); }
	}
	window.MutationObserver = TrackedObserver;
	const fixtures: Fixture[] = [];
	const initialFile = host.pane.file;
	function create(): Fixture {
		const manager = new SessionManager(host.app);
		const element = document.createElement('div'); element.className = 'reading-fallback-hidden';
		const block = scanCircuitBlocks(host.text())[0]!;
		let child: { onload(): void; onunload(): void } | undefined;
		const context = {
			sourcePath:host.file.path,
			addChild:(next:typeof child) => { child = next; next?.onload(); },
			getSectionInfo:() => ({ text:host.text(), lineStart:block.startLine, lineEnd:block.endLine }),
		} as unknown as MarkdownPostProcessorContext;
		const fixture = { manager, element, block,
			load:() => renderReadingCircuit(host.app, manager, block.content, element, context),
			unload:() => child?.onunload(),
		};
		fixtures.push(fixture);
		return fixture;
	}
	try {
		const attached = create();
		const read = attached.manager.store.read.bind(attached.manager.store);
		let readDetached = false;
		attached.manager.store.read = (...args) => { readDetached = !attached.element.isConnected; return read(...args); };
		attached.load(); await frame();
		const waited = { empty:attached.element.childElementCount === 0, observed:activeObservers.size > 0, readDetached };
		host.parent.append(attached.element); await frame();
		const session = attached.manager.open(host.file, host.pane, attached.block);
		const afterAttach = {
			mounted:Boolean(attached.element.querySelector('.logic-circuit')),
			grip:Boolean(attached.element.querySelector('button.logic-block-grip[aria-labelledby]')),
			editor:session.host.editor === host.editor,
			observers:activeObservers.size,
		};
		attached.unload(); attached.manager.dispose(); attached.element.remove();
		const cancelled = create(); cancelled.load(); await frame();
		const childWaiting = activeObservers.size > 0;
		cancelled.unload(); await frame();
		host.parent.append(cancelled.element); await frame();
		const childCancelled = { waiting:childWaiting, empty:cancelled.element.childElementCount === 0, observers:activeObservers.size };
		cancelled.manager.dispose(); cancelled.element.remove();
		const disposed = create(); disposed.load(); await frame();
		const pluginWaiting = activeObservers.size > 0;
		disposed.manager.dispose(); await frame();
		host.parent.append(disposed.element); await frame();
		const pluginCancelled = { waiting:pluginWaiting, empty:disposed.element.childElementCount === 0, observers:activeObservers.size };
		disposed.unload(); disposed.element.remove();
		const navigated = create(); host.parent.append(navigated.element);
		const readBeforeNavigation = navigated.manager.store.read.bind(navigated.manager.store);
		let releaseRead = () => {};
		const pendingRead = new Promise<void>(resolve => { releaseRead = resolve; });
		let readPending = false;
		navigated.manager.store.read = async (...args) => {
			const text = await readBeforeNavigation(...args); readPending = true; await pendingRead; return text;
		};
		navigated.load(); await frame();
		host.pane.file = host.otherFile; releaseRead(); await frame();
		const navigation = { readPending, empty:navigated.element.childElementCount === 0, observers:activeObservers.size };
		return { waited, afterAttach, childCancelled, pluginCancelled, navigation };
	} finally {
		host.pane.file = initialFile;
		for (const fixture of fixtures) { fixture.unload(); fixture.manager.dispose(); fixture.element.remove(); }
		window.MutationObserver = originalObserver;
	}
}
