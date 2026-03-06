import { Plugin, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	GalleryPluginSettings,
	GallerySettingTab,
} from "./settings";
import { GALLERY_VIEW_TYPE, Cardscape } from "./galleryView";
import { resolveUiLanguage } from "./i18n";

export default class MyPlugin extends Plugin {
	settings: GalleryPluginSettings;

	async onload() {
		// Загружаем настройки плагина (или применяем значения по умолчанию).
		await this.loadSettings();

		// Определяем язык интерфейса для команд и подсказок.
		const lang = resolveUiLanguage(this.app, this.settings.language);

		const ribbonTitle =
			lang === "ru"
				? "Открыть Pinterest‑галерею заметок"
				: "Open Pinterest‑style notes gallery";
		const commandName = ribbonTitle;

		this.registerView(
			GALLERY_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new Cardscape(leaf, this),
		);

		this.addRibbonIcon(
			"layout-grid",
			ribbonTitle,
			() => {
				this.activateGalleryView();
			},
		);

		this.addCommand({
			id: "open-pinterest-gallery",
			name: commandName,
			callback: () => this.activateGalleryView(),
		});

		this.addSettingTab(new GallerySettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace
			.getLeavesOfType(GALLERY_VIEW_TYPE)
			.forEach((leaf) => leaf.detach());
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<GalleryPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateGalleryView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(GALLERY_VIEW_TYPE)[0];
		if (!leaf) {
			// Открываем галерею в основной области (как обычную заметку),
			// а не в правом сайдбаре.
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({
				type: GALLERY_VIEW_TYPE,
				active: true,
			});
		}

		workspace.revealLeaf(leaf);
	}

	openSettings() {
		// В некоторых версиях типов Obsidian поле `setting` может не быть описано,
		// поэтому аккуратно приводим к any, чтобы избежать ошибок TypeScript.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyApp = this.app as any;
		if (anyApp.setting) {
			anyApp.setting.open();
			anyApp.setting.openTabById(this.manifest.id);
		}
	}
}
