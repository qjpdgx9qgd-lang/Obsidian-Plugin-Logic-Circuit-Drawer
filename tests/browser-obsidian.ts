import { StateField } from '@codemirror/state';

/** Browser runtime substitutes for the host APIs; CodeMirror itself is real. */
export class TFile { constructor(public path: string) {} }
export class Editor {}
export class MarkdownView {
	mode: 'source' | 'preview' = 'source';
	constructor(public file: TFile | null, public editor: unknown, public containerEl: HTMLElement) {}
	getMode() { return this.mode; }
}
export class App {}
export class Modal {}
export class Notice {
	constructor(message: string) {
		const element = document.createElement('div');
		element.className = 'browser-notice'; element.setAttribute('role', 'alert');
		element.textContent = message; document.body.append(element);
	}
}
export class MarkdownRenderChild {
	constructor(public containerEl: HTMLElement) {}
	onload() {}
	onunload() {}
}
export const editorInfoField = StateField.define<unknown>({ create: () => undefined, update: value => value });
export const editorLivePreviewField = StateField.define({ create: () => true, update: value => value });

class MenuItem {
	title = '';
	action: (() => void) | undefined;
	setTitle(title: string) { this.title = title; return this; }
	setIcon(_icon: string) { return this; }
	setWarning(_warning: boolean) { return this; }
	onClick(action: () => void) { this.action = action; return this; }
}
export class Menu {
	private items: MenuItem[] = [];
	private closed: (() => void)[] = [];
	private element: HTMLElement | null = null;
	addItem(build: (item: MenuItem) => void) { const item = new MenuItem(); build(item); this.items.push(item); return this; }
	onHide(callback: () => void) { this.closed.push(callback); }
	hide() { this.element?.remove(); this.element = null; for (const callback of this.closed.splice(0)) callback(); return this; }
	showAtMouseEvent(event: MouseEvent) {
		document.querySelector('.browser-menu')?.remove();
		const menu = document.createElement('div'); menu.className = 'browser-menu menu'; menu.setAttribute('role', 'menu'); this.element = menu;
		menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:10000`;
		for (const item of this.items) {
			const button = document.createElement('button'); button.textContent = item.title; button.setAttribute('role', 'menuitem');
			button.onclick = () => { this.hide(); item.action?.(); }; menu.append(button);
		}
		document.body.append(menu);
	}
}

HTMLElement.prototype.addClass = function (...classes: string[]) { this.classList.add(...classes); };
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
