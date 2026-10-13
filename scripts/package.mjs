import { mkdir, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const { id } = JSON.parse(await readFile('manifest.json', 'utf8'));
if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid plugin ID.');
const output = path.join('dist', id);
await mkdir(output, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-NOTICES.txt']) {
	await copyFile(file, path.join(output, file));
}
console.log(`Installable files prepared in ${output}.`);
