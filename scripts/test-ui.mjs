import { spawnSync } from 'node:child_process';

for (const test of ['tests/ui-smoke.mjs', 'tests/cm-smoke.mjs']) {
	const result = spawnSync(process.execPath, [test], { stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status ?? 1);
}
