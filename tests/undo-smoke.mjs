import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'logic-circuit-undo-'));
await build({ entryPoints: ['tests/cm-harness.tsx'], bundle: true, platform: 'browser', outfile: join(directory, 'app.js'),
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
	browser = await chromium.launch({ executablePath, headless: true });
	page = await browser.newPage({ viewport: { width:1100, height:1100 } });
	page.setDefaultTimeout(10000);
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	const open = async (nativeReplacement = false) => {
		await page.goto('http://127.0.0.1:' + address.port + '/');
		if (nativeReplacement) {
			await page.waitForFunction(() => Boolean(window.cmCircuitTest));
			await page.evaluate(() => window.cmCircuitTest.forceNativeReplacements());
			await page.evaluate(() => window.cmCircuitTest.prepareNoteScrollScenario(window.cmCircuitTest.initial(), 'first-circuit', true));
		}
		await page.waitForFunction(() => document.querySelectorAll('.cm-content .logic-circuit').length === 2);
	};
	const circuit = id => page.locator('.cm-content .logic-circuit[data-circuit-id="' + id + '"]');
	const first = () => circuit('first-circuit');
	const second = () => circuit('second-circuit');
	const text = () => page.evaluate(() => window.cmCircuitTest.text());
	const snapshot = id => page.evaluate(id => window.cmCircuitTest.snapshot(id), id);
	const flush = id => page.evaluate(id => window.cmCircuitTest.flush(id), id);
	const start = async locator => {
		await locator.locator('.logic-canvas').dblclick({ position:{ x:350, y:70 } });
		await locator.getByRole('button', { name:'Done', exact:true }).waitFor();
		await locator.hover();
	};
	const assertCircuitFocus = async locator => assert.equal(await locator.evaluate(element => document.activeElement === element), true,
		'completing a circuit input returns keyboard focus to the persistent circuit container');

	await open();
	const beforeScale = await text();
	await start(first());
	const scale = first().getByRole('textbox', { name:'Circuit scale percentage', exact:true });
	await scale.focus();
	await scale.press('Meta+a');
	await page.keyboard.type('95');
	await scale.press('Meta+z');
	assert.equal(await scale.inputValue(), '100', 'Cmd+Z while typing remains native percentage-field undo');
	assert.equal(await text(), beforeScale, 'text-field undo does not commit or undo a circuit action');
	await scale.fill('80');
	await scale.press('Enter');
	await flush('first-circuit');
	assert.equal((await snapshot('first-circuit')).circuit.view.preferredScale, .8);
	const savedScale = await text();
	await assertCircuitFocus(first());
	await page.keyboard.press('Meta+z');
	await flush('first-circuit');
	assert.equal(await text(), beforeScale, 'Cmd+Z immediately after confirming a percentage restores the exact circuit Markdown');
	await page.keyboard.press('Meta+Shift+z');
	await flush('first-circuit');
	assert.equal(await text(), savedScale, 'Shift+Cmd+Z immediately restores the completed percentage edit');

	await scale.fill('70');
	await scale.press('Escape');
	await assertCircuitFocus(first());
	assert.equal(await text(), savedScale, 'Escape cancels percentage text without committing an edit');
	await page.keyboard.press('Meta+z');
	await flush('first-circuit');
	assert.equal(await text(), beforeScale, 'Cmd+Z after cancelling percentage text still undoes the previous completed circuit edit');
	await scale.fill('70');
	const outside = page.getByRole('textbox', { name:'Outside circuit field', exact:true });
	await outside.focus();
	await flush('first-circuit');
	assert.equal((await snapshot('first-circuit')).circuit.view.preferredScale, .7, 'ordinary percentage blur still commits');
	assert.equal(await outside.evaluate(element => document.activeElement === element), true, 'ordinary percentage blur preserves the outside target focus');
	console.log('Passed: percentage Enter/Escape preserve keyboard routing and exact circuit undo/redo.');

	await open();
	const beforeLabel = await text();
	await start(second());
	await second().locator('.logic-terminal-label').dblclick();
	const label = second().getByRole('textbox', { name:'Edit output label', exact:true });
	await label.press('Meta+a');
	await page.keyboard.type('Typed draft');
	await label.press('Meta+z');
	assert.notEqual(await label.inputValue(), 'Typed draft', 'Cmd+Z while typing remains native terminal-field undo');
	assert.equal(await label.evaluate(element => document.activeElement === element), true, 'typing undo retains terminal-field focus');
	assert.equal(await text(), beforeLabel, 'terminal text-field undo leaves circuit Markdown untouched');
	await label.fill('Changed label');
	await label.press('Enter');
	await flush('second-circuit');
	assert.equal((await snapshot('second-circuit')).circuit.nodes[0].label, 'Changed label');
	const savedLabel = await text();
	await assertCircuitFocus(second());
	await page.keyboard.press('Meta+z');
	await flush('second-circuit');
	assert.equal(await text(), beforeLabel, 'Cmd+Z immediately after confirming a terminal label restores the exact circuit Markdown');
	await page.keyboard.press('Meta+Shift+z');
	await flush('second-circuit');
	assert.equal(await text(), savedLabel, 'Shift+Cmd+Z immediately restores the completed terminal label edit');

	await second().locator('.logic-terminal-label').dblclick();
	await label.fill('Cancelled label');
	await label.press('Escape');
	await assertCircuitFocus(second());
	assert.equal(await text(), savedLabel, 'Escape cancels terminal text without committing an edit');
	await page.keyboard.press('Meta+z');
	await flush('second-circuit');
	assert.equal(await text(), beforeLabel, 'Cmd+Z after cancelling terminal text still undoes the previous completed circuit edit');
	await page.keyboard.press('Meta+Shift+z');
	await flush('second-circuit');
	await second().getByRole('button', { name:'Done', exact:true }).click();
	await assertCircuitFocus(second());
	assert.equal((await snapshot('second-circuit')).editing, false);
	await page.keyboard.press('Meta+z');
	await flush('second-circuit');
	assert.equal(await text(), beforeLabel, 'Cmd+Z immediately after mouse Done restores the completed circuit edit');
	await page.keyboard.press('Meta+Shift+z');
	await flush('second-circuit');
	assert.equal(await text(), savedLabel, 'redo immediately after Done preserves the completed circuit edit');
	assert.equal((await snapshot('second-circuit')).editing, false, 'finished-circuit history shortcuts do not reopen editing');
	await second().hover();
	await second().getByRole('button', { name:'Decrease circuit scale', exact:true }).click();
	await flush('second-circuit');
	assert.equal((await snapshot('second-circuit')).circuit.view.preferredScale, .9);
	await page.keyboard.press('Meta+z');
	await flush('second-circuit');
	assert.equal(await text(), savedLabel, 'Cmd+Z on a finished circuit undoes its display scale edit');
	await start(second());
	await second().locator('.logic-terminal-label').dblclick();
	await label.fill('Outside blur label');
	await outside.focus();
	await flush('second-circuit');
	assert.equal((await snapshot('second-circuit')).circuit.nodes[0].label, 'Outside blur label', 'ordinary terminal blur still commits');
	assert.equal(await outside.evaluate(element => document.activeElement === element), true, 'ordinary terminal blur preserves the outside target focus');
	console.log('Passed: terminal-label Enter/Escape preserve keyboard routing and exact circuit undo/redo.');

	await open();
	const beforeKeyboardDone = await text();
	await start(first());
	await first().getByRole('button', { name:'Decrease circuit scale', exact:true }).click();
	await flush('first-circuit');
	const keyboardDone = first().getByRole('button', { name:'Done', exact:true });
	await keyboardDone.focus();
	await keyboardDone.press('Enter');
	await assertCircuitFocus(first());
	assert.equal((await snapshot('first-circuit')).editing, false);
	await page.keyboard.press('Meta+z');
	await flush('first-circuit');
	assert.equal(await text(), beforeKeyboardDone, 'Cmd+Z immediately after keyboard Done restores the completed circuit edit');
	console.log('Passed: mouse/keyboard Done and finished-circuit scale edits retain immediate keyboard undo/redo.');

	await open(true);
	const beforeNativeScale = await text();
	await start(first());
	const replacedScaleRoot = await first().elementHandle();
	await scale.fill('80');
	await scale.press('Enter');
	await flush('first-circuit');
	await first().getByRole('button', { name:'Done', exact:true }).waitFor();
	assert.equal(await replacedScaleRoot.evaluate(element => element.isConnected), false, 'the native fixture really removes the previously focused circuit DOM');
	assert.equal(await page.evaluate(() => window.cmCircuitTest.nativeReplacementGaps().at(-1).rendered), 0, 'successor circuit roots mount asynchronously after the empty native-renderer gap');
	await assertCircuitFocus(first());
	const savedNativeScale = await text();
	await page.keyboard.press('Meta+z');
	await flush('first-circuit');
	await first().getByRole('button', { name:'Done', exact:true }).waitFor();
	assert.equal(await text(), beforeNativeScale, 'Cmd+Z after percentage completion survives native circuit DOM replacement');
	await assertCircuitFocus(first());
	await page.keyboard.press('Meta+Shift+z');
	await flush('first-circuit');
	await first().getByRole('button', { name:'Done', exact:true }).waitFor();
	assert.equal(await text(), savedNativeScale, 'redo also survives native circuit DOM replacement');
	await assertCircuitFocus(first());

	await start(second());
	const beforeNativeLabel = await text();
	await second().locator('.logic-terminal-label').dblclick();
	await label.fill('Native replacement label');
	await label.press('Enter');
	await flush('second-circuit');
	await second().getByRole('button', { name:'Done', exact:true }).waitFor();
	await assertCircuitFocus(second());
	await page.keyboard.press('Meta+z');
	await flush('second-circuit');
	await second().getByRole('button', { name:'Done', exact:true }).waitFor();
	assert.equal(await text(), beforeNativeLabel, 'Cmd+Z after terminal completion survives native circuit DOM replacement');
	await assertCircuitFocus(second());
	console.log('Passed: completed percentage/label shortcuts retain circuit focus through real native-style DOM replacement.');
	await page.keyboard.press('Meta+Shift+z');
	await flush('second-circuit');
	await second().getByRole('button', { name:'Done', exact:true }).waitFor();
	const beforeNativeDone = await text();
	await second().getByRole('button', { name:'Done', exact:true }).click();
	await assertCircuitFocus(second());
	const doneRoot = await second().elementHandle();
	await page.evaluate(() => window.cmCircuitTest.redrawNativeWidgets());
	await second().waitFor();
	assert.equal(await doneRoot.evaluate(element => element.isConnected), false, 'the non-document native refresh really removes the finished circuit DOM');
	const earlyRemoval = await page.evaluate(() => window.cmCircuitTest.nativeEarlyRemovals().at(-1));
	assert.ok(earlyRemoval.renderedBefore > 0 && earlyRemoval.focusedBefore && !earlyRemoval.focusedAfter,
		'the native render child unloads its focused circuit while resolving state, before editor plugin updates');
	assert.equal(await text(), beforeNativeDone, 'a native refresh leaves circuit Markdown unchanged');
	await assertCircuitFocus(second());
	await page.keyboard.press('Meta+z');
	await flush('second-circuit');
	await second().waitFor();
	assert.equal(await text(), beforeNativeLabel, 'Cmd+Z after Done survives a later non-document native refresh');
	assert.equal((await snapshot('second-circuit')).editing, false);
	await assertCircuitFocus(second());
	console.log('Passed: Done retains keyboard undo through a later native refresh without note edits.');

	await open(true);
	const beforeGap = await text();
	await page.evaluate(() => window.cmCircuitTest.holdNativeRendering());
	await scale.fill('80');
	await scale.press('Enter');
	await flush('first-circuit');
	assert.equal(await page.locator('.cm-content .logic-circuit').count(), 0, 'the renderer gate holds an actual empty successor DOM interval');
	assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
	const gapSaved = await text();
	await page.keyboard.press('Meta+z');
	await flush('first-circuit');
	assert.equal(await text(), beforeGap, 'Cmd+Z during the empty renderer interval undoes the owning circuit action');
	await page.keyboard.press('Meta+Shift+z');
	await flush('first-circuit');
	assert.equal(await text(), gapSaved, 'redo during the empty renderer interval restores the owning circuit action');
	await page.keyboard.press('Meta+z');
	await flush('first-circuit');
	assert.equal(await text(), beforeGap, 'the replacement handoff remains owned across consecutive undo and redo writes');
	await page.evaluate(() => window.cmCircuitTest.releaseNativeRendering());
	await first().getByRole('button', { name:'Done', exact:true }).waitFor();
	await assertCircuitFocus(first());
	assert.equal((await snapshot('first-circuit')).conflict, false);
	console.log('Passed: Cmd+Z and redo in a held empty renderer interval save exact circuit Markdown and return successor focus.');

	await open();
	await page.evaluate(() => window.cmCircuitTest.forceNativeReplacements());
	await page.addStyleTag({ content:'.cm-scroller {height:360px!important;overflow:auto!important;}' });
	await page.evaluate(() => window.cmCircuitTest.prepareScrollScenario(false, true));
	await first().getByRole('button', { name:'Done', exact:true }).waitFor();
	await first().evaluate(element => {
		const scroller = document.querySelector('.cm-scroller');
		scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20;
	});
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const gapViewport = () => first().evaluate(element => ({ top:document.querySelector('.cm-scroller').scrollTop, y:element.getBoundingClientRect().top }));
	const beforeGapViewport = await gapViewport();
	const beforeViewportUndo = await text();
	await page.evaluate(() => window.cmCircuitTest.holdNativeRendering());
	await scale.fill('80');
	await scale.press('Enter');
	await flush('first-circuit');
	assert.equal(await page.locator('.cm-content .logic-circuit').count(), 0);
	await page.keyboard.press('Meta+z');
	await flush('first-circuit');
	assert.equal(await text(), beforeViewportUndo);
	await page.evaluate(() => window.cmCircuitTest.releaseNativeRendering());
	await first().getByRole('button', { name:'Done', exact:true }).waitFor();
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const afterGapViewport = await gapViewport();
	assert.ok(Math.abs(afterGapViewport.top - beforeGapViewport.top) <= 1, 'modifier keydown before held-gap Cmd+Z preserves the pending viewport handoff');
	assert.ok(Math.abs(afterGapViewport.y - beforeGapViewport.y) <= 1, 'the resumed circuit keeps its screen position after held-gap undo');
	await assertCircuitFocus(first());
	console.log('Passed: held-gap shortcut modifier keys preserve the circuit viewport as well as focus.');

	await open(true);
	await page.evaluate(() => window.cmCircuitTest.holdNativeRendering());
	await scale.fill('80');
	await scale.press('Enter');
	await flush('first-circuit');
	const beforeEarlyReading = await text();
	await page.evaluate(() => window.cmCircuitTest.prepareReadingScrollScenario(true));
	await page.locator('.markdown-preview-view .logic-circuit.is-read-only').waitFor();
	assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
	await page.keyboard.press('Meta+z');
	assert.equal(await text(), beforeEarlyReading, 'explicit Reading output cancels gap undo ownership before a mode notification');
	assert.equal(await page.evaluate(() => window.cmCircuitTest.readingText()), beforeEarlyReading, 'early Reading undo leaves its rendered circuit source unchanged');
	await page.evaluate(() => window.cmCircuitTest.releaseNativeRendering());
	console.log('Passed: explicit Reading output cancels the previous editable renderer-gap shortcut ownership.');

	for (const input of ['pointer', 'key', 'wheel', 'outside focus', 'window blur', 'editor replacement']) {
		await open(true);
		await page.evaluate(() => window.cmCircuitTest.holdNativeRendering());
		await scale.fill('80');
		await scale.press('Enter');
		await flush('first-circuit');
		assert.equal(await page.locator('.cm-content .logic-circuit').count(), 0);
		if (input === 'pointer') await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true })));
		if (input === 'key') await page.keyboard.press('ArrowRight');
		if (input === 'wheel') await page.evaluate(() => document.body.dispatchEvent(new WheelEvent('wheel', { bubbles:true, deltaY:24 })));
		if (input === 'outside focus') await outside.focus();
		if (input === 'window blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		if (input === 'editor replacement') await page.evaluate(() => window.cmCircuitTest.rebuild());
		await page.evaluate(() => window.cmCircuitTest.releaseNativeRendering());
		await first().waitFor();
		assert.equal(await first().evaluate(element => document.activeElement === element), false,
			input + ' invalidates the obsolete circuit focus handoff');
		if (input === 'outside focus') assert.equal(await outside.evaluate(element => document.activeElement === element), true,
			'the successor renderer preserves the deliberately focused outside input');
	}
	console.log('Passed: unrelated input, outside focus, window blur, and editor replacement cancel pending focus ownership.');

	assert.deepEqual(errors, []);
	await page.screenshot({ path:join(directory, 'undo-focus.png'), fullPage:true });
	console.log('Undo artifacts: ' + directory);
} catch (error) {
	if (page) {
		await page.screenshot({ path:join(directory, 'failure.png'), fullPage:true });
		console.error(await page.evaluate(() => ({ focus:document.activeElement?.outerHTML.slice(0,300),
			first:window.cmCircuitTest?.blocks().some(block => block.id === 'first-circuit') ? window.cmCircuitTest.snapshot('first-circuit') : undefined,
			second:window.cmCircuitTest?.blocks().some(block => block.id === 'second-circuit') ? window.cmCircuitTest.snapshot('second-circuit') : undefined })));
	}
	console.error('Failure artifacts: ' + directory);
	throw error;
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}
