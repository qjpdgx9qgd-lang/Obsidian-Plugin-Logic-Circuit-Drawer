export type GateType = 'and' | 'or' | 'not' | 'nand' | 'nor' | 'xor' | 'xnor';
export type NodeType = GateType | 'input' | 'output' | 'junction';

export interface Position { x: number; y: number }

export interface CircuitNode {
	id: string;
	type: NodeType;
	position: Position;
	label?: string;
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
