import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'scripts/**',
		'tests/**/*.mjs',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// These harnesses run in Chromium with browser DOM APIs and minimal host doubles.
		files: ['tests/browser-obsidian.ts', 'tests/cm-harness.tsx', 'tests/reading-lifecycle-fixtures.ts'],
		rules: {
			'obsidianmd/prefer-create-el': 'off',
			'obsidianmd/no-tfile-tfolder-cast': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'obsidianmd/no-static-styles-assignment': 'off',
		},
	},
);
