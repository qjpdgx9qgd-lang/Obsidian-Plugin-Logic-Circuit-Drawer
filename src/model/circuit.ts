import type { CircuitData, CircuitEdge, CircuitNode, Position } from './types';
import { CircuitValidationError, pinsFor, validateCircuit } from './validation';
export { CircuitValidationError, pinsFor, MIN_SCALE, MAX_SCALE, MAX_LABEL_LENGTH, MAX_BLACKBOX_PINS, MAX_POSITION, MAX_NODES, MAX_EDGES } from './validation';

export function createId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function newCircuit(scale = 1): CircuitData {
	return validateCircuit({ schemaVersion: 1, circuitId: createId(), nodes: [], edges: [], view: { preferredScale: scale } });
}

export function parseCircuit(json: string): CircuitData {
	let value: unknown;
	try { value = JSON.parse(json); }
	catch { throw new CircuitValidationError('Circuit data is not valid JSON. Open Source mode to correct the original block.'); }
	return validateCircuit(value);
}

export function serializeCircuit(data: CircuitData): string { return JSON.stringify(validateCircuit(data), null, 2); }

export function connect(data: CircuitData, sourceNodeId: string, sourcePinId: string, targetNodeId: string, targetPinId: string): CircuitData {
	const source = data.nodes.find(node => node.id === sourceNodeId);
	const target = data.nodes.find(node => node.id === targetNodeId);
	if (!source || !target) throw new CircuitValidationError('This connection is no longer available.');
	if (pinsFor(source.type, source).inputs.includes(sourcePinId) && pinsFor(target.type, target).outputs.includes(targetPinId)) {
		return connect(data, targetNodeId, targetPinId, sourceNodeId, sourcePinId);
	}
	const result = { ...data, edges: [...data.edges, { id: createId(), sourceNodeId, sourcePinId, targetNodeId, targetPinId }] };
	return validateCircuit(result);
}

/** Change a black box's caption and pin counts without silently dropping wires. */
export function reconfigureBlackbox(data: CircuitData, nodeId: string,
	config: { label: string; inputCount: number; outputCount: number }): CircuitData {
	const node = data.nodes.find(item => item.id === nodeId);
	if (!node || node.type !== 'blackbox') throw new CircuitValidationError('This black box is no longer available.');
	const next = pinsFor('blackbox', config);
	const attached = data.edges.some(edge =>
		(edge.sourceNodeId === nodeId && !next.outputs.includes(edge.sourcePinId))
		|| (edge.targetNodeId === nodeId && !next.inputs.includes(edge.targetPinId)));
	if (attached) throw new CircuitValidationError('Disconnect wires from pins that would be removed before changing this black box.');
	const result: CircuitData = {
		...data,
		nodes: data.nodes.map(item => item.id === nodeId ? { ...item, label: config.label, inputCount: config.inputCount, outputCount: config.outputCount } : item),
	};
	return validateCircuit(result);
}

export function branchEdge(data: CircuitData, edgeId: string, position: Position, targetNodeId: string, targetPinId: string): CircuitData {
	const original = data.edges.find(edge => edge.id === edgeId);
	if (!original) throw new CircuitValidationError('The wire no longer exists.');
	if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new CircuitValidationError('Junction position must be finite.');
	// Endpoint branches reuse the actual junction rather than adding coincident dots.
	const existing = data.nodes
		.filter(node => node.type === 'junction' && (node.id === original.sourceNodeId || node.id === original.targetNodeId))
		.map(node => ({ node, distance: Math.hypot(node.position.x - position.x, node.position.y - position.y) }))
		.filter(candidate => candidate.distance <= 12)
		.sort((a, b) => a.distance - b.distance)[0]?.node;
	if (existing) return connect(data, existing.id, 'out', targetNodeId, targetPinId);
	const junction: CircuitNode = { id: createId(), type: 'junction', position: { ...position } };
	const result: CircuitData = {
		...data, nodes: [...data.nodes, junction],
		edges: [
			...data.edges.map(edge => edge.id === edgeId ? { ...edge, targetNodeId: junction.id, targetPinId: 'in-1' } : edge),
			{ ...original, id: createId(), sourceNodeId: junction.id, sourcePinId: 'out' },
			{ id: createId(), sourceNodeId: junction.id, sourcePinId: 'out', targetNodeId, targetPinId },
		],
	};
	return validateCircuit(result);
}

function cleanupJunctions(data: CircuitData): CircuitData {
	let result = data;
	for (;;) {
		const incoming = new Set(result.edges.map(edge => edge.targetNodeId));
		const outgoing = new Set(result.edges.map(edge => edge.sourceNodeId));
		const invalid = new Set(result.nodes.filter(node => node.type === 'junction' && (!incoming.has(node.id) || !outgoing.has(node.id))).map(node => node.id));
		if (!invalid.size) return result;
		result = { ...result, nodes: result.nodes.filter(node => !invalid.has(node.id)), edges: result.edges.filter(edge => !invalid.has(edge.sourceNodeId) && !invalid.has(edge.targetNodeId)) };
	}
}

export function deleteElements(data: CircuitData, nodeIds: string[], edgeIds: string[]): CircuitData {
	const deletedNodes = new Set(nodeIds);
	const deletedEdges = new Set(edgeIds);
	const nodes = new Map(data.nodes.map(node => [node.id, node]));
	const retainedEdges = data.edges.filter(edge => !deletedEdges.has(edge.id));
	const incoming = new Map(retainedEdges.map(edge => [edge.targetNodeId, edge]));
	function sourceFor(edge: CircuitEdge): { nodeId: string; pinId: string } | null {
		let nodeId = edge.sourceNodeId;
		let pinId = edge.sourcePinId;
		const visited = new Set<string>();
		while (deletedNodes.has(nodeId)) {
			if (nodes.get(nodeId)?.type !== 'junction' || visited.has(nodeId)) return null;
			visited.add(nodeId);
			const parent = incoming.get(nodeId);
			if (!parent) return null;
			nodeId = parent.sourceNodeId;
			pinId = parent.sourcePinId;
		}
		return { nodeId, pinId };
	}
	const edges: CircuitEdge[] = [];
	for (const edge of retainedEdges) {
		if (deletedNodes.has(edge.targetNodeId)) continue;
		const source = sourceFor(edge);
		if (source) edges.push({ ...edge, sourceNodeId: source.nodeId, sourcePinId: source.pinId });
	}
	const result = cleanupJunctions({ ...data, nodes: data.nodes.filter(node => !deletedNodes.has(node.id)), edges });
	return validateCircuit(result);
}
