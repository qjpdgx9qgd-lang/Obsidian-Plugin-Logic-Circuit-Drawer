import { terminalGeometry, TERMINAL_PIN_OFFSET, TERMINAL_RADIUS } from './geometry';

export function TerminalPreview({ type, label, scale }: { type: 'input' | 'output'; label: string; scale: number }) {
	const shape = terminalGeometry(label);
	return <div className="logic-preview-terminal" style={{ width: shape.width, height: shape.height, transform: `scale(${scale})` }}>
		<div className="logic-terminal-body" style={{ top: shape.labelTop, height: shape.labelHeight }}><span className="logic-terminal-label">{label}</span></div>
		<svg className="logic-terminal-marker" viewBox={`0 0 ${shape.width} 16`} style={{ top: shape.markerTop, width: shape.width, height: 16 }} aria-hidden="true">
			<path d={type === 'input' ? `M ${shape.markerX + TERMINAL_RADIUS},8 H ${shape.markerX + TERMINAL_PIN_OFFSET}`
				: `M ${shape.markerX - TERMINAL_PIN_OFFSET},8 H ${shape.markerX - TERMINAL_RADIUS}`} />
			<circle cx={shape.markerX} cy="8" r={TERMINAL_RADIUS} />
		</svg>
	</div>;
}
