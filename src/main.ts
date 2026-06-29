import { Plugin, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	GalleryPluginSettings,
	GallerySettingTab,
} from "./settings";
import { GALLERY_VIEW_TYPE, Cardscape } from "./galleryView";
import { resolveUiLanguage } from "./i18n";
import { CardIndexSynchronizer } from "./gallery/cardIndex";
import { generateAndOpenIndexHealth } from "./gallery/indexHealth";

type AppWithSettings = Plugin["app"] & {
	setting?: {
		open: () => void;
		openTabById: (id: string) => void;
	};
};

export default class CardscapePlugin extends Plugin {
	settings: GalleryPluginSettings;
	private cardIndexSynchronizer: CardIndexSynchronizer | null = null;

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
				void this.activateGalleryView();
			},
		);

		this.addCommand({
			id: "open-pinterest-gallery",
			name: commandName,
			callback: () => {
				void this.activateGalleryView();
			},
		});

		this.cardIndexSynchronizer = new CardIndexSynchronizer(this, () => {
			this.refreshOpenGalleryViews();
		});
		this.cardIndexSynchronizer.start();

		this.addCommand({
			id: "rebuild-cardscape-index",
			name:
				lang === "ru"
					? "Пересобрать индекс Cardscape"
					: "Rebuild Cardscape index",
			callback: () => {
				void this.cardIndexSynchronizer?.rebuildAll();
			},
		});

		this.addCommand({
			id: "open-index-health-report",
			name:
				lang === "ru"
					? "Показать заметки, требующие внимания"
					: "Show notes needing attention",
			callback: () => {
				void generateAndOpenIndexHealth(this);
			},
		});

		this.addSettingTab(new GallerySettingTab(this.app, this));
	}

	onunload() {
		this.cardIndexSynchronizer = null;
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

		await workspace.revealLeaf(leaf);
	}

	openSettings() {
		const appWithSettings = this.app as AppWithSettings;
		if (appWithSettings.setting) {
			appWithSettings.setting.open();
			appWithSettings.setting.openTabById(this.manifest.id);
		}
	}

	private refreshOpenGalleryViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(GALLERY_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof Cardscape) {
				void view.refreshNotes();
			}
		}
	}
}
