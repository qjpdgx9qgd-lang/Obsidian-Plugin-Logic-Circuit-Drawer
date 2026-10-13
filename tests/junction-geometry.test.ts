import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, newCircuit } from '../src/model/circuit';
import type { CircuitNode } from '../src/model/types';
import { boundsFor, edgeWirePoints, localPinPoint, pinPoint, routedWirePoints, wirePoints, wireRoutesFor, type Point } from '../src/ui/geometry';
import { connectionPreviewPoints, flowHandlesFor, logicalJunctionPin, normalizeFlowConnection } from '../src/ui/junction-connections';

const junction: CircuitNode = { id: 'j', type: 'junction', position: { x: 248, y: 248 } };
const center = { x: 256, y: 256 };
const neighbors = [
	{ side: 'right', point: { x: 448, y: 256 }, vector: { x: 1, y: 0 } },
	{ side: 'left', point: { x: 80, y: 256 }, vector: { x: -1, y: 0 } },
	{ side: 'top', point: { x: 256, y: 112 }, vector: { x: 0, y: -1 } },
	{ side: 'bottom', point: { x: 256, y: 400 }, vector: { x: 0, y: 1 } },
] as const;

function checkRoute(points: Point[], start: Point, end: Point) {
	assert.deepEqual(points[0], start);
	assert.deepEqual(points.at(-1), end);
	for (let index = 1; index < points.length; index++) {
		const previous = points[index - 1]!;
		const current = points[index]!;
		assert.ok(previous.x === current.x || previous.y === current.y, 'all wire segments are orthogonal');
	}
	assert.ok(points.every(point => point.y >= Math.min(start.y, end.y)), 'detours grow downward instead of crossing the fixed top');
}

void test('junctions meet at one center and can route from any of four sides', () => {
	assert.deepEqual(localPinPoint(junction, 'in-1'), { x: 8, y: 8 });
	assert.deepEqual(localPinPoint(junction, 'out'), { x: 8, y: 8 });
	for (const { point, vector } of neighbors) {
		const outgoing = routedWirePoints(center, point, 'junction', 'output');
		checkRoute(outgoing, center, point);
		const next = outgoing[1]!;
		assert.ok((next.x - center.x) * vector.x + (next.y - center.y) * vector.y > 0, 'outgoing wire leaves the nearest cardinal side');
		const incoming = routedWirePoints(point, center, 'input', 'junction');
		checkRoute(incoming, point, center);
		const previous = incoming.at(-2)!;
		assert.ok((previous.x - center.x) * vector.x + (previous.y - center.y) * vector.y > 0, 'incoming wire enters the nearest cardinal side');
	}
});

void test('junction-to-junction routes have no directional stubs or excess loops', () => {
	for (const { point } of neighbors) {
		assert.deepEqual(routedWirePoints(center, point, 'junction', 'junction'), [center, point]);
	}
	const another: CircuitNode = { id: 'j2', type: 'junction', position: { x: 312, y: 312 } };
	const points = edgeWirePoints(junction, 'out', another, 'in-1');
	checkRoute(points, pinPoint(junction, 'out'), pinPoint(another, 'in-1'));
});

void test('nearby junction routes keep their chosen cardinal side in every quadrant', () => {
	for (const dx of [-64, -32, -16, -8, 0, 8, 16, 32, 64]) for (const dy of [-64, -32, -16, -8, 0, 8, 16, 32, 64]) {
		if (!dx && !dy) continue;
		const other = { x: center.x + dx, y: center.y + dy };
		const vector = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
		const outgoing = routedWirePoints(center, other, 'junction', 'and');
		checkRoute(outgoing, center, other);
		assert.ok((outgoing[1]!.x - center.x) * vector.x + (outgoing[1]!.y - center.y) * vector.y > 0, `outgoing offset ${dx},${dy}`);
		const incoming = routedWirePoints(other, center, 'and', 'junction');
		checkRoute(incoming, other, center);
		const previous = incoming.at(-2)!;
		assert.ok((previous.x - center.x) * vector.x + (previous.y - center.y) * vector.y > 0, `incoming offset ${dx},${dy}`);
	}
});

void test('cardinal editor handles never leak into persisted electrical pins', () => {
	const data = newCircuit();
	const input: CircuitNode = { id: 'a', type: 'input', label: 'A', position: { x: 0, y: 0 } };
	const output: CircuitNode = { id: 'y', type: 'output', label: 'Y', position: { x: 400, y: 0 } };
	data.nodes = [input, junction, output];
	data.edges = [{ id: 'a-j', sourceNodeId: 'a', sourcePinId: 'out', targetNodeId: 'j', targetPinId: 'in-1' }];
	for (const { side } of neighbors) {
		const forward = normalizeFlowConnection(data, { source: junction.id, sourceHandle: `junction-${side}`, target: output.id, targetHandle: 'in-1' });
		assert.equal(forward.sourcePinId, 'out');
		const connected = connect(data, forward.sourceNodeId, forward.sourcePinId, forward.targetNodeId, forward.targetPinId);
		assert.equal(connected.edges.at(-1)!.sourcePinId, 'out');
		const reverse = normalizeFlowConnection(data, { source: output.id, sourceHandle: 'in-1', target: junction.id, targetHandle: `junction-${side}` });
		assert.equal(reverse.targetPinId, 'out');
		const incoming = normalizeFlowConnection(data, { source: junction.id, sourceHandle: `junction-${side}`, target: input.id, targetHandle: 'out' });
		assert.equal(incoming.sourcePinId, 'in-1');
		assert.equal(logicalJunctionPin(data, junction.id, `junction-${side}`, 'target'), 'in-1');
	}
	const handles = flowHandlesFor(input, 'out', junction, 'in-1');
	assert.equal(handles.sourceHandle, 'out');
	assert.ok(handles.targetHandle.startsWith('junction-'));
});

