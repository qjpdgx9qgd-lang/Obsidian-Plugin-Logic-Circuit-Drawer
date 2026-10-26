import type { DragEvent } from 'react';
import type { NodeType } from '../model/types';
import { GateSymbol } from './GateSymbol';
import { AccessibleButton, useAccessibleLabel } from './accessibility';

export const PLACEMENT_MIME = 'application/x-obsidian-logic-node';
const TOOLS: NodeType[] = ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'blackbox', 'input', 'output'];
const NAMES: Partial<Record<NodeType, string>> = { blackbox: 'Black box', input: 'Input', output: 'Output' };
export function CircuitToolbar({ tool, select, canUndo, canRedo, undo, redo, canDelete, remove, done, busy, locked }: {
	tool: NodeType | null; select: (type: NodeType | null) => void;
	canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
	canDelete: boolean; remove: () => void;
	done: () => void; busy: boolean; locked: boolean;
}) {
	const name = useAccessibleLabel('Circuit editing tools');
	const drag = (event: DragEvent, type: NodeType) => {
		event.dataTransfer.setData(PLACEMENT_MIME, type); event.dataTransfer.effectAllowed = 'copy'; select(type);
	};
	return <div className="logic-toolbar" role="toolbar" aria-labelledby={name.id}>
		{name.label}
		<div className="logic-tools">
			{TOOLS.map(type => <AccessibleButton key={type} type="button" className={`logic-tool${tool === type ? ' is-active' : ''}`} label={`Place ${NAMES[type] ?? type.toUpperCase()}`} aria-pressed={tool === type} title={NAMES[type] ?? type.toUpperCase()} disabled={locked} draggable={!locked} onDragStart={event => drag(event, type)} onDragEnd={() => select(null)} onClick={() => select(tool === type ? null : type)}>
				{type === 'input' || type === 'output' ? <span className="logic-terminal-tool">{type === 'input' ? 'Input' : 'Output'}<span aria-hidden="true">{type === 'input' ? '→' : '←'}</span></span>
					: type === 'blackbox' ? <><svg viewBox="0 0 36 23" width="36" height="23" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5.5" y="4.5" width="25" height="14" rx="1" /><path d="M1 8h4.5M1 15h4.5M30.5 8H35M30.5 15H35" /></svg><span>Box</span></>
					: <><GateSymbol type={type} /><span>{type.toUpperCase()}</span></>}
			</AccessibleButton>)}
		</div>
		<div className="logic-history-tools">
			<AccessibleButton type="button" className="logic-delete" label="Delete selected elements" title="Delete" disabled={!canDelete || locked} onClick={remove}>
				<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
			</AccessibleButton>
			<AccessibleButton type="button" label="Undo circuit edit" title="Undo" disabled={!canUndo || locked} onClick={undo}>↶</AccessibleButton>
			<AccessibleButton type="button" label="Redo circuit edit" title="Redo" disabled={!canRedo || locked} onClick={redo}>↷</AccessibleButton>
			<button type="button" className="logic-done" disabled={locked} onClick={done}>{busy ? 'Saving…' : 'Done'}</button>
		</div>
	</div>;
}
