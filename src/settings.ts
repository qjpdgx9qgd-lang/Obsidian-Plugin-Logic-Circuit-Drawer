import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type LogicCircuitPlugin from './main';
import { MIN_SCALE, MAX_SCALE } from './model/circuit';
export { MIN_SCALE, MAX_SCALE } from './model/circuit';

export interface LogicCircuitSettings { defaultScale: number; }
export const DEFAULT_SETTINGS: LogicCircuitSettings = { defaultScale: 1 };

export function loadSettings(value: unknown): LogicCircuitSettings {
	const scale = typeof value === 'object' && value !== null && 'defaultScale' in value ? value.defaultScale : undefined;
	return { defaultScale: typeof scale === 'number' && Number.isFinite(scale)
		&& scale >= MIN_SCALE && scale <= MAX_SCALE ? scale : DEFAULT_SETTINGS.defaultScale };
}

export class LogicCircuitSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: LogicCircuitPlugin) { super(app, plugin); }
	display(): void {
		this.containerEl.empty();
		new Setting(this.containerEl)
			.setName('Default circuit scale')
			.setDesc('Initial size for new circuits, from 25% to 300%. Existing circuits keep their scale.')
			.addText((text) => text.setPlaceholder('100')
				.setValue(String(Math.round(this.plugin.settings.defaultScale * 100)))
				.onChange(async (value) => {
					const scale = Number(value.trim()) / 100;
					if (!value.trim() || !Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
						text.inputEl.setAttribute('aria-invalid', 'true');
						text.inputEl.setAttribute('title', 'Enter a percentage from 25 to 300.');
						return;
					}
					text.inputEl.removeAttribute('aria-invalid');
					this.plugin.settings.defaultScale = scale;
					try { await this.plugin.saveSettings(); }
					catch { new Notice('Could not save the default circuit scale.'); }
				}));
	}
}
