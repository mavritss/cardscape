import { App, PluginSettingTab, Setting } from "obsidian";
import type MyPlugin from "./main";
import { resolveUiLanguage, type ResolvedUiLanguage, type UiLanguage } from "./i18n";

export interface GalleryPluginSettings {
	folderPath: string;
	maxNotes: number;
	useCardIndex: boolean;
	cardIndexPath: string;
	/**
	 * Preferred plugin UI language.
	 * Saved in settings and used for labels/tooltips.
	 */
	language: UiLanguage;
}

export const DEFAULT_SETTINGS: GalleryPluginSettings = {
	folderPath: "",
	maxNotes: 600,
	useCardIndex: true,
	cardIndexPath: ".ai/cardscape-index.json",
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

		new Setting(containerEl)
			.setName(lang === "ru" ? "Основные настройки" : "General settings")
			.setHeading();

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

		new Setting(containerEl)
			.setName(
				lang === "ru"
					? "Использовать индекс карточек"
					: "Use card index",
			)
			.setDesc(
				lang === "ru"
					? "Если включено, галерея сначала читает быстрый индекс карточек. Если индекс не найден, используется обычное чтение заметок."
					: "When enabled, the gallery reads the fast card index first. If the index is missing, it falls back to reading notes.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useCardIndex ?? true)
					.onChange(async (value) => {
						this.plugin.settings.useCardIndex = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(
				lang === "ru" ? "Путь к индексу карточек" : "Card index path",
			)
			.setDesc(
				lang === "ru"
					? 'Путь внутри vault, например ".ai/cardscape-index.json".'
					: 'Path inside the vault, for example ".ai/cardscape-index.json".',
			)
			.addText((text) =>
				text
					.setPlaceholder(".ai/cardscape-index.json")
					.setValue(
						this.plugin.settings.cardIndexPath ??
							".ai/cardscape-index.json",
					)
					.onChange(async (value) => {
						this.plugin.settings.cardIndexPath =
							value.trim() || ".ai/cardscape-index.json";
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
	private getCurrentLanguage(): ResolvedUiLanguage {
		return resolveUiLanguage(this.app, this.plugin.settings.language);
	}
}
