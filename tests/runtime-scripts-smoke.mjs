import { build } from 'esbuild';
import { noRuntimeScripts } from '../scripts/no-runtime-scripts.mjs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'logic-circuit-runtime-scripts-'));
const environments = ['development', 'production'];
for (const environment of environments) {
	const output = join(directory, environment);
	await mkdir(output);
	await build({
		entryPoints: ['tests/runtime-scripts-harness.tsx'], bundle: true, platform: 'browser',
		outfile: join(output, 'app.js'), define: { 'process.env.NODE_ENV': JSON.stringify(environment) },
		plugins: [noRuntimeScripts()], minify: environment === 'production', logLevel: 'warning',
	});
	// This parser-loaded entry point belongs to the test page, not the plugin runtime.
	await writeFile(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="ordinary"></div><script src="app.js"></script></body></html>');
}

const server = createServer((request, response) => {
	const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
	if (!/^\/(development|production)\/(index\.html|app\.js)$/.test(pathname)) { response.writeHead(404).end(); return; }
	void readFile(join(directory, pathname.slice(1))).then(data => {
		response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
		response.end(data);
	}).catch(() => response.writeHead(500).end());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || join(homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
let browser;

try {
	browser = await chromium.launch({ executablePath, headless: true });
	for (const environment of environments) {
		const page = await browser.newPage();
		const pageErrors = [];
		const forbiddenRequests = [];
		page.on('pageerror', error => pageErrors.push(error.message));
		page.on('request', request => { if (request.url().includes('forbidden-script')) forbiddenRequests.push(request.url()); });
		await page.addInitScript(() => {
			const attempts = [];
			Object.assign(window, { runtimeScriptAttempts: attempts });
			const reject = kind => { attempts.push(kind); throw new Error('Test detected runtime script construction: ' + kind); };
			const createElement = Document.prototype.createElement;
			Document.prototype.createElement = function (name, ...args) {
				if (String(name).toLowerCase() === 'script') reject('createElement');
				return createElement.call(this, name, ...args);
			};
			const createElementNS = Document.prototype.createElementNS;
			Document.prototype.createElementNS = function (namespace, name, ...args) {
				if (String(name).split(':').at(-1).toLowerCase() === 'script') reject('createElementNS');
				return createElementNS.call(this, namespace, name, ...args);
			};
			const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
			Object.defineProperty(Element.prototype, 'innerHTML', {
				...innerHTML,
				set(value) {
					if (/<script(?:\s|>)/i.test(String(value))) reject('innerHTML');
					innerHTML.set.call(this, value);
				},
			});
			for (const method of ['appendChild', 'insertBefore', 'replaceChild']) {
				const original = Node.prototype[method];
				Node.prototype[method] = function (node, ...args) {
					if (node.nodeName?.toLowerCase() === 'script' || node.querySelector?.('script')) reject(method);
					return original.call(this, node, ...args);
				};
			}
		});
		await page.goto(`http://127.0.0.1:${address.port}/${environment}/index.html`);
		await page.waitForFunction(() => Boolean(window.runtimeScriptTest));
		await page.getByRole('button', { name: 'Count 0', exact: true }).click();
		await page.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
		assert.equal(await page.locator('.runtime-script-check').evaluate(element => getComputedStyle(element).color), 'rgb(12, 34, 56)', `${environment}: ordinary styles remain functional`);
		assert.equal(await page.getByLabel('Ordinary SVG', { exact: true }).locator('circle').getAttribute('r'), '8', `${environment}: SVG still renders`);

		for (const api of ['preinit', 'preinitModule']) {
			const errors = await page.evaluate(api => window.runtimeScriptTest.preinitCase(api), api);
			assert.ok(errors.some(error => /script.*disabled|disabled.*script/i.test(error)), `${environment}: ${api} must reject scripts before using the DOM; got ${errors}`);
		}
		assert.deepEqual(await page.evaluate(() => window.runtimeScriptAttempts), [], `${environment}: preinit APIs never construct scripts`);
		for (const name of ['inline', 'async', 'uppercase', 'svg', 'namespaced', 'raw']) {
			// Each intentional React root failure gets its own runtime so resource
			// error recovery from one forbidden render cannot defer the next case.
			await page.reload();
			await page.waitForFunction(() => Boolean(window.runtimeScriptTest));
			const result = await page.evaluate(name => window.runtimeScriptTest.renderCase(name), name);
			const disabled = name === 'raw' ? /raw html.*disabled/i : /script.*disabled|disabled.*script/i;
			assert.ok(result.errors.some(error => disabled.test(error)), `${environment}: ${name} script render must reject before using the DOM; got ${result.errors}`);
			assert.equal(result.scripts, 0, `${environment}: ${name} script cannot enter the rendered tree`);
			assert.deepEqual(await page.evaluate(() => window.runtimeScriptAttempts), [], `${environment}: ${name} never constructs or inserts a script`);
			assert.equal(await page.evaluate(() => window.runtimeScriptExecuted), undefined, `${environment}: ${name} never executes a script`);
		}
		assert.deepEqual(forbiddenRequests, [], `${environment}: scripts never initiate requests`);
		assert.deepEqual(pageErrors, [], `${environment}: ordinary UI has no uncaught errors`);
		await page.close();
	}
	console.log('Runtime script guards: development and production passed');
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}
