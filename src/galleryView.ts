import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type MyPlugin from "./main";
import { resolveUiLanguage, type ResolvedUiLanguage } from "./i18n";
import type { GalleryNoteCard, GallerySortOrder } from "./gallery/types";
import { loadNotesFromFolder, findFirstImageForFile } from "./gallery/notes";
import { collectAvailableTags, getFilteredNotes } from "./gallery/filters";
import { getColumnCountFromWidth } from "./gallery/layout";

export const GALLERY_VIEW_TYPE = "pinterest-cards-gallery-view";

export class Cardscape extends ItemView {
	plugin: MyPlugin;
	gridEl: HTMLElement | null = null;
	sortOrder: GallerySortOrder = "new-first";
	tagFilterContainerEl: HTMLElement | null = null;
	allNotes: GalleryNoteCard[] = [];
	selectedTags: Set<string> = new Set();
	folderInfoButton: HTMLButtonElement | null = null;
	tagsInfoButton: HTMLButtonElement | null = null;
	sortOrderButton: HTMLButtonElement | null = null;
	private allAvailableTags: string[] = [];
	private currentLang: ResolvedUiLanguage = "ru";

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GALLERY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Cardscape";
	}

	getIcon(): string {
		// Built-in icon, can be changed later.
		return "layout-grid";
	}

	async onOpen(): Promise<void> {
		// Resolve UI language when the view opens.
		this.currentLang = resolveUiLanguage(
			this.app,
			this.plugin.settings.language,
		);

		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("pinterest-gallery-view");

		const topbarEl = containerEl.createDiv("pinterest-gallery-topbar");
		const headerEl = topbarEl.createDiv("pinterest-gallery-header");

		const headerLeftEl = headerEl.createDiv(
			"pinterest-gallery-header-left",
		);

		// Refresh button.
		const refreshButton = headerLeftEl.createEl("button", {
			attr: {
				"aria-label":
					this.currentLang === "ru"
						? "Обновить галерею"
						: "Refresh gallery",
			},
		});
		refreshButton.addClass("pinterest-gallery-button");
		const refreshIconSpan = refreshButton.createSpan();
		setIcon(refreshIconSpan, "refresh-ccw");
		refreshButton.onclick = () => {
			void this.refreshNotes();
		};

		// Folder button with note count.
		const folderButton = headerLeftEl.createEl("button", {
			attr: {
				"aria-label":
					this.currentLang === "ru"
						? "Выбранная папка"
						: "Choosen folder",
			},
		});
		folderButton.addClass("pinterest-gallery-button");
		this.folderInfoButton = folderButton;
		folderButton.onclick = () => {
			this.plugin.openSettings();
		};

		// Tags button (icon + count), toggles the tag filter panel.
		const tagsButton = headerLeftEl.createEl("button", {
			attr: {
				"aria-label":
					this.currentLang === "ru"
						? "Фильтры по тегам"
						: "Tag filters",
			},
		});
		tagsButton.addClass("pinterest-gallery-button");
		this.tagsInfoButton = tagsButton;
		tagsButton.onclick = (evt) => {
			evt.preventDefault();
			this.toggleTagPanel();
		};

		const controlsEl = headerEl.createDiv(
			"pinterest-gallery-header-controls",
		);

		// Sort button.
		const sortButton = controlsEl.createEl("button", {
			attr: {
				"aria-label":
					this.currentLang === "ru"
						? "Сортировка заметок"
						: "Sort notes",
			},
		});
		sortButton.addClass("pinterest-gallery-button");
		this.sortOrderButton = sortButton;
		this.renderSortButton();
		sortButton.onclick = (evt) => {
			evt.preventDefault();
			this.sortOrder =
				this.sortOrder === "new-first" ? "old-first" : "new-first";
			this.renderSortButton();
			void this.renderNotes();
		};

		const settingsButton = controlsEl.createEl("button", {
			attr: {
				"aria-label":
					this.currentLang === "ru"
						? "Настройки галереи"
						: "Gallery settings",
			},
		});
		settingsButton.addClass("pinterest-gallery-button");
		const settingsIconSpan = settingsButton.createSpan();
		setIcon(settingsIconSpan, "settings");
		settingsButton.onclick = () => {
			// Open plugin settings tab.
			this.plugin.openSettings();
		};

		this.tagFilterContainerEl =
			topbarEl.createDiv("pinterest-gallery-tags");
		this.tagFilterContainerEl.addClass("is-collapsed");

		this.gridEl = containerEl.createDiv("pinterest-gallery-grid");

		await this.refreshNotes();
	}

	renderNotes(): void {
		if (!this.gridEl) return;

		this.gridEl.empty();

		const notes = this.getFilteredNotes();

		if (!notes.length) {
			const emptyEl = this.gridEl.createDiv("pinterest-gallery-empty");
			emptyEl.setText(
				this.currentLang === "ru"
					? "В выбранной папке нет заметок. Выберите другую папку в настройках плагина."
					: "There are no notes in the selected folder. Choose another folder in the plugin settings.",
			);
			return;
		}

		const columnsWrap = this.gridEl.createDiv("pinterest-gallery-columns");

		const columnCount = this.getColumnCount();
		const columns: HTMLElement[] = [];
		for (let i = 0; i < columnCount; i++) {
			const col = columnsWrap.createDiv("pinterest-gallery-column");
			columns.push(col);
		}

		notes.forEach((note, index) => {
			const column = columns[index % columnCount];
			if (!column) return;
			const cardEl = column.createDiv("pinterest-gallery-card");

			// First embedded image from the note, if any.
			const imageFile = findFirstImageForFile(this.app, note.file);
			if (imageFile) {
				const imageWrapper = cardEl.createDiv(
					"pinterest-gallery-card-image",
				);
				const imgEl = imageWrapper.createEl("img");
				imgEl.src = this.app.vault.getResourcePath(imageFile);
				imgEl.alt = note.title;
				imgEl.loading = "lazy";
			}

			// Card title.
			const titleEl = cardEl.createDiv("pinterest-gallery-card-title");
			titleEl.setText(note.title);

			// Card snippet.
			const snippetEl = cardEl.createDiv(
				"pinterest-gallery-card-snippet",
			);
			snippetEl.setText(note.snippet);

			// Card tags.
			if (note.tags.length) {
				const tagsRow = cardEl.createDiv(
					"pinterest-gallery-card-tags",
				);
				for (const tag of note.tags) {
					const tagEl = tagsRow.createSpan(
						"pinterest-gallery-card-tag",
					);
					tagEl.setText(`#${tag}`);
				}
			}

			// Creation time (optional, kept for future use).
			/* const dateEl = cardEl.createDiv("pinterest-gallery-card-date");
			const created = window.moment(note.created);
			dateEl.setText(created.format("YYYY-MM-DD HH:mm:ss")); */

			cardEl.onclick = () => {
				void this.openNote(note.file);
			};
		});

		this.renderFooter(notes.length);
	}


	private renderFooter(visibleCount: number): void {
		if (!this.gridEl) return;

		const footerEl = this.gridEl.createDiv("pinterest-gallery-footer");
		const footerInner = footerEl.createDiv("pinterest-gallery-footer-inner");

		const folderPathRaw = this.plugin.settings.folderPath?.trim() ?? "";
		const folderPath = folderPathRaw
			? folderPathRaw.replace(/\/+$/, "")
			: "/";

		if (this.currentLang === "ru") {
			const noteWord = this.getRuPlural(visibleCount, [
				"заметку",
				"заметки",
				"заметок",
			]);

			footerInner.setText(
				`Вы посмотрели все ваши ${visibleCount} ${noteWord} из папки "${folderPath}"`,
			);
		} else {
			const noteWord = visibleCount === 1 ? "note" : "notes";
			const baseFolder =
				folderPath === "/" ? "your vault" : `the "${folderPath}" folder`;
			footerInner.setText(
				`You’ve reached the end of your ${visibleCount} ${noteWord} from ${baseFolder}.`,
			);
		}
	}

	// Russian plural forms: 1 note, 2-4 notes, 5+ notes.
	private getRuPlural(n: number, forms: [string, string, string]): string {
		const abs = Math.abs(n) % 100;
		const last = abs % 10;
		if (abs > 10 && abs < 20) return forms[2];
		if (last > 1 && last < 5) return forms[1];
		if (last === 1) return forms[0];
		return forms[2];
	}

	private async openNote(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	private getColumnCount(): number {
		const width =
			this.gridEl?.clientWidth ??
			this.containerEl?.clientWidth ??
			window.innerWidth;

		if (width < 700) return 1;
		if (width < 1024) return 3;
		return getColumnCountFromWidth(width);
	}

	private async refreshNotes(): Promise<void> {
		this.allNotes = await loadNotesFromFolder(
			this.app,
			this.plugin.settings,
			this.currentLang,
		);
		this.renderTagFilters();
		this.updateFolderInfo();
		this.updateTagsInfo();
		this.renderNotes();
	}

	private updateFolderInfo(): void {
		if (!this.folderInfoButton) return;

		const folderPath = this.plugin.settings.folderPath?.trim() ?? "";
		const count = this.allNotes.length;

		let folderLabel =
			this.currentLang === "ru" ? "Все хранилище" : "Whole vault";
		if (folderPath) {
			const trimmed = folderPath.replace(/\/+$/, "");
			const parts = trimmed.split("/");
			folderLabel = `${parts[parts.length - 1]}`;
		}

		this.folderInfoButton.empty();

		const wrapper = this.folderInfoButton.createDiv(
			"pinterest-gallery-folder-button",
		);

		const folderBlock = wrapper.createDiv(
			"pinterest-gallery-folder-button-part",
		);
		const folderIconSpan = folderBlock.createSpan();
		setIcon(folderIconSpan, "folder");
		const folderTextSpan = folderBlock.createSpan();
		folderTextSpan.setText(` ${folderLabel}`);

		const dotSpan = wrapper.createSpan(
			"pinterest-gallery-folder-button-separator",
		);
		dotSpan.setText("·");

		const countBlock = wrapper.createDiv(
			"pinterest-gallery-folder-button-part",
		);
		const noteIconSpan = countBlock.createSpan();
		setIcon(noteIconSpan, "file-text");
		const noteTextSpan = countBlock.createSpan();
		if (this.currentLang === "ru") {
			noteTextSpan.setText(` ${count} заметок`);
		} else {
			const word = count === 1 ? "note" : "notes";
			noteTextSpan.setText(` ${count} ${word}`);
		}
	}

	private updateTagsInfo(): void {
		if (!this.tagsInfoButton) return;

		const selectedCount = this.selectedTags.size;
		const totalCount = this.allAvailableTags.length;

		this.tagsInfoButton.empty();

		const wrapper = this.tagsInfoButton.createDiv(
			"pinterest-gallery-folder-button",
		);

		const tagBlock = wrapper.createDiv(
			"pinterest-gallery-folder-button-part",
		);
		const tagIconSpan = tagBlock.createSpan();
		setIcon(tagIconSpan, "tag");
		const tagTextSpan = tagBlock.createSpan();
		if (this.currentLang === "ru") {
			const tagWord = this.getRuPlural(totalCount, [
				"тег",
				"тега",
				"тегов",
			]);
			tagTextSpan.setText(` ${totalCount} ${tagWord}`);
		} else {
			const tagWord = totalCount === 1 ? "tag" : "tags";
			tagTextSpan.setText(` ${totalCount} ${tagWord}`);
		}

		if (selectedCount > 0) {
			const dotSpan = wrapper.createSpan(
				"pinterest-gallery-folder-button-separator",
			);
			dotSpan.setText("·");

			const selectedBlock = wrapper.createDiv(
				"pinterest-gallery-folder-button-part",
			);
			const selectedIconSpan = selectedBlock.createSpan();
			setIcon(selectedIconSpan, "check");
			const selectedTextSpan = selectedBlock.createSpan();
			if (this.currentLang === "ru") {
				const selectedWord = this.getRuPlural(selectedCount, [
					"выбран",
					"выбрано",
					"выбрано",
				]);
				selectedTextSpan.setText(` ${selectedCount} ${selectedWord}`);
			} else {
				const word = selectedCount === 1 ? "selected" : "selected";
				selectedTextSpan.setText(` ${selectedCount} ${word}`);
			}
			this.tagsInfoButton.addClass("is-active");
		} else {
			this.tagsInfoButton.removeClass("is-active");
		}

		// If no tags are available, dim the button.
		this.tagsInfoButton.toggleClass("is-disabled", totalCount === 0);
	}

	private toggleTagPanel(): void {
		if (!this.tagFilterContainerEl) return;

		const isCollapsed = this.tagFilterContainerEl.hasClass("is-collapsed");
		this.tagFilterContainerEl.toggleClass("is-collapsed", !isCollapsed);
	}

	private renderSortButton(): void {
		if (!this.sortOrderButton) return;

		this.sortOrderButton.empty();

		const wrap = this.sortOrderButton.createDiv(
			"pinterest-gallery-sort-button",
		);

		const icon = wrap.createSpan("pinterest-gallery-sort-icon");
		setIcon(icon, "arrow-up-down");

		const text = wrap.createSpan("pinterest-gallery-sort-text");
		if (this.currentLang === "ru") {
			text.setText(
				this.sortOrder === "new-first"
					? "Сначала новые"
					: "Сначала старые",
			);
		} else {
			text.setText(
				this.sortOrder === "new-first"
					? "Newest first"
					: "Oldest first",
			);
		}
	}

	private getFilteredNotes(): GalleryNoteCard[] {
		return getFilteredNotes(this.allNotes, this.selectedTags, this.sortOrder);
	}

	private renderTagFilters(): void {
		if (!this.tagFilterContainerEl) return;

		this.tagFilterContainerEl.empty();

		const allTags = collectAvailableTags(this.allNotes);
		this.allAvailableTags = allTags;
		this.updateTagsInfo();

		if (!allTags.length) {
			this.tagFilterContainerEl.addClass("is-collapsed");
			const emptyEl = this.tagFilterContainerEl.createDiv(
				"pinterest-gallery-tags-empty",
			);
			emptyEl.setText(
				this.currentLang === "ru"
					? "Теги пока не найдены."
					: "No tags were found yet.",
			);
			return;
		}

		const tagsRow = this.tagFilterContainerEl.createDiv(
			"pinterest-gallery-tags-row",
		);

		for (const tag of allTags) {
			const chip = tagsRow.createEl("button", {
				text: `#${tag}`,
			});
			chip.addClass("pinterest-gallery-tag-chip");
			if (this.selectedTags.has(tag)) {
				chip.addClass("is-selected");
			}

			chip.onclick = (evt) => {
				evt.preventDefault();
				if (this.selectedTags.has(tag)) {
					this.selectedTags.delete(tag);
					chip.removeClass("is-selected");
				} else {
					this.selectedTags.add(tag);
					chip.addClass("is-selected");
				}

				this.updateTagsInfo();
				void this.renderNotes();
			};
		}
	}

	onClose(): Promise<void> {
		this.gridEl = null;
		this.tagFilterContainerEl = null;
		this.allNotes = [];
		this.selectedTags.clear();
		this.folderInfoButton = null;
		this.tagsInfoButton = null;
		this.sortOrderButton = null;
		this.allAvailableTags = [];
		return Promise.resolve();
	}
}


