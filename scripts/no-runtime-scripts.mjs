import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// React DOM includes browser script loaders which this local-only editor never
// uses. Remove those capabilities before bundling, rather than patching the DOM
// or hiding script tag names from the community-plugin scanner.
// These hashes pin the audited React DOM 19.3.0 implementations. An upstream
// change requires reviewing its factories/loaders before accepting a new hash.
const auditedSources = {
	production: '8a8147c1cebdb19d82fd11bdb76391be9b20d00edf67cc8e8b30f44e850ce693',
	development: 'c10b5e5ad37ca22c88b58bf4ada9a3b655ab79934c0b5cc6bad26f42c774584f',
};
const scriptError = 'Runtime script elements are disabled in Logic circuits.';
const htmlError = 'Raw HTML rendering is disabled in Logic circuits.';
const guardName = 'logicCircuitDomTag';

function parse(contents, filename) {
	const source = ts.createSourceFile(filename, contents, ts.ScriptTarget.ES2021, true, ts.ScriptKind.JS);
	if (source.parseDiagnostics.length) throw new Error(`Cannot inspect JavaScript in ${filename}.`);
	return source;
}

function isScriptTag(tag) { return /(?:^|:)script$/i.test(tag); }

function propertyName(node) {
	if (ts.isPropertyAccessExpression(node)) return node.name.text;
	if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
}

function factoryTag(node) {
	if (!ts.isCallExpression(node)) return;
	if (propertyName(node.expression) === 'createElement') return 0;
	if (propertyName(node.expression) === 'createElementNS') return 1;
}

function contains(node, predicate) {
	return predicate(node) || !!ts.forEachChild(node, child => contains(child, predicate));
}

function constructsScript(node) {
	const index = factoryTag(node);
	const tag = index === undefined ? undefined : node.arguments[index];
	if (tag && ts.isStringLiteralLike(tag) && isScriptTag(tag.text)) return true;
	return ts.isBinaryExpression(node) && propertyName(node.left) === 'innerHTML'
		&& ts.isStringLiteralLike(node.right) && /<\s*script[\s/>]/i.test(node.right.text);
}

/** Also inspect the final emitted file: new dependencies must not add loaders. */
export function assertNoRuntimeScripts(contents, filename = 'main.js') {
	const source = parse(contents, filename);
	if (contains(source, constructsScript)) throw new Error(`Runtime script construction remains in ${filename}.`);
	if (contains(source, node =>
		(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['eval', 'Function'].includes(node.expression.text))
		|| (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function'))) {
		throw new Error(`Runtime code generation remains in ${filename}.`);
	}
}

export function restrictReactDom(contents, variant) {
	if (!auditedSources[variant] || createHash('sha256').update(contents).digest('hex') !== auditedSources[variant]) {
		throw new Error(`React DOM ${variant} differs from the audited 19.3.0 build; review its runtime script paths.`);
	}
	if (contents.includes(guardName)) throw new Error('React DOM tag guard name collision.');
	const source = parse(contents, `react-dom-client.${variant}.js`);
	const counts = { loaders: 0, scriptBranches: 0, htmlBranches: 0, factories: 0, normalizers: 0 };
	const result = ts.transform(source, [context => {
		const f = context.factory;
		const reject = message => f.createThrowStatement(f.createNewExpression(f.createIdentifier('Error'), undefined, [f.createStringLiteral(message)]));
		const rejectBody = message => f.createBlock([reject(message)], true);
		function visit(node) {
			if (ts.isFunctionDeclaration(node) && ['preinitScript', 'preinitModuleScript'].includes(node.name?.text)) {
				counts.loaders++;
				return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name,
					node.typeParameters, node.parameters, node.type, rejectBody(scriptError));
			}
			// The development build exposes the same loaders as dispatcher members.
			if (ts.isPropertyAssignment(node) && ['X', 'M'].includes(node.name.getText(source))
				&& ts.isFunctionExpression(node.initializer) && contains(node.initializer, constructsScript)) {
				counts.loaders++;
				const fn = node.initializer;
				return f.updatePropertyAssignment(node, node.name, f.updateFunctionExpression(fn, fn.modifiers,
					fn.asteriskToken, fn.name, fn.typeParameters, fn.parameters, fn.type, rejectBody(scriptError)));
			}
			if (ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeHTML') {
				counts.normalizers++;
				return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name,
					node.typeParameters, node.parameters, node.type, rejectBody(htmlError));
			}
			if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
				if (node.expression.text === 'script' && contains(node, constructsScript)) {
					counts.scriptBranches++;
					return f.updateCaseClause(node, node.expression, [reject(scriptError)]);
				}
				if (node.expression.text === 'dangerouslySetInnerHTML' && contains(node, child =>
					(ts.isBinaryExpression(child) && ts.isPropertyAccessExpression(child.left) && child.left.name.text === 'innerHTML')
					|| (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'normalizeHTML'))) {
					counts.htmlBranches++;
					return f.updateCaseClause(node, node.expression, [reject(htmlError)]);
				}
			}
			const index = factoryTag(node);
			if (index !== undefined && !ts.isStringLiteralLike(node.arguments[index])) {
				// Covers dynamic tags, including SVG/MathML and case variants, without
				// changing any global DOM methods or React's ordinary node handling.
				counts.factories++;
				const args = node.arguments.map((arg, i) => i === index
					? f.createCallExpression(f.createIdentifier(guardName), undefined, [arg]) : arg);
				return f.updateCallExpression(node, node.expression, node.typeArguments, args);
			}
			return ts.visitEachChild(node, visit, context);
		}
		return node => ts.visitNode(node, visit);
	}]);
	try {
		const expected = variant === 'production'
			? { loaders: 2, scriptBranches: 2, htmlBranches: 2, factories: 10, normalizers: 0 }
			: { loaders: 2, scriptBranches: 2, htmlBranches: 4, factories: 10, normalizers: 1 };
		if (JSON.stringify(counts) !== JSON.stringify(expected)) throw new Error(`Unexpected React DOM ${variant} script paths: ${JSON.stringify(counts)}.`);
		const output = ts.createPrinter().printFile(result.transformed[0]) + `\nfunction ${guardName}(tag) {
	if (/(?:^|:)script$/i.test(tag)) throw new Error(${JSON.stringify(scriptError)});
	return tag;
}\n`;
		assertNoRuntimeScripts(output, `restricted React DOM ${variant}`);
		return output;
	} finally { result.dispose(); }
}

export function noRuntimeScripts() {
	return {
		name: 'no-runtime-scripts',
		setup(build) {
			build.onLoad({ filter: /[/\\]react-dom[/\\]cjs[/\\]react-dom-client\.(production|development)\.js$/ }, async args => {
				const variant = /\.(production|development)\.js$/.exec(args.path)[1];
				return { contents: restrictReactDom(await readFile(args.path, 'utf8'), variant), loader: 'js' };
			});
		},
	};
}
