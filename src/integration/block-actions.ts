import { Menu, Notice } from 'obsidian';
import type { CircuitSession } from './session';
import { scanCircuitBlocks } from '../storage/blocks';
import { structuralBaseline } from '../storage/block-operations';
import type { CircuitBlockActions } from '../ui/BlockTools';

/** Re-read after pending diagram saves, then guard the complete source fence. */
export async function sessionBlockBaseline(session: CircuitSession, text: string) {
	const baseline = session.getBlockBaseline();
	const blocks = scanCircuitBlocks(text);
	const candidates = blocks.filter(block => baseline.circuitId ? block.circuitId === baseline.circuitId : block.content === baseline.content);
	const located = session.host.locate?.(text);
	if (candidates.length > 1 && session.host.locate && located === undefined) throw new Error('This view is out of date. Reopen the note before changing this circuit block.');
	const block = candidates.length === 1 ? candidates[0] : candidates.find(block => block.from === (located ?? baseline.from));
	if (!block || block.content !== baseline.content) throw new Error('This circuit block changed in the note. Reopen it before changing it.');
	return structuralBaseline(text, block);
}

export function circuitBlockActions(session: CircuitSession, move?: CircuitBlockActions['move'], cancelMove?: () => void): CircuitBlockActions {
	const insertLine = async (side: 'before' | 'after'): Promise<void> => {
		await session.flush();
		const { store, file, editor } = session.host;
		const text = await store.read(file, editor);
		await store.insertBlockLine(file, editor, await sessionBlockBaseline(session, text), side);
		session.setBlockSelected(false);
		await session.finish();
	};
	const addLine = (side: 'before' | 'after'): void => {
		void insertLine(side).catch((reason: unknown) => {
			new Notice(reason instanceof Error ? reason.message : 'The line could not be inserted.');
		});
	};
	return {
		remove: async () => {
			await session.flush();
			const { store, file, editor } = session.host;
			const text = await store.read(file, editor);
			await store.deleteBlock(file, editor, await sessionBlockBaseline(session, text));
		},
		menu: (event, remove, onClose?: () => void) => {
			const menu = new Menu();
			menu.onHide(() => onClose?.());
			menu.addItem(item => item.setTitle('Insert line before').setIcon('arrow-up').onClick(() => addLine('before')));
			menu.addItem(item => item.setTitle('Insert line after').setIcon('arrow-down').onClick(() => addLine('after')));
			menu.addItem(item => item.setTitle('Delete circuit block').setIcon('trash-2').setWarning(true).onClick(remove));
			menu.showAtMouseEvent(event);
		},
		move,
		cancelMove,
	};
}
