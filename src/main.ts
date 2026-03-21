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
		// Load saved settings or fall back to defaults.
		await this.loadSettings();

		// Resolve UI language for command and ribbon labels.
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
			// Open gallery in the main editor area, not the right sidebar.
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({
				type: GALLERY_VIEW_TYPE,
				active: true,
			});
		}

		workspace.revealLeaf(leaf);
	}

	openSettings() {
		// In some Obsidian type versions `setting` is not declared.
		// Cast to any to keep compatibility and avoid TS errors.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyApp = this.app as any;
		if (anyApp.setting) {
			anyApp.setting.open();
			anyApp.setting.openTabById(this.manifest.id);
		}
	}
}
