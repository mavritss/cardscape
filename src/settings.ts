import { App, PluginSettingTab, Setting } from "obsidian";
import type MyPlugin from "./main";

export interface GalleryPluginSettings {
	folderPath: string;
	maxNotes: number;
}

export const DEFAULT_SETTINGS: GalleryPluginSettings = {
	folderPath: "",
	maxNotes: 600,
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

		new Setting(containerEl)
			.setName("Максимум заметок в галерее")
			.setDesc(
				"Сколько последних заметок загружать для галереи. Увеличивайте осторожно, большие значения могут замедлить работу (особенно с картинками).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Например: 600")
					.setValue(String(this.plugin.settings.maxNotes ?? 600))
					.onChange(async (value) => {
						const parsed = Number(value);
						const safe = Number.isFinite(parsed)
							? Math.min(Math.max(Math.round(parsed), 50), 3000)
							: 600;
						this.plugin.settings.maxNotes = safe;
						text.setValue(String(safe));
						await this.plugin.saveSettings();
					}),
			);
	}
}
