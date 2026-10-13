import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Collect notices from the actual bundled packages, not development tools. */
export async function licenseNotices(metafile) {
	const root = process.cwd();
	const modules = path.join(root, 'node_modules');
	const packages = new Map();
	for (const input of Object.keys(metafile.inputs)) {
		if (!input.startsWith('node_modules/')) continue;
		let directory = path.dirname(path.resolve(root, input));
		while (directory.startsWith(`${modules}${path.sep}`)) {
			let metadata;
			try { metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); }
			catch (error) { if (error.code !== 'ENOENT') throw error; }
			if (metadata?.name) {
				packages.set(directory, metadata);
				break;
			}
			directory = path.dirname(directory);
		}
	}
	const sections = [
		'Third-party notices\n\nThe plugin is licensed under MIT. The following components retain their original licenses.',
		'Obsidian sample plugin (0BSD)\n\n' + await readFile('licenses/obsidian-sample-plugin-0BSD.txt', 'utf8'),
	];
	for (const [directory, metadata] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
		let license;
		for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt']) {
			try { license = await readFile(path.join(directory, filename), 'utf8'); break; }
			catch (error) { if (error.code !== 'ENOENT') throw error; }
		}
		if (!license) throw new Error(`Missing license text for bundled dependency ${metadata.name}.`);
		sections.push(`${metadata.name} ${metadata.version} (${metadata.license})\n\n${license}`);
	}
	return sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n';
}
