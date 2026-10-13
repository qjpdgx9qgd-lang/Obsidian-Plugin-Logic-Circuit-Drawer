import type { NodeType } from '../model/types';
import { GATE_HEIGHT, GATE_WIDTH } from './geometry';

export function GateSymbol({ type, className }: { type: NodeType; className?: string }) {
	const inverted = type === 'nand' || type === 'nor' || type === 'xnor' || type === 'not';
	const or = type === 'or' || type === 'nor' || type === 'xor' || type === 'xnor';
	const xor = type === 'xor' || type === 'xnor';
	const tip = 68;
	// At y=16 and y=48 the concave OR outline intersects x=918/49.
	// Leads terminate on that outline, including the extra XOR curve.
	const inputEnd = or ? 918 / 49 : 12;
	return <svg className={className} viewBox={`0 0 ${GATE_WIDTH} ${GATE_HEIGHT}`} aria-hidden="true">
		<g className="logic-symbol-lines" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
			{type === 'not' ? <path data-circuit-connector="in-1" d="M 0,32 H 12" /> : <>
				<path data-circuit-connector="in-1" d={`M 0,16 H ${inputEnd}`} />
				<path data-circuit-connector="in-2" d={`M 0,48 H ${inputEnd}`} />
			</>}
			<path data-circuit-connector="out" d={`M ${tip + (inverted ? 8 : 0)},32 H ${GATE_WIDTH}`} />
			{type === 'not' ? <path className="logic-symbol-body" d="M 12,4 L 68,32 L 12,60 Z" />
				: or ? <path className="logic-symbol-body" d="M 12,4 Q 42,2 68,32 Q 42,62 12,60 Q 32,32 12,4 Z" />
					: <path className="logic-symbol-body" d="M 12,4 H 40 A 28,28 0 0 1 40,60 H 12 Z" />}
			{xor && <path d="M 4,4 Q 24,32 4,60" />}
			{inverted && <circle className="logic-symbol-body" cx={tip + 4} cy="32" r="4" />}
		</g>
	</svg>;
}
