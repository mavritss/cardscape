import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type MyPlugin from "./main";
import { resolveUiLanguage, type ResolvedUiLanguage } from "./i18n";
import type { GalleryNoteCard, GallerySortOrder } from "./gallery/types";
import { loadNotesFromFolder, findPreviewImageForCard } from "./gallery/notes";
import {
	collectAvailableTags,
	collectTagGroups,
	getFilteredNotes,
} from "./gallery/filters";
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
	private visibleNotes: GalleryNoteCard[] = [];
	private columns: HTMLElement[] = [];
	private columnHeights: number[] = [];
	private renderedCount = 0;
	private currentColumnCount = 0;
	private footerEl: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimer: number | null = null;
	private readonly pageSize = 48;
	private readonly scrollLoadOffset = 900;
	private onGridScroll = (): void => {
		this.loadMoreIfNeeded();
	};

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
		this.gridEl.addEventListener("scroll", this.onGridScroll);
		this.resizeObserver = new ResizeObserver(() => {
			this.handleGridResize();
		});
		this.resizeObserver.observe(this.gridEl);

		await this.refreshNotes();
	}

	renderNotes(initialCount = this.pageSize): void {
		if (!this.gridEl) return;

		this.gridEl.empty();
		this.columns = [];
		this.columnHeights = [];
		this.renderedCount = 0;
		this.footerEl = null;

		const notes = this.getFilteredNotes();
		this.visibleNotes = notes;

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
		this.currentColumnCount = columnCount;
		for (let i = 0; i < columnCount; i++) {
			const col = columnsWrap.createDiv("pinterest-gallery-column");
			this.columns.push(col);
			this.columnHeights.push(0);
		}

		this.appendNotesUntil(Math.min(notes.length, initialCount));
		this.fillViewportIfNeeded();
	}

	private appendNotesUntil(targetCount: number): void {
		if (!this.gridEl || !this.columns.length) return;

		const maxCount = Math.min(targetCount, this.visibleNotes.length);
		while (this.renderedCount < maxCount) {
			const note = this.visibleNotes[this.renderedCount];
			if (!note) break;

			const columnIndex = this.getShortestColumnIndex();
			const column = this.columns[columnIndex];
			if (!column) break;

			this.renderCard(note, column);
			this.columnHeights[columnIndex] =
				(this.columnHeights[columnIndex] ?? 0) +
				this.estimateCardHeight(note);
			this.renderedCount += 1;
		}

		this.updateFooter();
	}

	private renderCard(note: GalleryNoteCard, column: HTMLElement): void {
		const cardEl = column.createDiv("pinterest-gallery-card");

		const imageFile = findPreviewImageForCard(this.app, note);
		if (imageFile) {
			const imageWrapper = cardEl.createDiv(
				"pinterest-gallery-card-image",
			);
			const imgEl = imageWrapper.createEl("img");
			imgEl.src = this.app.vault.getResourcePath(imageFile);
			imgEl.alt = note.title;
			imgEl.loading = "lazy";
		}

		const titleEl = cardEl.createDiv("pinterest-gallery-card-title");
		titleEl.setText(note.title);

		const snippetEl = cardEl.createDiv("pinterest-gallery-card-snippet");
		snippetEl.setText(note.snippet);

		if (note.tags.length) {
			const tagsRow = cardEl.createDiv("pinterest-gallery-card-tags");
			for (const tag of groupCardTags(note.tags)) {
				const tagEl = tagsRow.createSpan(
					"pinterest-gallery-card-tag",
				);
				if (tag.children.length) {
					tagEl.setText(`#${tag.root}: ${tag.children.join(", ")}`);
				} else {
					tagEl.setText(`#${tag.root}`);
				}
			}
		}

		cardEl.onclick = () => {
			void this.openNote(note.file);
		};
	}

	private estimateCardHeight(note: GalleryNoteCard): number {
		const titleLines = Math.ceil(note.title.length / 24);
		const snippetLines = Math.ceil(note.snippet.length / 42);
		const tagRows = Math.ceil(Math.max(note.tags.length, 1) / 3);
		const imageHeight = note.previewImagePath ? 280 : 0;
		return 110 + titleLines * 24 + snippetLines * 19 + tagRows * 28 + imageHeight;
	}

	private getShortestColumnIndex(): number {
		let shortestIndex = 0;
		let shortestHeight = Number.POSITIVE_INFINITY;
		for (let i = 0; i < this.columnHeights.length; i++) {
			const height = this.columnHeights[i] ?? 0;
			if (height < shortestHeight) {
				shortestHeight = height;
				shortestIndex = i;
			}
		}
		return shortestIndex;
	}

	private loadMoreIfNeeded(): void {
		if (!this.gridEl) return;
		if (this.renderedCount >= this.visibleNotes.length) return;

		const distanceToBottom =
			this.gridEl.scrollHeight -
			this.gridEl.scrollTop -
			this.gridEl.clientHeight;
		if (distanceToBottom <= this.scrollLoadOffset) {
			this.appendNotesUntil(this.renderedCount + this.pageSize);
			this.fillViewportIfNeeded();
		}
	}

	private fillViewportIfNeeded(): void {
		if (!this.gridEl) return;

		let guard = 0;
		while (
			this.renderedCount < this.visibleNotes.length &&
			this.gridEl.scrollHeight <= this.gridEl.clientHeight + 200 &&
			guard < 6
		) {
			this.appendNotesUntil(this.renderedCount + this.pageSize);
			guard += 1;
		}
	}

	private updateFooter(): void {
		if (!this.gridEl) return;

		if (this.footerEl) {
			this.footerEl.remove();
			this.footerEl = null;
		}

		if (this.renderedCount >= this.visibleNotes.length) {
			this.renderFooter(this.visibleNotes.length);
		}
	}


	private renderFooter(visibleCount: number): void {
		if (!this.gridEl) return;

		const footerEl = this.gridEl.createDiv("pinterest-gallery-footer");
		this.footerEl = footerEl;
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

		return getColumnCountFromWidth(width);
	}

	private handleGridResize(): void {
		if (!this.gridEl) return;
		if (this.resizeTimer !== null) {
			window.clearTimeout(this.resizeTimer);
		}

		this.resizeTimer = window.setTimeout(() => {
			this.resizeTimer = null;
			const nextColumnCount = this.getColumnCount();
			if (nextColumnCount === this.currentColumnCount) return;

			const targetCount = Math.max(this.renderedCount, this.pageSize);
			const previousScrollTop = this.gridEl?.scrollTop ?? 0;
			this.renderNotes(targetCount);
			if (this.gridEl) {
				this.gridEl.scrollTop = Math.min(
					previousScrollTop,
					this.gridEl.scrollHeight,
				);
			}
		}, 120);
	}

	async refreshNotes(): Promise<void> {
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
		const tagGroups = collectTagGroups(this.allNotes);
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

		const selectedRootTags = tagGroups.filter((group) =>
			this.selectedTags.has(group.tag),
		);

		const tagsRow = this.tagFilterContainerEl.createDiv(
			"pinterest-gallery-tags-row",
		);

		for (const group of tagGroups) {
			const tag = group.tag;
			const chip = tagsRow.createEl("button");
			chip.addClass("pinterest-gallery-tag-chip");
			chip.addClass("is-root-tag");
			chip.createSpan("pinterest-gallery-tag-chip-label").setText(
				`#${tag}`,
			);
			if (group.children.length) {
				chip.createSpan("pinterest-gallery-tag-child-count").setText(
					String(group.children.length),
				);
			}
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
				this.renderTagFilters();
				void this.renderNotes();
			};
		}

		for (const group of selectedRootTags) {
			if (!group.children.length) continue;

			const childBlock = this.tagFilterContainerEl.createDiv(
				"pinterest-gallery-tag-children-block",
			);

			const childTitle = childBlock.createDiv(
				"pinterest-gallery-tag-children-title",
			);
			childTitle.setText(`#${group.tag}`);

			const childRow = childBlock.createDiv(
				"pinterest-gallery-tags-row",
			);

			for (const childTag of group.children) {
				const childLabel = childTag.slice(group.tag.length + 1);
				const childChip = childRow.createEl("button", {
					text: `#${childLabel}`,
				});
				childChip.addClass("pinterest-gallery-tag-chip");
				childChip.addClass("is-child-tag");
				if (this.selectedTags.has(childTag)) {
					childChip.addClass("is-selected");
				}

				childChip.onclick = (evt) => {
					evt.preventDefault();
					if (this.selectedTags.has(childTag)) {
						this.selectedTags.delete(childTag);
						childChip.removeClass("is-selected");
					} else {
						this.selectedTags.add(childTag);
						childChip.addClass("is-selected");
					}

					this.updateTagsInfo();
					void this.renderNotes();
				};
			}
		}
	}

	onClose(): Promise<void> {
		if (this.gridEl) {
			this.gridEl.removeEventListener("scroll", this.onGridScroll);
		}
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.resizeTimer !== null) {
			window.clearTimeout(this.resizeTimer);
			this.resizeTimer = null;
		}
		this.gridEl = null;
		this.tagFilterContainerEl = null;
		this.allNotes = [];
		this.visibleNotes = [];
		this.columns = [];
		this.columnHeights = [];
		this.renderedCount = 0;
		this.currentColumnCount = 0;
		this.footerEl = null;
		this.selectedTags.clear();
		this.folderInfoButton = null;
		this.tagsInfoButton = null;
		this.sortOrderButton = null;
		this.allAvailableTags = [];
		return Promise.resolve();
	}
}

function groupCardTags(
	tags: string[],
): Array<{ root: string; children: string[] }> {
	const groups = new Map<string, Set<string>>();

	for (const tag of tags) {
		const [root, ...rest] = tag.split("/");
		if (!root) continue;
		if (!groups.has(root)) {
			groups.set(root, new Set<string>());
		}
		if (rest.length) {
			groups.get(root)?.add(rest.join("/"));
		}
	}

	return Array.from(groups.entries())
		.map(([root, children]) => ({
			root,
			children: Array.from(children).sort((a, b) =>
				a.localeCompare(b, "ru"),
			),
		}))
		.sort((a, b) => a.root.localeCompare(b.root, "ru"));
}


