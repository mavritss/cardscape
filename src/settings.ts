import { App, PluginSettingTab, Setting } from "obsidian";
import type MyPlugin from "./main";

export interface GalleryPluginSettings {
	folderPath: string;
}

export const DEFAULT_SETTINGS: GalleryPluginSettings = {
	folderPath: "",
};

export class GallerySettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Pinterest Cards Gallery" });

		new Setting(containerEl)
			.setName("Папка с заметками")
			.setDesc(
				'Путь к папке внутри хранилища Obsidian, например "Notes/Projects". Оставьте пустым, чтобы использовать весь vault.',
			)
			.addText((text) =>
				text
					.setPlaceholder("Например: Notes/Projects")
					.setValue(this.plugin.settings.folderPath)
					.onChange(async (value) => {
						this.plugin.settings.folderPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
