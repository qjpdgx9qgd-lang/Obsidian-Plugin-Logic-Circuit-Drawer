import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertNoRuntimeScripts, restrictReactDom } from '../scripts/no-runtime-scripts.mjs';

for (const variant of ['production', 'development']) {
	test(`an unaudited React DOM ${variant} upgrade cannot silently restore script loading`, async () => {
		const upstream = await readFile(`node_modules/react-dom/cjs/react-dom-client.${variant}.js`, 'utf8');
		assert.throws(() => assertNoRuntimeScripts(upstream), /Runtime script construction remains/);
		assert.doesNotThrow(() => assertNoRuntimeScripts(restrictReactDom(upstream, variant)));
		assert.throws(() => restrictReactDom(upstream + '\n// An upstream change\n', variant), /differs from the audited/);
	});
}

test('the release audit rejects script factories, parser insertion and generated executable code', () => {
	for (const source of [
		'document.createElement("script")',
		'document["createElement"]("script")',
		'document.createElementNS("http://www.w3.org/2000/svg", "svg:SCRIPT")',
		'element.innerHTML = "<script src=external></script>"',
		'element.innerHTML = "<script/>"',
		'element["innerHTML"] = "<script/>"',
		'eval("unbundledCode()")',
		'new Function("unbundledCode()")',
		'Function("unbundledCode()")',
	]) assert.throws(() => assertNoRuntimeScripts(source), /Runtime (script construction|code generation) remains/);
	assert.doesNotThrow(() => assertNoRuntimeScripts('document.createElement("div"); document.createElementNS("http://www.w3.org/2000/svg", "path");'));
});