void test('reverse connection gestures use the same wire path as their completed connection', () => {
	const gate: CircuitNode = { id: 'g', type: 'and', position: { x: 400, y: 200 } };
	const input: CircuitNode = { id: 'a', type: 'input', label: 'A', position: { x: 0, y: 200 } };
	const from = pinPoint(gate, 'in-1');
	const to = pinPoint(input, 'out');
	assert.deepEqual(connectionPreviewPoints(gate, 'in-1', input, 'out', from, to), edgeWirePoints(input, 'out', gate, 'in-1').reverse());
	assert.deepEqual(connectionPreviewPoints(gate, 'in-1', undefined, undefined, from, to), routedWirePoints(to, from, undefined, 'and').reverse());
	assert.deepEqual(connectionPreviewPoints(junction, 'junction-left', input, 'out', center, to), edgeWirePoints(input, 'out', junction, 'in-1').reverse());
});

function splitTrunkFixture() {
	const circuit = newCircuit();
	circuit.nodes = [
		{ id: 'nand', type: 'nand', position: { x: 416, y: 296 } },
		{ id: 'a', type: 'input', label: 'A', position: { x: 72, y: 40 } },
		{ id: 'xor', type: 'xor', position: { x: 536, y: 128 } },
		{ id: 'j', type: 'junction', position: { x: 260, y: 176 } },
	];
	circuit.edges = [
		{ id: 'a-nand', sourceNodeId: 'a', sourcePinId: 'out', targetNodeId: 'nand', targetPinId: 'in-1' },
		{ id: 'a-xor', sourceNodeId: 'a', sourcePinId: 'out', targetNodeId: 'xor', targetPinId: 'in-1' },
		{ id: 'a-j', sourceNodeId: 'a', sourcePinId: 'out', targetNodeId: 'j', targetPinId: 'in-1' },
		{ id: 'j-nand', sourceNodeId: 'j', sourcePinId: 'out', targetNodeId: 'nand', targetPinId: 'in-2' },
		{ id: 'j-xor', sourceNodeId: 'j', sourcePinId: 'out', targetNodeId: 'xor', targetPinId: 'in-2' },
	];
	return circuit;
}

void test('a branch on the original vertical trunk preserves top/bottom wires without an extra left leg', () => {
	const circuit = splitTrunkFixture();
	const original = JSON.stringify(circuit);
	const routes = wireRoutesFor(circuit);
	assert.deepEqual(routes.get('a-j'), [{ x: 120, y: 72 }, { x: 268, y: 72 }, { x: 268, y: 184 }]);
	assert.deepEqual(routes.get('j-nand'), [{ x: 268, y: 184 }, { x: 268, y: 344 }, { x: 416, y: 344 }]);
	assert.ok(routes.get('j-xor')![1]!.x > 268, 'the new branch leaves the right side of the dot');
	assert.deepEqual(routes.get('a-nand'), wirePoints({ x: 120, y: 72 }, { x: 416, y: 312 }));
	assert.deepEqual(routes.get('a-xor'), wirePoints({ x: 120, y: 72 }, { x: 536, y: 144 }));
	assert.equal(JSON.stringify(circuit), original, 'routing does not migrate or rewrite stored circuit data');
	const bounds = boundsFor(circuit);
	assert.deepEqual(bounds.wireRoutes, routes, 'bounds and rendering use the same circuit-aware routes');
});

void test('splitting a horizontal trunk retains its original downstream bend position', () => {
	const circuit = newCircuit();
	circuit.nodes = [
		{ id: 'a', type: 'input', label: 'A', position: { x: -48, y: -32 } },
		{ id: 'g', type: 'and', position: { x: 400, y: 144 } },
		{ id: 'h', type: 'and', position: { x: 160, y: 208 } },
		{ id: 'j', type: 'junction', position: { x: 72, y: -8 } },
	];
	circuit.edges = [
		{ id: 'a-j', sourceNodeId: 'a', sourcePinId: 'out', targetNodeId: 'j', targetPinId: 'in-1' },
		{ id: 'j-g', sourceNodeId: 'j', sourcePinId: 'out', targetNodeId: 'g', targetPinId: 'in-1' },
		{ id: 'j-h', sourceNodeId: 'j', sourcePinId: 'out', targetNodeId: 'h', targetPinId: 'in-1' },
	];
	const routes = wireRoutesFor(circuit);
	assert.deepEqual(routes.get('a-j'), [{ x: 0, y: 0 }, { x: 80, y: 0 }]);
	assert.deepEqual(routes.get('j-g'), [{ x: 80, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 160 }, { x: 400, y: 160 }]);
});

void test('junction chains retain a single continuous vertical trunk', () => {
	const circuit = splitTrunkFixture();
	circuit.nodes.push({ id: 'j2', type: 'junction', position: { x: 260, y: 256 } });
	circuit.edges = circuit.edges.map(edge => edge.id === 'j-nand' ? { ...edge, targetNodeId: 'j2', targetPinId: 'in-1' } : edge);
	circuit.edges.push({ id: 'j2-nand', sourceNodeId: 'j2', sourcePinId: 'out', targetNodeId: 'nand', targetPinId: 'in-2' });
	const routes = wireRoutesFor(circuit);
	assert.deepEqual(routes.get('a-j'), [{ x: 120, y: 72 }, { x: 268, y: 72 }, { x: 268, y: 184 }]);
	assert.deepEqual(routes.get('j-nand'), [{ x: 268, y: 184 }, { x: 268, y: 264 }]);
	assert.deepEqual(routes.get('j2-nand'), [{ x: 268, y: 264 }, { x: 268, y: 344 }, { x: 416, y: 344 }]);
});
