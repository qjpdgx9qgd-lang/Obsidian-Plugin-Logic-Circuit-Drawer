import { createElement, useState } from 'react';
import { flushSync, preinit, preinitModule } from 'react-dom';
import { createRoot } from 'react-dom/client';

function OrdinaryUI() {
	const [count, setCount] = useState(0);
	return <>
		<style>{'.runtime-script-check { color: rgb(12, 34, 56); }'}</style>
		<button className="runtime-script-check" onClick={() => setCount(value => value + 1)}>Count {count}</button>
		<svg aria-label="Ordinary SVG" width="24" height="24"><circle cx="12" cy="12" r="8" fill="blue" /></svg>
	</>;
}

const ordinaryRoot = createRoot(document.getElementById('ordinary')!);
flushSync(() => ordinaryRoot.render(<OrdinaryUI />));

const renderCase = async (name: string) => {
	const errors: string[] = [];
	const container = document.createElement('div');
	document.body.append(container);
	const root = createRoot(container, { onUncaughtError: error => errors.push(String(error)) });
	const forbidden = '/forbidden-script.js';
	const elements = {
		inline: <script>{'window.runtimeScriptExecuted = true'}</script>,
		async: <script src={forbidden} async />,
		uppercase: createElement('SCRIPT', { src: forbidden, async: true }),
		svg: <svg><script>{'window.runtimeScriptExecuted = true'}</script></svg>,
		namespaced: createElement('svg', null, createElement('svg:script', { href: forbidden })),
		raw: <div dangerouslySetInnerHTML={{ __html: '<script>window.runtimeScriptExecuted = true</script>' }} />,
	};
	try {
		flushSync(() => root.render(elements[name as keyof typeof elements]));
	} catch (error) {
		errors.push(String(error));
	}
	await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
	const scripts = container.querySelectorAll('script').length;
	root.unmount();
	container.remove();
	return { errors, scripts };
};

const preinitCase = (name: string) => {
	try {
		if (name === 'preinit') preinit('/forbidden-script.js', { as: 'script' });
		else preinitModule('/forbidden-script.js', { as: 'script' });
		return [];
	} catch (error) {
		return [String(error)];
	}
};

Object.assign(window, { runtimeScriptTest: { renderCase, preinitCase } });
