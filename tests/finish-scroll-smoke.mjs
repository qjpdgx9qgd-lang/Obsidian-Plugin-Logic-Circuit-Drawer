import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'logic-circuit-finish-scroll-'));
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
 browser = await chromium.launch({ executablePath, headless:true });
 page = await browser.newPage({ viewport:{ width:1100, height:800 } });
 page.setDefaultTimeout(10000);
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 const first = () => page.locator('.cm-content .logic-circuit[data-circuit-id="first-circuit"]');
 const measure = () => page.evaluate(() => {
  const scroller = document.querySelector('.cm-scroller');
  const block = document.querySelector('.cm-content .logic-circuit');
  return { scrollTop:scroller.scrollTop, pageTop:document.scrollingElement.scrollTop,
   circuitTop:block.getBoundingClientRect().top, circuitHeight:block.getBoundingClientRect().height,
   active:document.activeElement?.className, selection:window.cmCircuitTest.selectionRange(),
   editing:window.cmCircuitTest.snapshot('first-circuit').editing,
   scrollHeight:scroller.scrollHeight, clientHeight:scroller.clientHeight };
 });
 for (const fallback of [false,true]) for (const bottom of [false,true]) for (const movedOrigin of [false,true]) for (const exit of ['done-mouse','done-keyboard','outside']) for (const pendingSave of [false,true]) {
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => Boolean(window.cmCircuitTest));
  await page.addStyleTag({ content:'.cm-scroller { height:360px !important; overflow:auto !important; }' });
  await page.evaluate(({bottom,fallback}) => window.cmCircuitTest.prepareScrollScenario(bottom,fallback), {bottom,fallback});
  await first().getByRole('button', {name:'Done',exact:true}).waitFor();
  await frames();
  const top = bottom ? -30 : 100;
  await first().evaluate((block,top) => {
   const note=document.querySelector('.cm-scroller');
   note.scrollTop += block.getBoundingClientRect().top-(note.getBoundingClientRect().top+top);
  },top);
  await page.evaluate(() => window.scrollTo(0,0));
  await frames();
  // Closing resets the fixed editing origin to the current topmost object.
  // This adds an 80px canvas contraction to the chrome contraction.
  if (pendingSave) await page.evaluate(()=>window.cmCircuitTest.holdCircuitWrites());
  if (movedOrigin || pendingSave) {
   const rect=await first().locator('[data-id="fixed-top"] .logic-object').boundingBox();
   await page.mouse.move(rect.x+24,rect.y+12); await page.mouse.down();
   await page.mouse.move(rect.x+24+(movedOrigin ? 0 : 16),rect.y+12+(movedOrigin ? 80 : 0),{steps:8}); await page.mouse.up();
   if (!pendingSave) await page.evaluate(()=>window.cmCircuitTest.flush('first-circuit'));
   await frames();
   if (movedOrigin) assert.equal(await page.evaluate(()=>window.cmCircuitTest.snapshot('first-circuit').circuit.nodes.find(node=>node.id==='fixed-top').position.y),80,
    'the origin-changing scenario performs a real node drag');
  }
  const before = await measure();
  const beforeText = await page.evaluate(()=>window.cmCircuitTest.text());
  if(exit==='done-mouse') {
   const rect=await first().locator('button.logic-done').boundingBox();
   await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
  } else if(exit==='done-keyboard') {
   await first().locator('button.logic-done').evaluate(button=>button.focus({preventScroll:true}));
   await page.keyboard.press('Enter');
  } else await page.locator('#own-note-unfocusable').click();
  if (pendingSave) {
   await frames();
   assert.equal(await page.evaluate(()=>window.cmCircuitTest.snapshot('first-circuit').editing),true,'completion waits for the held circuit save');
   assert.equal(await page.evaluate(()=>window.cmCircuitTest.snapshot('first-circuit').saving),true,'the delayed completion exercises a real pending save');
   await page.evaluate(()=>window.cmCircuitTest.releaseCircuitWrites());
  }
  await page.waitForFunction(()=>!window.cmCircuitTest.snapshot('first-circuit').editing);
  await frames();
  const after = await measure();
  const scenario=`${fallback ? 'native fallback' : 'custom widget'}, ${bottom ? 'note end' : 'interior'}, ${movedOrigin ? 'changed origin' : 'unchanged bounds'}, ${exit}, ${pendingSave ? 'pending save' : 'saved'}`;
  const expectedTop=Math.min(before.scrollTop,after.scrollHeight-after.clientHeight);
  assert.equal(after.editing,false,`${scenario}: the gesture closes editing`);
  assert.ok(after.circuitHeight < before.circuitHeight,`${scenario}: editing chrome really contracts the widget`);
  assert.ok(Math.abs(after.scrollTop-expectedTop)<=1,`${scenario}: closing must make only the unavoidable legal clamp (${expectedTop}), got ${after.scrollTop}`);
  assert.ok(Math.abs(after.circuitTop-before.circuitTop-(before.scrollTop-expectedTop))<=1,`${scenario}: closing adds no extra circuit screen movement`);
  assert.equal(after.pageTop,before.pageTop,`${scenario}: the outer page stays stationary`);
  assert.deepEqual(after.selection,before.selection,`${scenario}: closing preserves the Markdown selection`);
  const expectedText=pendingSave ? beforeText.replace(movedOrigin ? '"y": 0' : '"x": 240',movedOrigin ? '"y": 80' : '"x": 256') : beforeText;
  assert.equal(await page.evaluate(()=>window.cmCircuitTest.text()),expectedText,`${scenario}: closing preserves every note byte except its expected pending drag save`);
 }
 assert.deepEqual(errors,[],'the finish-scroll regression emits no browser errors');
 console.log('Passed: closing with Done, keyboard, or outside click preserves the viewport across interior/end-note shrink and origin normalization, in custom and native fallback widgets.');
} catch(error) {
 if(page) await page.screenshot({path:join(directory,'failure.png'),fullPage:true}).catch(()=>{});
 console.log(`Finish-scroll artifacts: ${directory}`);
 throw error;
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
