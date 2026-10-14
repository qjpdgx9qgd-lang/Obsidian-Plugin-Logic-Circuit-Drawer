import { build } from 'esbuild';
import { noRuntimeScripts } from '../scripts/no-runtime-scripts.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'logic-circuit-drag-scroll-'));
await build({ plugins: [noRuntimeScripts()], entryPoints: ['tests/cm-harness.tsx'], bundle: true, platform: 'browser', outfile: join(directory, 'app.js'),
	alias: { obsidian: resolve('tests/browser-obsidian.ts') }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning' });
await writeFile(join(directory, 'styles.css'), await readFile('styles.css', 'utf8'));
await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>
body { margin:0; padding:36px; font:15px system-ui; --font-interface:system-ui; --font-text:system-ui; --text-normal:#25304a; --text-muted:#717b8f; --background-primary:#fff; --background-secondary:#f4f5f8; --background-modifier-border:#dce0e8; --interactive-accent:#6857d9; --text-on-accent:#fff; --interactive-normal:#f4f5f8; --interactive-hover:#e9ebf2; }
#editor { max-width:850px; margin:auto; } .cm-editor { font:15px/1.5 system-ui; background:white; } .cm-scroller { overflow:visible; } .cm-content { padding:4px 0; } button { font:inherit; cursor:pointer; } button:disabled { opacity:.4; } .browser-menu { padding:4px; background:white; border:1px solid #ccc; } .browser-notice { padding:8px; background:#fff0c0; } .reading-fallback-hidden { position:absolute; left:-10000px; top:0; width:850px; } .tail { height:400px; }
</style></head><body><button aria-label="Another app tab">Another tab</button><div id="editor" class="markdown-source-view mod-cm6"><div id="own-note-unfocusable">Note properties and title</div><label>Note field <input aria-label="Note property field"></label></div><div class="tail"><div id="outside-unfocusable">Sidebar</div><label>Sidebar field <input aria-label="Outside circuit field"></label><div class="markdown-source-view" id="other-note"><div id="other-note-unfocusable">Another note</div><input aria-label="Other note field"></div></div><script src="app.js"></script></body></html>`);
const server = createServer((request, response) => {
	const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
	const file = pathname === '/' ? 'index.html' : pathname.slice(1);
	if (!['index.html', 'app.js', 'styles.css'].includes(file)) { response.writeHead(404).end(); return; }
	void readFile(join(directory, file)).then(data => {
		response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
		response.end(data);
	}).catch(() => response.writeHead(500).end());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || join(homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
let browser;
let page;
try {
	browser = await chromium.launch({ executablePath, headless:true });
	page = await browser.newPage({ viewport:{ width:1100, height:800 } });
	page.setDefaultTimeout(10000);
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const first = () => page.locator('.cm-content .logic-circuit[data-circuit-id="first-circuit"]');
	const scroller = () => page.locator('.cm-scroller');
	const gate = () => first().locator('[data-id="original-and"] .logic-object-and');
	const measure = () => page.evaluate(() => {
		const scroll = document.querySelector('.cm-scroller');
		const circuit = document.querySelector('.cm-content .logic-circuit');
		const canvas = circuit.querySelector('.logic-canvas');
		return { scrollTop:scroll.scrollTop, pageTop:document.scrollingElement.scrollTop,
			scrollHeight:scroll.scrollHeight, clientHeight:scroll.clientHeight,
			circuitTop:circuit.getBoundingClientRect().top, canvasHeight:canvas.getBoundingClientRect().height,
			active:document.activeElement.className,
			nodeY:window.cmCircuitTest.snapshot('first-circuit').circuit.nodes[0].position.y };
	});
	const prepare = async (bottom, nativeFallback = false) => {
		await page.goto(`http://127.0.0.1:${address.port}/`);
		await page.waitForFunction(() => Boolean(window.cmCircuitTest));
		await page.addStyleTag({ content:'.cm-scroller { height:360px !important; overflow:auto !important; }' });
		await page.evaluate(({ bottom, nativeFallback }) => window.cmCircuitTest.prepareScrollScenario(bottom, nativeFallback), { bottom, nativeFallback });
		await first().getByRole('button', { name:'Done', exact:true }).waitFor();
		await frames();
		const scrollBox = await scroller().boundingBox();
		// Leave the lower part of this gate below the note viewport. All clicks
		// still use a visible part of its real symbol; no programmatic gestures.
		const node = await gate().boundingBox();
		await scroller().evaluate((element, top) => { element.scrollTop += top; }, node.y - (scrollBox.y + scrollBox.height - 30));
		await frames();
		await page.evaluate(() => window.scrollTo(0, 0));
		await frames();
	};
	// Native Editor.transaction always asks CodeMirror to scroll its Markdown
	// selection into view. Keep that caret above this circuit, then make a
	// horizontal gesture so a failed save cannot be mistaken for bounds reflow.
	for (const nativeFallback of [false, true]) {
		await prepare(false, nativeFallback);
		assert.equal(await first().evaluate(element => Boolean(element.closest('.native-fallback-widget'))), nativeFallback,
			'the regression exercises both the custom widget and the native Live Preview fallback');
		const caretSaveBefore = await measure();
		const caretSaveText = await page.evaluate(() => window.cmCircuitTest.text());
		const caretBefore = await page.evaluate(() => window.cmCircuitTest.selectionRange());
		assert.equal(caretBefore.head, 0, 'the retained Markdown caret is at the beginning of the note');
		assert.ok(caretSaveBefore.scrollTop > 500, 'the retained Markdown caret is outside the circuit viewport');
		const caretSaveNode = await gate().boundingBox();
		await page.mouse.move(caretSaveNode.x + 24, caretSaveNode.y + 12);
		await page.mouse.down();
		await page.mouse.move(caretSaveNode.x + 80, caretSaveNode.y + 12, { steps:8 });
		await frames();
		const caretSaveMoved = await measure();
		await page.mouse.up();
		await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
		await frames();
		const caretSaveAfter = await page.evaluate(() => {
			const note = document.querySelector('.cm-scroller');
			const circuit = document.querySelector('.cm-content .logic-circuit[data-circuit-id="first-circuit"]');
			return { scrollTop:note.scrollTop, pageTop:document.scrollingElement.scrollTop,
				circuitTop:circuit?.getBoundingClientRect().top ?? null,
				circuitFocused:circuit === document.activeElement,
				caret:window.cmCircuitTest.selectionRange(), save:window.cmCircuitTest.transactions().at(-1),
				position:window.cmCircuitTest.snapshot('first-circuit').circuit.nodes[0].position };
		});
		assert.deepEqual(caretSaveAfter.position, { x:120, y:160 }, 'the native-like save persists the completed horizontal gesture');
		assert.equal(await page.evaluate(() => window.cmCircuitTest.text()), caretSaveText.replace('"x": 64', '"x": 120'),
			'saving the completed gesture changes only its node position and preserves surrounding Markdown bytes');
		assert.equal(caretSaveAfter.save.origin, 'logic-circuit', 'saving retains its editor transaction origin');
		assert.equal(caretSaveAfter.save.scrollIntoView, false, 'circuit-data saves do not request Markdown cursor scrolling');
		assert.match(caretSaveMoved.active, /^logic-circuit(?: |$)/, 'dragging keeps focus on the stationary circuit container');
		assert.equal(caretSaveAfter.circuitFocused, true, 'saving preserves focus on the circuit container');
		assert.equal(caretSaveMoved.scrollTop, caretSaveBefore.scrollTop, 'horizontal dragging leaves the note viewport unchanged');
		assert.equal(caretSaveAfter.scrollTop, caretSaveBefore.scrollTop, 'saving a circuit must not scroll an offscreen retained Markdown caret into view');
		assert.equal(caretSaveAfter.pageTop, caretSaveBefore.pageTop, 'the native-like save keeps the outer page in place');
		assert.equal(caretSaveAfter.circuitTop, caretSaveBefore.circuitTop, 'the native-like save keeps the circuit visible at its original screen position');
		assert.deepEqual(caretSaveAfter.caret, caretBefore, 'circuit saving preserves the Markdown selection');
	}
	// Structural actions deliberately place a Markdown caret and still use
	// Obsidian's normal scroll request so editing can continue beside a block.
	await first().click({ button:'right', position:{ x:400, y:30 } });
	await page.getByRole('menuitem', { name:'Insert line after', exact:true }).click();
	await page.waitForFunction(() => document.activeElement?.classList.contains('cm-content'));
	const structuralSave = await page.evaluate(() => window.cmCircuitTest.transactions().at(-1));
	assert.equal(structuralSave.origin, 'logic-circuit');
	assert.equal(structuralSave.scrollIntoView, true, 'intentional block actions retain Obsidian cursor scrolling');
	console.log('Passed: custom/native fallback saves preserve an offscreen caret and viewport; intentional block actions retain cursor scrolling.');
	await prepare(false);
	const before = await measure();
	const node = await gate().boundingBox();
	await page.mouse.move(node.x + 24, node.y + 12);
	await page.mouse.down();
	await frames();
	const down = await measure();
	await page.mouse.move(node.x + 24, node.y - 44, { steps:8 });
	await frames();
	const moved = await measure();
	await page.mouse.up();
	await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
	await frames();
	const after = await measure();
	assert.match(down.active, /^logic-circuit(?: |$)/, 'pointer dragging keeps keyboard focus on the stationary circuit block');
	assert.equal(down.scrollTop, before.scrollTop, 'pressing a partly visible gate must not scroll its note into view');
	assert.equal(moved.scrollTop, before.scrollTop, 'dragging a gate must keep the note scroll position stable');
	assert.equal(after.scrollTop, before.scrollTop, 'releasing and saving the node must keep the note scroll position stable');
	for (const result of [down, moved, after]) {
		assert.equal(result.pageTop, before.pageTop, 'the node gesture leaves the outer page position unchanged');
		assert.equal(result.circuitTop, before.circuitTop, 'the upper circuit boundary stays in place while the lower boundary moves');
	}
	assert.equal(moved.nodeY, before.nodeY, 'pointer movements update the preview without saving each movement');
	assert.equal(after.nodeY, before.nodeY - 56, 'the completed real node gesture saves its snapped position');
	assert.ok(moved.canvasHeight < before.canvasHeight, 'the lower boundary follows an upward node movement immediately');
	await prepare(true);
	await scroller().evaluate(element => { element.scrollTop = element.scrollHeight; });
	await frames();
	const bottomBefore = await measure();
	const bottomNode = await gate().boundingBox();
	await page.mouse.move(bottomNode.x + 24, bottomNode.y + 32);
	await page.mouse.down();
	await page.mouse.move(bottomNode.x + 24, bottomNode.y + 152, { steps:12 });
	await frames();
	const bottomMoved = await measure();
	await page.mouse.up();
	await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
	await frames();
	const bottomAfter = await measure();
	assert.equal(bottomMoved.scrollTop, bottomBefore.scrollTop, 'growing a circuit at the end of the note must not drag the note viewport');
	assert.equal(bottomAfter.scrollTop, bottomBefore.scrollTop, 'saving end-of-note growth must not scroll the note');
	assert.equal(bottomAfter.nodeY, bottomBefore.nodeY + 120);
	assert.equal(bottomMoved.circuitTop, bottomBefore.circuitTop, 'growing the end-of-note circuit keeps its upper boundary fixed');
	await prepare(true);
	await scroller().evaluate(element => { element.scrollTop = element.scrollHeight; });
	await frames();
	const shrinkBefore = await measure();
	const shrinkNode = await gate().boundingBox();
	await page.mouse.move(shrinkNode.x + 24, shrinkNode.y + 32);
	await page.mouse.down();
	await page.mouse.move(shrinkNode.x + 24, shrinkNode.y - 72, { steps:1 });
	await frames();
	const shrinkMoved = await measure();
	await page.mouse.up();
	await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
	await frames();
	const shrinkAfter = await measure();
	const assertLegalClamp = (start, result, reason) => {
		const target = Math.min(start.scrollTop, result.scrollHeight - result.clientHeight);
		assert.ok(Math.abs(result.scrollTop - target) <= 1, `${reason}: expected ${target}, got ${result.scrollTop}`);
	};
	assertLegalClamp(shrinkBefore, shrinkMoved, 'a one-step bottom shrink clamps the viewport only once');
	assertLegalClamp(shrinkBefore, shrinkAfter, 'saving the bottom shrink retains the legal offset');
	assert.equal(shrinkAfter.nodeY, shrinkBefore.nodeY - 104);
	await prepare(true);
	await scroller().evaluate(element => { element.scrollTop = element.scrollHeight; });
	await frames();
	const gradualBefore = await measure();
	const gradualGate = await gate().boundingBox();
	await page.mouse.move(gradualGate.x + 24, gradualGate.y + 32);
	await page.mouse.down();
	await page.mouse.move(gradualGate.x + 24, gradualGate.y - 72, { steps:12 });
	await frames();
	const gradualMoved = await measure();
	await page.mouse.up();
	await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
	await frames();
	const gradualAfter = await measure();
	assertLegalClamp(gradualBefore, gradualMoved, 'a gradual bottom shrink clamps the viewport only once');
	assertLegalClamp(gradualBefore, gradualAfter, 'saving a gradual shrink retains the legal offset');
	assert.equal(gradualAfter.nodeY, gradualBefore.nodeY - 104);
	await prepare(true);
	await scroller().evaluate(element => { element.scrollTop = element.scrollHeight; });
	await frames();
	const reversalBefore = await measure();
	const reversalText = await page.evaluate(() => window.cmCircuitTest.text());
	const reversalGate = await gate().boundingBox();
	await page.mouse.move(reversalGate.x + 24, reversalGate.y + 32);
	await page.mouse.down();
	// Two rapid native moves precede the next measurement check. Returning to
	// the original point must discard the preview and retain the note bytes.
	await page.mouse.move(reversalGate.x + 24, reversalGate.y - 72);
	await page.mouse.move(reversalGate.x + 24, reversalGate.y + 32);
	await frames();
	const reversalMoved = await measure();
	await page.mouse.up();
	await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
	await frames();
	const reversalAfter = await measure();
	assert.equal(reversalMoved.canvasHeight, reversalBefore.canvasHeight);
	assert.equal(reversalAfter.nodeY, reversalBefore.nodeY);
	assert.equal(await page.evaluate(() => window.cmCircuitTest.text()), reversalText, 'a gesture returned to its original position creates no note rewrite');
	assert.ok(reversalAfter.scrollTop <= reversalBefore.scrollTop, 'a rapid reversal never scrolls below the original viewport');
	assert.ok(reversalAfter.scrollTop >= reversalBefore.scrollTop - 104 - 1, 'a rapid reversal adds no extra scroll beyond the temporary legal clamp');
	await prepare(true);
	await scroller().evaluate(element => { element.scrollTop = element.scrollHeight; });
	await frames();
	const returnBefore = await measure();
	const returnText = await page.evaluate(() => window.cmCircuitTest.text());
	const returnGate = await gate().boundingBox();
	await page.mouse.move(returnGate.x + 24, returnGate.y + 32);
	await page.mouse.down();
	await page.mouse.move(returnGate.x + 24, returnGate.y + 152);
	await frames();
	const expanded = await measure();
	assert.ok(expanded.canvasHeight > returnBefore.canvasHeight, 'the intermediate growth is committed to the real DOM before returning');
	assert.equal(expanded.scrollTop, returnBefore.scrollTop, 'intermediate growth retains the end-note viewport');
	await page.mouse.move(returnGate.x + 24, returnGate.y + 32);
	await frames();
	const returned = await measure();
	await page.mouse.up();
	await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
	await frames();
	const returnSaved = await measure();
	assert.equal(returned.canvasHeight, returnBefore.canvasHeight, 'returning to the original point restores the original canvas height');
	assert.equal(returned.scrollTop, returnBefore.scrollTop, 'growth followed by return never requires a scroll clamp');
	assert.equal(returnSaved.scrollTop, returnBefore.scrollTop, 'release and completion after a return do not shift the viewport');
	assert.equal(returnSaved.pageTop, returnBefore.pageTop);
	assert.equal(returnSaved.nodeY, returnBefore.nodeY);
	assert.equal(await page.evaluate(() => window.cmCircuitTest.text()), returnText, 'growth followed by return creates no note rewrite');
	console.log('Passed: clipped node focus, live bounds, exact drag saves, end-of-note growth, single/gradual shrink, rapid reversal, and growth followed by return.');

	await prepare(false);
	const wheelBefore = await measure();
	const wheelCanvas = await first().locator('.logic-canvas').boundingBox();
	await page.mouse.move(wheelCanvas.x + 320, wheelCanvas.y + 45);
	await page.mouse.wheel(0, 80);
	await page.waitForFunction(before => document.querySelector('.cm-scroller').scrollTop > before, wheelBefore.scrollTop);
	const wheelAfter = await measure();
	assert.equal(wheelAfter.nodeY, wheelBefore.nodeY, 'ordinary wheel scrolling never moves a circuit node');
	assert.equal(await page.evaluate(() => window.cmCircuitTest.snapshot('first-circuit').editing), true, 'ordinary note scrolling leaves circuit editing active');
	console.log('Passed: wheel events over the diagram still scroll the note normally.');
	await prepare(false);
	const dragWheelStart = await measure();
	const dragWheelGate = await gate().boundingBox();
	await page.mouse.move(dragWheelGate.x + 24, dragWheelGate.y + 12);
	await page.mouse.down();
	await page.mouse.wheel(0, 80);
	await page.waitForFunction(before => document.querySelector('.cm-scroller').scrollTop > before, dragWheelStart.scrollTop);
	await frames();
	const intentionalWheel = await measure();
	await page.mouse.move(dragWheelGate.x + 24, dragWheelGate.y - 20, { steps:4 });
	await frames();
	const afterWheelDrag = await measure();
	await page.mouse.up();
	await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
	await frames();
	const afterWheelSave = await measure();
	assert.equal(afterWheelDrag.scrollTop, intentionalWheel.scrollTop, 'continuing a drag respects deliberate wheel scrolling');
	assert.equal(afterWheelSave.scrollTop, intentionalWheel.scrollTop, 'saving a drag respects deliberate wheel scrolling');
	assert.notEqual(afterWheelSave.nodeY, dragWheelStart.nodeY, 'the node remains draggable after a deliberate wheel scroll');
	assert.equal(await page.evaluate(() => window.cmCircuitTest.snapshot('first-circuit').editing), true);
	console.log('Passed: intentional wheel scrolling during a node drag remains available.');
	await prepare(false);
	await page.addStyleTag({ content:'.cm-scroller { height:auto !important; overflow:visible !important; }' });
	await frames();
	await page.evaluate(() => window.cmCircuitTest.scrollCircuitIntoView());
	await frames();
	const outerNode = await gate().boundingBox();
	await page.evaluate(top => window.scrollBy(0, top), outerNode.y - 300);
	await frames();
	const outerBefore = await measure();
	const outerGate = await gate().boundingBox();
	await page.mouse.move(outerGate.x + 24, outerGate.y + 32);
	await page.mouse.down();
	await frames();
	const outerDown = await measure();
	await page.mouse.move(outerGate.x + 24, outerGate.y + 136, { steps:10 });
	await frames();
	const outerMoved = await measure();
	await page.mouse.up();
	await page.evaluate(() => window.cmCircuitTest.flush('first-circuit'));
	await frames();
	const outerAfter = await measure();
	assert.equal(outerDown.pageTop, outerBefore.pageTop, 'pressing a node does not jump an outer scrollable page');
	assert.equal(outerMoved.pageTop, outerBefore.pageTop, 'dragging and resizing a circuit does not jump an outer page');
	assert.equal(outerAfter.pageTop, outerBefore.pageTop, 'saving the dragged node does not jump an outer page');
	assert.equal(outerAfter.nodeY, outerBefore.nodeY + 104, 'the real drag saves its expected snapped position');
	console.log('Passed: outer-page dragging preserves the viewport and saves the expected node position.');
	const demo = await readFile('tests/fixtures/adding-two-bits.md', 'utf8');
	const circuits = [...demo.matchAll(/```logic-circuit\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
	for (const { index, nodeId, dx, dy, precedingDelta = 0 } of [
		{ index:0, nodeId:'carry', dx:0, dy:64 },
		{ index:0, nodeId:'sum', dx:64, dy:0 },
		{ index:1, nodeId:'carry', dx:0, dy:64 },
		{ index:1, nodeId:'carry', dx:64, dy:0 },
		{ index:1, nodeId:'carry', dx:0, dy:64, precedingDelta:26 },
		{ index:1, nodeId:'n3', dx:0, dy:-48 },
	]) {
		const id = circuits[index].circuitId;
		await page.goto(`http://127.0.0.1:${address.port}/`);
		await page.waitForFunction(() => Boolean(window.cmCircuitTest));
		await page.addStyleTag({ content:'.cm-scroller { height:360px !important; overflow:auto !important; } #editor { max-width:700px !important; }' });
		await page.evaluate(({ demo, id }) => window.cmCircuitTest.prepareNoteScrollScenario(demo, id), { demo, id });
		const diagram = page.locator(`.cm-content .logic-circuit[data-circuit-id="${id}"]`);
		await diagram.getByRole('button', { name:'Done', exact:true }).waitFor();
		await frames();
		const object = diagram.locator(`.react-flow__node[data-id="${nodeId}"] .logic-object`);
		const objectBox = await object.boundingBox();
		const noteBox = await scroller().boundingBox();
		await scroller().evaluate((element, delta) => { element.scrollTop += delta; }, objectBox.y - (noteBox.y + 160));
		await frames();
		const capture = () => page.evaluate(({ id, nodeId }) => {
			const note = document.querySelector('.cm-scroller');
			const diagram = document.querySelector(`.cm-content .logic-circuit[data-circuit-id="${id}"]`);
			return { scrollTop:note.scrollTop, circuitTop:diagram.getBoundingClientRect().top,
				pageTop:document.scrollingElement.scrollTop,
				position:window.cmCircuitTest.snapshot(id).circuit.nodes.find(node => node.id === nodeId).position };
		}, { id, nodeId });
		const baseline = await capture();
		const box = await object.boundingBox();
		const displayScale = box.width / 80;
		const x = box.x + box.width * .3;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await frames();
		const pressed = await capture();
		if (precedingDelta) {
			// A neighboring Markdown widget can finish laying out during a
			// gesture. Change its real footprint, without directly scrolling.
			await page.evaluate(({ id, delta }) => {
				const earlier = document.querySelector(`.logic-circuit[data-circuit-id="${id}"]`).closest('.logic-circuit-widget');
				earlier.style.paddingBottom = `${delta}px`;
			}, { id:circuits[0].circuitId, delta:precedingDelta });
		}
		await page.mouse.move(x + dx * displayScale, y + dy * displayScale, { steps:12 });
		await frames();
		const preview = await capture();
		await page.mouse.up();
		await page.evaluate(id => window.cmCircuitTest.flush(id), id);
		await frames();
		const saved = await capture();
		for (const state of [pressed, preview, saved]) {
			assert.equal(state.scrollTop, baseline.scrollTop + (state === pressed ? 0 : precedingDelta), `${nodeId} in demo circuit ${index + 1}: scrolling preserves the circuit's visual position`);
			assert.equal(state.pageTop, baseline.pageTop, `${nodeId} in demo circuit ${index + 1}: outer page stays fixed`);
			assert.equal(state.circuitTop, baseline.circuitTop, `${nodeId} in demo circuit ${index + 1}: the visible upper circuit boundary stays fixed`);
		}
		assert.deepEqual(preview.position, baseline.position, 'demo pointer movements do not save intermediate positions');
		assert.deepEqual(saved.position, { x:baseline.position.x + dx, y:baseline.position.y + dy }, 'a real drag in the dense, scaled demo saves the exact snapped position');
		assert.equal(await page.evaluate(id => window.cmCircuitTest.snapshot(id).editing, id), true);
	}
	console.log('Passed: both actual demo circuits retain their visible position during vertical/horizontal drags, neighboring widget reflow, and completed saves.');
	assert.deepEqual(errors, []);
	console.log(`Drag-scroll artifacts: ${directory}`);
} catch (error) {
	if (page) await page.screenshot({ path:join(directory, 'failure.png'), fullPage:true });
	console.error(`Failure artifacts: ${directory}`);
	throw error;
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}
