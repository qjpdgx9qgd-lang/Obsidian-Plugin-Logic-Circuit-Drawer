import { Plugin } from 'obsidian';
import './ui/styles.css';
import { loadSettings, LogicCircuitSettingTab } from './settings';
import type { LogicCircuitSettings } from './settings';
import { SessionManager } from './integration/session-manager';
import { registerCircuitCommands } from './integration/commands';
import { livePreviewExtension } from './integration/live-preview';
import { renderReadingCircuit } from './integration/reading-view';

export default class LogicCircuitPlugin extends Plugin {
	settings!: LogicCircuitSettings;
	async onload(): Promise<void> {
		this.settings = loadSettings(await this.loadData());
		const sessions = new SessionManager(this.app);
		this.register(() => sessions.dispose());
		this.registerEvent(this.app.workspace.on('file-open', () => sessions.refreshWorkspace()));
		this.registerEvent(this.app.workspace.on('layout-change', () => sessions.refreshWorkspace()));
		registerCircuitCommands(this, sessions, () => this.settings);
		this.registerMarkdownCodeBlockProcessor('logic-circuit', (source, element, context) => {
			renderReadingCircuit(this.app, sessions, source, element, context);
		});
		this.registerEditorExtension(livePreviewExtension(sessions));
		this.addSettingTab(new LogicCircuitSettingTab(this.app, this));
	}
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
