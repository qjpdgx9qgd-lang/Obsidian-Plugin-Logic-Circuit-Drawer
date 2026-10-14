import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'logic-circuit-cm-'));
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

	await page.goto(`http://127.0.0.1:${address.port}/`);
	await page.waitForFunction(() => Boolean(window.cmCircuitTest?.resetNote));
	const initialBlocks = await page.evaluate(() => window.cmCircuitTest.blocks());
	const fence = initialBlocks[0].raw;
	const secondFence = initialBlocks[1].raw;
	const text = () => page.evaluate(() => window.cmCircuitTest.text());
	const blocks = () => page.evaluate(() => window.cmCircuitTest.blocks());
	const cursor = () => page.evaluate(() => window.cmCircuitTest.cursor());
	const setCursor = (anchor, head = anchor) => page.evaluate(({ anchor, head }) => window.cmCircuitTest.setCursor(anchor, head), { anchor, head });
	const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const reset = async doc => {
		await page.evaluate(doc => window.cmCircuitTest.resetNote(doc), doc);
		await frames();
	};
	const original = `Before.\n\n${fence}\n\nAfter.`;
	await reset(original);
	const firstBlock = (await blocks())[0];
	const circuitBox = await page.locator('.logic-circuit').boundingBox();
	const emptyLines = page.locator('.cm-line').filter({ hasText:/^$/ });
	let clicked = false;
	for (let index = 0; index < await emptyLines.count(); index++) {
		const box = await emptyLines.nth(index).boundingBox();
		if (box.y <= circuitBox.y + circuitBox.height) continue;
		await emptyLines.nth(index).click({ position:{ x:15, y:8 } });
		clicked = true;
		break;
	}
	assert.equal(clicked, true, 'click the actual rendered empty Markdown line after the circuit');
	assert.equal((await cursor()).offset, firstBlock.from + firstBlock.raw.length + 1);
	await page.keyboard.press('Backspace');
	const withoutBlankLine = `Before.\n\n${fence}\nAfter.`;
	assert.equal(await text(), withoutBlankLine, 'Backspace removes only the adjacent blank line');
	assert.equal((await cursor()).lineText, 'After.', 'the caret moves to an editable Markdown line, not the hidden closing fence');
	await page.keyboard.press('Backspace');
	assert.equal(await text(), withoutBlankLine, 'a second Backspace cannot delete the circuit or join text to its closing fence');
	assert.equal((await blocks())[0].raw, fence);
	assert.equal(await page.evaluate(() => window.cmCircuitTest.undo()), true);
	assert.equal(await text(), original, 'ordinary note undo restores the removed blank line in one step');
	console.log('Passed: clicking and deleting a trailing blank line preserves the fence, repeated Backspace is safe, and note undo is exact.');

	await reset(`Before.\n\n${fence}\n\n\n`);
	await setCursor((await text()).length);
	for (const remaining of ['\n\n', '\n', '']) {
		await page.keyboard.press('Backspace');
		assert.equal(await text(), `Before.\n\n${fence}${remaining}`, 'trailing empty lines can be removed without forcing a new line into the document');
	}
	await page.keyboard.press('Backspace');
	assert.equal(await text(), `Before.\n\n${fence}`, 'Backspace beside an end-of-note circuit requires explicit selection to delete it');
	assert.equal((await blocks())[0].raw, fence);

	await reset(`Before.\n\n${fence}\nAfter.`);
	let block = (await blocks())[0];
	await setCursor(block.from + block.raw.length + 1);
	await page.keyboard.press('Backspace');
	assert.equal(await text(), `Before.\n\n${fence}\nAfter.`, 'the separator before a nonempty following paragraph is retained');
	await setCursor((await text()).length);
	await page.keyboard.press('Backspace');
	assert.equal(await text(), `Before.\n\n${fence}\nAfter`, 'ordinary text character deletion still works');
	await setCursor(block.from + block.raw.length);
	await page.keyboard.press('Delete');
	assert.equal(await text(), `Before.\n\n${fence}\nAfter`, 'forward deletion cannot join a paragraph into a closing fence');

	await reset(`Before.\n\n${fence}\n\nAfter.`);
	block = (await blocks())[0];
	await setCursor(block.from - 1);
	await page.keyboard.press('Delete');
	assert.equal(await text(), `Before.\n${fence}\n\nAfter.`, 'Delete removes the empty line before a circuit without removing its opening fence');
	await page.keyboard.press('Delete');
	assert.equal((await blocks())[0].raw, fence, 'repeated forward deletion at the circuit boundary keeps the circuit');
	await setCursor(7);
	await page.keyboard.press('Delete');
	assert.equal(await text(), `Before.\n${fence}\n\nAfter.`, 'the separator after a preceding nonempty paragraph is retained');
	console.log('Passed: note-end blank lines, mandatory fence separators, forward deletion, and ordinary text deletion.');

	await reset(`Before.\n\n${fence}\n\nMiddle.\n\n${secondFence}\n\nAfter.`);
	block = (await blocks())[0];
	await setCursor(block.from + block.raw.length + 1);
	await page.keyboard.press('Backspace');
	assert.deepEqual((await blocks()).map(block => block.raw), [fence, secondFence], 'deleting a line beside one circuit preserves both circuits verbatim');
	block = (await blocks())[0];
	await setCursor(block.from, block.from + block.raw.length);
	await page.keyboard.press('Delete');
	assert.deepEqual((await blocks()).map(block => block.raw), [secondFence], 'explicitly selecting an entire circuit in the note still allows deletion');
	assert.equal(await page.evaluate(() => window.cmCircuitTest.undo()), true);
	assert.deepEqual((await blocks()).map(block => block.raw), [fence, secondFence], 'note undo restores explicitly deleted circuit bytes');

	await reset(original);
	await page.evaluate(() => window.cmCircuitTest.setLivePreview(false));
	assert.equal(await page.locator('.cm-content .logic-circuit').count(), 0);
	block = (await blocks())[0];
	await setCursor(block.from + block.raw.length);
	await page.keyboard.press('Backspace');
	assert.equal(await text(), original.slice(0, block.from + block.raw.length - 1) + original.slice(block.from + block.raw.length), 'Source mode keeps normal raw Markdown editing, including fence characters');
	assert.deepEqual(errors, []);
	await page.screenshot({ path:join(directory, 'line-deletion.png'), fullPage:true });
	console.log('Passed: multiple circuits, explicit whole-circuit selection and deletion, and unmodified Source mode editing.');
	console.log(`Line deletion artifacts: ${directory}`);
} catch (error) {
	if (page) {
		await page.screenshot({ path:join(directory, 'failure.png'), fullPage:true });
		console.error(await page.evaluate(() => ({ text:window.cmCircuitTest?.text(), cursor:window.cmCircuitTest?.cursor() })));
	}
	console.error(`Failure artifacts: ${directory}`);
	throw error;
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}
