import { build } from 'esbuild';
import { readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tests = (await readdir('tests')).filter(name => name.endsWith('.test.ts'));
const directory = await mkdtemp(join(tmpdir(), 'logic-circuit-tests-'));
const outputs = [];
for (const test of tests) {
	const output = join(directory, test.replace(/\.ts$/, '.cjs'));
	await build({ entryPoints: [join('tests', test)], bundle: true, platform: 'node', format: 'cjs', outfile: output, alias: { obsidian: './tests/obsidian-stub.ts' }, logLevel: 'warning' });
	outputs.push(output);
}
if (!outputs.length) throw new Error('No tests found.');
const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
