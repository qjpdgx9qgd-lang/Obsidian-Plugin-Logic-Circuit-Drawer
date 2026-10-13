import type { CircuitData, CircuitEdge, CircuitNode, NodeType } from '../model/types';
import type { Point } from './geometry';

/** Deterministic orthogonal routing, including a visible loop for backwards wires. */
export function wirePoints(source: Point, target: Point): Point[] {
	if (target.x - source.x >= 40) {
		const middle = (source.x + target.x) / 2;
		return [source, { x: middle, y: source.y }, { x: middle, y: target.y }, target];
	}
	const right = source.x + 24;
	const left = target.x - 24;
	const bottom = Math.max(source.y, target.y) + 32;
	return [source, { x: right, y: source.y }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: target.y }, target];
}

type Cardinal = 'right' | 'bottom' | 'left' | 'top';
interface RoutingDirections { source?: Cardinal; target?: Cardinal }
const DIRECTIONS: Record<Cardinal, Point> = { right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, top: { x: 0, y: -1 } };

function toward(from: Point, to: Point): Cardinal {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
}

function simplify(points: Point[]): Point[] {
	const result: Point[] = [];
	for (const point of points) {
		const previous = result.at(-1);
		if (previous?.x === point.x && previous.y === point.y) continue;
		const earlier = result.at(-2);
		if (previous && earlier && ((earlier.x === previous.x && previous.x === point.x) || (earlier.y === previous.y && previous.y === point.y))) result.pop();
		result.push(point);
	}
	return result;
}

/** A junction has no fixed input/output side: every wire meets the dot itself. */
export function routedWirePoints(source: Point, target: Point, sourceType?: NodeType, targetType?: NodeType, directions: RoutingDirections = {}): Point[] {
	if (sourceType !== 'junction' && targetType !== 'junction') return wirePoints(source, target);
	if (source.x === target.x && source.y === target.y) return [source, target];
	const from = DIRECTIONS[directions.source ?? (sourceType === 'junction' ? toward(source, target) : 'right')];
	const to = DIRECTIONS[directions.target ?? (targetType === 'junction' ? toward(target, source) : 'left')];
	if (source.y === target.y && from.x && from.x === to.x) {
		const first = source.x + from.x * 24;
		const last = target.x + to.x * 24;
		const bottom = source.y + 32;
		return [source, { x: first, y: source.y }, { x: first, y: bottom }, { x: last, y: bottom }, { x: last, y: target.y }, target];
	}
	const xs = [...new Set([source.x, target.x, (source.x + target.x) / 2, source.x + 24, source.x - 24, target.x + 24, target.x - 24])];
	// Prefer extending downward for a detour so the fixed top boundary is safe.
	const ys = [...new Set([source.y, target.y, (source.y + target.y) / 2, Math.max(source.y, target.y) + 32])];
	const candidates: Point[][] = [[source, target], [source, { x: target.x, y: source.y }, target], [source, { x: source.x, y: target.y }, target]];
	for (const x of xs) candidates.push([source, { x, y: source.y }, { x, y: target.y }, target]);
	for (const y of ys) candidates.push([source, { x: source.x, y }, { x: target.x, y }, target]);
	for (const x of xs) for (const y of ys) {
		candidates.push([source, { x, y: source.y }, { x, y }, { x: target.x, y }, target]);
		candidates.push([source, { x: source.x, y }, { x, y }, { x, y: target.y }, target]);
	}
	let best: Point[] | undefined;
	let bestCost = Infinity;
	for (const candidate of candidates) {
		const points = simplify(candidate);
		const first = points[1];
		const last = points.at(-2);
		if (!first || !last) continue;
		if ((first.x - source.x) * from.x + (first.y - source.y) * from.y <= 0) continue;
		if ((last.x - target.x) * to.x + (last.y - target.y) * to.y <= 0) continue;
		let distance = 0;
		let valid = true;
		for (let index = 1; index < points.length; index++) {
			const a = points[index - 1]!;
			const b = points[index]!;
			if (a.x !== b.x && a.y !== b.y) { valid = false; break; }
			distance += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
		}
		const cost = distance + (points.length - 2) * 8;
		if (valid && cost < bestCost) { best = points; bestCost = cost; }
	}
	return best ?? wirePoints(source, target);
}

