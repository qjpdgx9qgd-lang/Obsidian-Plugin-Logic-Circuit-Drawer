/** Minimal runtime classes for testing guarded writes without launching Obsidian. */
export class TFile {
	constructor(public path: string) {}
	get extension(): string { return this.path.split('.').at(-1) ?? ''; }
}

export class MarkdownView {
	mode: 'source' | 'preview' = 'source';
	constructor(public file: TFile | null, public editor: unknown) {}
	getMode(): 'source' | 'preview' { return this.mode; }
	getViewType(): string { return 'markdown'; }
}

export class App {}
export class Editor {}
export class Modal {}
export class Notice {
	static messages: string[] = [];
	constructor(message: string) { Notice.messages.push(message); }
}

class MenuItem {
	title = '';
	action: (() => void) | undefined;
	setTitle(title: string) { this.title = title; return this; }
	setIcon(_icon: string) { return this; }
	setWarning(_warning: boolean) { return this; }
	onClick(action: () => void) { this.action = action; return this; }
}
export class Menu {
	static last: Menu | undefined;
	items: MenuItem[] = [];
	private hidden: (() => void) | undefined;
	addItem(build: (item: MenuItem) => void) { const item = new MenuItem(); build(item); this.items.push(item); return this; }
	onHide(action: () => void) { this.hidden = action; }
	showAtMouseEvent(_event: MouseEvent) { Menu.last = this; }
	hide() { this.hidden?.(); }
}
