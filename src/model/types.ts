export type GateType = 'and' | 'or' | 'not' | 'nand' | 'nor' | 'xor' | 'xnor';
export type NodeType = GateType | 'input' | 'output' | 'junction' | 'blackbox';

export interface Position { x: number; y: number }

export interface CircuitNode {
	id: string;
	type: NodeType;
	position: Position;
	label?: string;
	/** Black boxes only: how many incoming pins the square exposes. */
	inputCount?: number;
	/** Black boxes only: how many outgoing pins the square exposes. */
	outputCount?: number;
}

export interface CircuitEdge {
	id: string;
	sourceNodeId: string;
	sourcePinId: string;
	targetNodeId: string;
	targetPinId: string;
}

export interface CircuitData {
	schemaVersion: 1;
	circuitId: string;
	nodes: CircuitNode[];
	edges: CircuitEdge[];
	view: { preferredScale: number };
}