/** Recover the trunk's tangents instead of routing every split wire in isolation. */
function trunkAt(points: Point[], junction: Point): { distance: number; incoming: Cardinal; outgoing: Cardinal; before?: Point[]; after?: Point[] } {
	const route = simplify(points);
	let best: ReturnType<typeof trunkAt> = { distance: Infinity, incoming: 'left', outgoing: 'right' };
	for (let index = 1; index < route.length; index++) {
		const a = route[index - 1]!;
		const b = route[index]!;
		const projection = a.x === b.x
			? { x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), junction.y)) }
			: { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), junction.x)), y: a.y };
		const distance = Math.hypot(projection.x - junction.x, projection.y - junction.y);
		if (distance >= best.distance) continue;
		const atStart = projection.x === a.x && projection.y === a.y;
		const atEnd = projection.x === b.x && projection.y === b.y;
		const before = atStart && route[index - 2] ? route[index - 2]! : a;
		const after = atEnd && route[index + 1] ? route[index + 1]! : b;
		best = {
			distance,
			incoming: before.x === projection.x && before.y === projection.y ? toward(b, a) : toward(projection, before),
			outgoing: after.x === projection.x && after.y === projection.y ? toward(a, b) : toward(projection, after),
			...(distance === 0 ? { before: simplify([...route.slice(0, index), junction]), after: simplify([junction, ...route.slice(index)]) } : {}),
		};
	}
	return best;
}

/** One circuit-aware route map is shared by drawing, bounds and wire hit tests. */
export function routesForCircuit(circuit: CircuitData, pointFor: (node: CircuitNode, pin: string) => Point): Map<string, Point[]> {
	const nodes = new Map(circuit.nodes.map(node => [node.id, node]));
	const incoming = new Map(circuit.edges.map(edge => [edge.targetNodeId, edge]));
	const outgoing = new Map<string, CircuitEdge[]>();
	for (const edge of circuit.edges) {
		const edges = outgoing.get(edge.sourceNodeId) ?? [];
		edges.push(edge); outgoing.set(edge.sourceNodeId, edges);
	}
	const directions = new Map<string, RoutingDirections>();
	const exactRoutes = new Map<string, Point[]>();
	for (const junction of circuit.nodes) {
		if (junction.type !== 'junction') continue;
		const parent = incoming.get(junction.id);
		const source = parent && nodes.get(parent.sourceNodeId);
		if (!parent || !source) continue;
		const start = pointFor(source, parent.sourcePinId);
		const dot = pointFor(junction, 'in-1');
		let continuation: { edge: CircuitEdge; trunk: ReturnType<typeof trunkAt> } | undefined;
		for (const edge of outgoing.get(junction.id) ?? []) {
			const target = nodes.get(edge.targetNodeId);
			if (!target) continue;
			const trunk = trunkAt(routedWirePoints(start, pointFor(target, edge.targetPinId), source.type, target.type), dot);
			// A newly split wire keeps its original continuation first; use that
			// stable order only when two restored routes are equally close.
			if (!continuation || trunk.distance < continuation.trunk.distance) continuation = { edge, trunk };
		}
		if (!continuation) continue;
		directions.set(parent.id, { ...directions.get(parent.id), target: continuation.trunk.incoming });
		directions.set(continuation.edge.id, { ...directions.get(continuation.edge.id), source: continuation.trunk.outgoing });
		if (continuation.trunk.before) exactRoutes.set(parent.id, continuation.trunk.before);
		if (continuation.trunk.after) exactRoutes.set(continuation.edge.id, continuation.trunk.after);
	}
	const routes = new Map<string, Point[]>();
	for (const edge of circuit.edges) {
		const source = nodes.get(edge.sourceNodeId);
		const target = nodes.get(edge.targetNodeId);
		if (source && target) routes.set(edge.id, exactRoutes.get(edge.id) ?? routedWirePoints(pointFor(source, edge.sourcePinId), pointFor(target, edge.targetPinId), source.type, target.type, directions.get(edge.id)));
	}
	return routes;
}
