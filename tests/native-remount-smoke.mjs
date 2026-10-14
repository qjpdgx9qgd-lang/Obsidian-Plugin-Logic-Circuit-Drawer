import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'logic-circuit-native-remount-'));
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
 browser=await chromium.launch({executablePath,headless:true});
 page=await browser.newPage({viewport:{width:1100,height:1000}});
 const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const demo=await readFile('tests/fixtures/adding-two-bits.md','utf8');
 const ids=[...demo.matchAll(/"circuitId": "([^"]+)"/g)].map(match=>match[1]);
 const capture=id=>page.evaluate(id=>{
  const note=document.querySelector('.cm-scroller');
  const circuit=document.querySelector(`.cm-content .logic-circuit[data-circuit-id="${id}"]`);
  return {top:note.scrollTop,max:note.scrollHeight-note.clientHeight,circuitTop:circuit.getBoundingClientRect().top,circuitHeight:circuit.getBoundingClientRect().height,
   focus:circuit===document.activeElement,selection:window.cmCircuitTest.selectionRange(),text:window.cmCircuitTest.text()};
 },id);
 // Moving the last upper node leaves deliberate workspace. A save or host
 // redraw must not normalize that workspace while the session is still open.
 for(const nativeFallback of [false,true]) {
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(()=>Boolean(window.cmCircuitTest));
  await page.addStyleTag({content:'.cm-scroller {height:766px!important;overflow:auto!important;} #editor {max-width:700px!important;}'});
  if(nativeFallback) await page.evaluate(()=>window.cmCircuitTest.forceNativeReplacements());
  await page.evaluate(nativeFallback=>window.cmCircuitTest.prepareScrollScenario(false,nativeFallback),nativeFallback);
  const circuit=page.locator('.cm-content .logic-circuit[data-circuit-id="first-circuit"]');
  await circuit.locator('button.logic-done').waitFor(); await frames();
  await circuit.evaluate(element=>{const note=document.querySelector('.cm-scroller');note.scrollTop+=element.getBoundingClientRect().top-note.getBoundingClientRect().top-20;});
  await frames();
  const geometry=()=>circuit.evaluate(element=>{
   const canvas=element.querySelector('.logic-canvas');
   const viewport=new DOMMatrix(getComputedStyle(element.querySelector('.react-flow__viewport')).transform);
   const relativeTop=id=>element.querySelector(`[data-id="${id}"]`).getBoundingClientRect().top-canvas.getBoundingClientRect().top;
   return {height:canvas.getBoundingClientRect().height,scale:viewport.a,panY:viewport.f,
    movingTop:relativeTop('fixed-top'),stationaryTop:relativeTop('original-and')};
  });
  const text=()=>page.evaluate(()=>window.cmCircuitTest.text());
  const savedPositions=()=>page.evaluate(()=>window.cmCircuitTest.snapshot('first-circuit').circuit.nodes.map(node=>({id:node.id,position:node.position})));
  const flush=async()=>{
   await page.evaluate(()=>window.cmCircuitTest.flush('first-circuit'));
   await circuit.locator('button.logic-done').waitFor(); await frames();
   await page.evaluate(()=>window.cmCircuitTest.measureEditor());
  };
  const drag=async(distance)=>{
   const box=await circuit.locator('[data-id="fixed-top"] .logic-object-and').boundingBox();
   const {scale}=await geometry();
   await page.mouse.move(box.x+24*scale,box.y+12*scale); await page.mouse.down();
   await page.mouse.move(box.x+24*scale,box.y+(12+distance)*scale,{steps:8});
   await frames();
  };
  const initial=await geometry();
  const originalText=await text();
  const originalPositions=await savedPositions();
  assert.equal(await circuit.evaluate(element=>Boolean(element.closest('.native-fallback-widget'))),nativeFallback);
  await circuit.evaluate(element=>{window.oldNativeCircuit=element;});
  await drag(80);
  const moved=await geometry();
  assert.equal(moved.height,initial.height,'leaving the upper workspace empty does not shrink the canvas during a drag');
  assert.equal(moved.panY,initial.panY,'the editing origin remains fixed during a drag');
  assert.ok(Math.abs(moved.movingTop-initial.movingTop-80*initial.scale)<=1,'the dragged node follows the pointer into the retained workspace');
  assert.equal(moved.stationaryTop,initial.stationaryTop,'an untouched node remains at its original canvas position');
  await page.mouse.up(); await flush();
  const saved=await geometry();
  assert.equal(saved.height,initial.height,`nativeFallback=${nativeFallback}: saving the last upper node must retain the empty space while editing`);
  assert.equal(saved.panY,initial.panY,'saving leaves the editing origin fixed');
  assert.ok(Math.abs(saved.movingTop-moved.movingTop)<=1,'save completion does not pull the dragged node back toward the canvas top');
  assert.equal(saved.stationaryTop,initial.stationaryTop,'save completion does not move an untouched node');
  assert.deepEqual(await savedPositions(),originalPositions.map(node=>node.id==='fixed-top'?{...node,position:{...node.position,y:80}}:node));
  if(nativeFallback) {
   assert.equal(await page.evaluate(()=>window.oldNativeCircuit.isConnected),false,'the regression crosses a real save-driven DOM replacement');
   const savedText=await text();
   await circuit.evaluate(element=>{window.oldNativeCircuit=element;});
   await page.evaluate(()=>window.cmCircuitTest.redrawNativeWidgets());
   await page.waitForFunction(()=>{
    const current=document.querySelector('.cm-content .logic-circuit[data-circuit-id="first-circuit"]');
    return current&&current!==window.oldNativeCircuit;
   });
   await frames();
   assert.equal(await text(),savedText,'host-only redraw does not rewrite the note');
   assert.deepEqual(await geometry(),saved,'host-only redraw retains the upper workspace and all relative node positions');
  }
  const firstEditText=await text();
  await page.keyboard.press('Meta+z'); await flush();
  assert.equal(await text(),originalText,'undo restores the exact pre-drag Markdown');
  assert.deepEqual(await geometry(),initial,'undo retains the same editing origin');
  await page.keyboard.press('Meta+Shift+z'); await flush();
  assert.equal(await text(),firstEditText,'redo restores the exact saved drag without normalizing its workspace');
  assert.deepEqual(await geometry(),saved,'redo and its save retain the upper empty space');
  await drag(40); await page.mouse.up(); await flush();
  const repeated=await geometry();
  assert.equal(repeated.height,initial.height,'a second downward drag does not collapse the existing upper space');
  assert.equal(repeated.panY,initial.panY,'the same origin survives successive completed drags');
  const finalPositions=originalPositions.map(node=>node.id==='fixed-top'?{...node,position:{...node.position,y:120}}:node);
  assert.deepEqual(await savedPositions(),finalPositions);
  const completedText=await text();
  await circuit.locator('button.logic-done').click();
  await page.waitForFunction(()=>!window.cmCircuitTest.snapshot('first-circuit').editing); await frames();
  const closed=await geometry();
  assert.ok(Math.abs(closed.height-(initial.height-120*initial.scale))<=1,'Done collapses only the accumulated upper empty space');
  assert.ok(Math.abs(closed.movingTop-initial.movingTop)<=1,'the finished diagram normalizes its topmost node');
  assert.equal(await text(),completedText,'finishing only changes presentation, preserving every Markdown byte');
  assert.deepEqual(await savedPositions(),finalPositions,'finishing preserves the exact saved node positions');
  await circuit.locator('.logic-edit').click();
  await circuit.locator('button.logic-done').waitFor(); await frames();
  const reopened=await geometry();
  assert.deepEqual(reopened,closed,'a new editing session starts from the normalized finished bounds');
  assert.equal(await text(),completedText,'reopening does not write presentation state into the note');
 }
 console.log('Passed: top workspace survives drag saves, native replacement/redraw, undo/redo, and repeated moves; Done alone collapses it and reopen starts normalized.');
 for(const id of ids) for(const down of [false,true]) for(const staggered of id===ids[1] ? [false,true] : [false]) {
  await page.goto(`http://127.0.0.1:${address.port}/?nativeReplacement=1`);
  await page.waitForFunction(()=>Boolean(window.cmCircuitTest));
  await page.addStyleTag({content:'.cm-scroller {height:766px!important;overflow:auto!important;} #editor {max-width:700px!important;}'});
  await page.evaluate(({demo,id})=>window.cmCircuitTest.prepareNoteScrollScenario(demo,id,true),{demo,id});
  const circuit=page.locator(`.cm-content .logic-circuit[data-circuit-id="${id}"]`);
  await circuit.locator('button.logic-done').waitFor(); await frames();
  await circuit.evaluate(element=>{const note=document.querySelector('.cm-scroller');note.scrollTop+=element.getBoundingClientRect().top-note.getBoundingClientRect().top-20;});
  await frames();
  await circuit.evaluate(element=>{window.oldNativeCircuit=element;});
  const node=circuit.locator('[data-id="a"] .logic-object');
  const box=await node.boundingBox();
  const scale=await circuit.locator('.react-flow__viewport').evaluate(element=>new DOMMatrix(getComputedStyle(element).transform).a);
  await page.mouse.move(box.x+box.width/2,box.y+5); await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+40*scale,box.y+5+(down?72:0)*scale,{steps:8});
  await frames();
  const before=await capture(id);
  if(staggered) await page.evaluate(()=>window.cmCircuitTest.holdNativeRendering());
  await page.mouse.up();
  await page.evaluate(id=>window.cmCircuitTest.flush(id),id);
  if(staggered) {
   await page.evaluate(id=>window.cmCircuitTest.releaseNativeRendering(id),id);
   await circuit.locator('button.logic-done').waitFor(); await frames();
   await page.evaluate(()=>window.cmCircuitTest.releaseNativeRendering());
  }
  await circuit.locator('button.logic-done').waitFor();
  await frames();
  await page.evaluate(()=>window.cmCircuitTest.measureEditor());
  const after=await capture(id);
  assert.equal(await page.evaluate(()=>window.oldNativeCircuit.isConnected),false,'the save replaces the actual old native widget DOM');
  const gaps=await page.evaluate(()=>window.cmCircuitTest.nativeReplacementGaps());
  assert.ok(gaps.some(gap=>gap.rendered===0),'dispatch exposes the real empty interval before asynchronous renderer roots mount');
  const screenDelta=after.circuitTop-before.circuitTop;
  assert.ok(Math.abs(screenDelta)<=1 || screenDelta>0 && Math.abs(after.top-after.max)<=1,
   `${id}, down=${down}: native replacement preserves the screen anchor except a final legal bottom clamp; delta=${screenDelta}, scroll=${after.top}, max=${after.max}`);
  assert.equal(after.focus,true,'the successor circuit owns focus after its predecessor is removed');
  assert.deepEqual(after.selection,before.selection,'native replacement preserves the retained Markdown caret');
  const position=await page.evaluate(id=>window.cmCircuitTest.snapshot(id).circuit.nodes.find(node=>node.id==='a').position,id);
  assert.deepEqual(position,{x:56,y:down?80:8},'the real pointer gesture saves its exact node position');
  await circuit.locator('button.logic-done').click();
  await page.waitForFunction(id=>!window.cmCircuitTest.snapshot(id).editing,id);
  await frames();
  await page.evaluate(()=>window.cmCircuitTest.measureEditor());
  const closed=await capture(id);
  await circuit.evaluate(element=>{window.oldNativeCircuit=element;});
  await page.evaluate(()=>window.cmCircuitTest.redrawNativeWidgets());
  await page.waitForFunction(id=>{
   const current=document.querySelector(`.cm-content .logic-circuit[data-circuit-id="${id}"]`);
   return current && current!==window.oldNativeCircuit;
  },id);
  await frames();
  await page.evaluate(()=>window.cmCircuitTest.measureEditor());
  const redrawn=await capture(id);
  assert.equal(await page.evaluate(()=>window.oldNativeCircuit.isConnected),false,'a host-only redraw replaces the completed circuit without changing the note');
  assert.equal(redrawn.text,closed.text,'host redraw after Done preserves every note byte');
  assert.deepEqual(redrawn.selection,closed.selection,'host redraw after Done preserves the retained Markdown caret');
  assert.equal(redrawn.focus,true,'host redraw after Done retains ownership of circuit keyboard shortcuts');
  const redrawDelta=redrawn.circuitTop-closed.circuitTop;
  assert.ok(Math.abs(redrawDelta)<=1 || redrawDelta>0 && Math.abs(redrawn.top-redrawn.max)<=1,
   `host redraw ${id}, down=${down}, staggered=${staggered}, closed=${closed.top}/${closed.max}/${closed.circuitTop} preserves its screen anchor except a final legal bottom clamp; delta=${redrawDelta}, scroll=${redrawn.top}, max=${redrawn.max}`);
  const early=await page.evaluate(()=>window.cmCircuitTest.nativeEarlyRemovals());
  assert.ok(early.some(removal=>removal.renderedBefore>0 && removal.focusedBefore && !removal.focusedAfter),
   'native RenderChild unload removes the focused root before any ViewPlugin update');
 }
 console.log('Passed: both demo circuits retain focus and viewport across synchronous native widget removal and asynchronous replacement during payload saves.');
} catch(error) {
 if(page) await page.screenshot({path:join(directory,'failure.png'),fullPage:true}).catch(()=>{});
 console.log(`Native-remount artifacts: ${directory}`); throw error;
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
