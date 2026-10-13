import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainNodePosition, scaleStep } from '../src/ui/canvasLayout';
import { GRID, localPinPoint, sizeFor } from '../src/ui/geometry';

void test('boundary constraints preserve a common connector lattice for different node sizes', () => {
	for (const type of ['and', 'not', 'input', 'output', 'junction'] as const) {
		const node = { type, label: 'Enable' };
		for (const position of [{ x: -100, y: -100 }, { x: 1000, y: 73 }, { x: 81, y: 97 }]) {
			const constrained = constrainNodePosition(node, position, { left: -7, top: 3, width: 500 });
			const size = sizeFor(node);
			assert.ok(constrained.x >= -7 && constrained.x + size.width <= 493);
			assert.ok(constrained.y >= 3);
			const pin = localPinPoint(node, type === 'output' ? 'in-1' : 'out');
			assert.equal((constrained.x + pin.x) % GRID, 0);
			assert.equal((constrained.y + pin.y) % GRID, 0);
		}
	}
});

void test('scale buttons move to whole ten-point percentages and respect the width limit', () => {
	assert.equal(scaleStep(.892, 1, 3), .9);
	assert.equal(scaleStep(.892, -1, 3), .8);
	assert.equal(scaleStep(.9, 1, 3), 1);
	assert.equal(scaleStep(.9, -1, 3), .8);
	assert.equal(scaleStep(.25, 1, 3), .3);
	assert.equal(scaleStep(.3, -1, 3), .25);
	assert.equal(scaleStep(.25, -1, 3), null);
	assert.equal(scaleStep(3, 1, 3), null);
	assert.equal(scaleStep(.8, 1, .892), null, 'Fit reaches the exact cap without a decimal button step');
});
