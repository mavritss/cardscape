import { App, PluginSettingTab, Setting } from "obsidian";
import type MyPlugin from "./main";
import type { UiLanguage } from "./i18n";

export interface GalleryPluginSettings {
	folderPath: string;
	maxNotes: number;
	/**
	 * Preferred plugin UI language.
	 * Saved in settings and used for labels/tooltips.
	 */
	language: UiLanguage;
}

export const DEFAULT_SETTINGS: GalleryPluginSettings = {
	folderPath: "",
	maxNotes: 600,
	language: "auto",
};

export class GallerySettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		// Resolve current UI language for settings labels.
		// When language is "auto", use Obsidian locale.
		const lang = this.getCurrentLanguage();

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Cardscape",
		});

		// Setting: target folder for notes.
		new Setting(containerEl)
			.setName(
				lang === "ru" ? "Папка с заметками" : "Notes folder",
			)
			.setDesc(
				lang === "ru"
					? 'Путь к папке внутри хранилища Obsidian, например "Notes/Projects". Оставьте пустым, чтобы использовать весь vault.'
					: 'Path to a folder inside the Obsidian vault, for example "Notes/Projects". Leave empty to use the whole vault.',
			)
			.addText((text) =>
				text
					.setPlaceholder(
						lang === "ru"
							? "Например: Notes/Projects"
							: "For example: Notes/Projects",
					)
					.setValue(this.plugin.settings.folderPath)
					.onChange(async (value) => {
						this.plugin.settings.folderPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// Setting: note count limit.
		new Setting(containerEl)
			.setName(
				lang === "ru"
					? "Максимум заметок в галерее"
					: "Maximum notes in gallery",
			)
			.setDesc(
				lang === "ru"
					? "Сколько последних заметок загружать для галереи. Увеличивайте осторожно: большие значения могут замедлить работу (особенно с картинками)."
					: "How many recent notes to load into the gallery. Increase carefully: large values can slow things down (especially with images).",
			)
			.addText((text) =>
				text
					.setPlaceholder(
						lang === "ru" ? "Например: 600" : "For example: 600",
					)
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

		// Setting: plugin UI language.
		const languageSetting = new Setting(containerEl).setName(
			lang === "ru" ? "Язык интерфейса" : "Interface language",
		);

		languageSetting.setDesc(
			lang === "ru"
				? "Автоматически подстраивайтесь под язык Obsidian или выберите русский / английский принудительно."
				: "Automatically follow the Obsidian language or force Russian/English explicitly.",
		);

		languageSetting.addDropdown((dropdown) => {
			dropdown
				.addOption(
					"auto",
					lang === "ru" ? "Авто (как в Obsidian)" : "Auto (match Obsidian)",
				)
				.addOption("ru", "Русский")
				.addOption("en", "English")
				.setValue(this.plugin.settings.language ?? "auto")
				.onChange(async (value) => {
					this.plugin.settings.language = value as UiLanguage;
					await this.plugin.saveSettings();

					// Re-render tab to apply language change immediately.
					this.display();
				});
		});
	}

	/**
	 * Helper: returns the effective UI language for settings screen.
	 */
	private getCurrentLanguage() {
		// Lazy import to avoid unnecessary dependencies in this module.
		const { resolveUiLanguage } = require("./i18n") as typeof import("./i18n");
		return resolveUiLanguage(this.app, this.plugin.settings.language);
	}
}
