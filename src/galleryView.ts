import {
	ItemView,
	TFile,
	TFolder,
	WorkspaceLeaf,
	Notice,
	setIcon,
} from "obsidian";
import type MyPlugin from "./main";
import { resolveUiLanguage, type ResolvedUiLanguage } from "./i18n";

export const GALLERY_VIEW_TYPE = "pinterest-cards-gallery-view";

interface GalleryNoteCard {
	file: TFile;
	title: string;
	snippet: string;
	tags: string[];
	created: number;
}

export class Cardscape extends ItemView {
	plugin: MyPlugin;
	gridEl: HTMLElement | null = null;
	sortOrder: "new-first" | "old-first" = "new-first";
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
		return "Pinterest cards gallery";
	}

	getIcon(): string {
		// Built‑in icon, can be changed later
		return "layout-grid";
	}

	async onOpen(): Promise<void> {
		// На открытии вида фиксируем язык интерфейса.
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

		// Кнопка обновления
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

		// Кнопка с папкой и количеством заметок
		const folderButton = headerLeftEl.createEl("button");
		folderButton.addClass("pinterest-gallery-button");
		this.folderInfoButton = folderButton;
		folderButton.onclick = () => {
			this.plugin.openSettings();
		};

		// Кнопка с тегами (иконка + N тегов), открывает/скрывает панель фильтров ниже
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

		// Кнопка сортировки (вместо старой кнопки "Показать/Скрыть фильтры")
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
			// Открыть вкладку настроек плагина
			this.plugin.openSettings();
		};

		this.tagFilterContainerEl =
			topbarEl.createDiv("pinterest-gallery-tags");
		this.tagFilterContainerEl.addClass("is-collapsed");

		this.gridEl = containerEl.createDiv("pinterest-gallery-grid");

		await this.refreshNotes();
	}

	async renderNotes(): Promise<void> {
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

			// Картинка из первой вложенной картинки заметки (если есть)
			const imageFile = this.findFirstImageForFile(note.file);
			if (imageFile) {
				const imageWrapper = cardEl.createDiv(
					"pinterest-gallery-card-image",
				);
				const imgEl = imageWrapper.createEl("img");
				imgEl.src = this.app.vault.getResourcePath(imageFile);
				imgEl.alt = note.title;
				imgEl.loading = "lazy";
			}

			// Заголовок карточки
			const titleEl = cardEl.createDiv("pinterest-gallery-card-title");
			titleEl.setText(note.title);

			// Описание карточки
			const snippetEl = cardEl.createDiv(
				"pinterest-gallery-card-snippet",
			);
			snippetEl.setText(note.snippet);

			// Теги карточки
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

			// Время создания
			/* const dateEl = cardEl.createDiv("pinterest-gallery-card-date");
			const created = window.moment(note.created);
			dateEl.setText(created.format("YYYY-MM-DD HH:mm:ss")); */

			cardEl.onclick = () => {
				void this.openNote(note.file);
			};
		});

		this.renderFooter(notes.length);
	}

	private async loadNotesFromFolder(): Promise<GalleryNoteCard[]> {
		const vault = this.app.vault;
		const folderPath = this.plugin.settings.folderPath?.trim();

		let root: TFolder | null = null;
		if (folderPath) {
			const maybeFolder = vault.getAbstractFileByPath(folderPath);
			if (!maybeFolder) {
				new Notice(
					this.currentLang === "ru"
						? `Папка "${folderPath}" не найдена.`
						: `Folder "${folderPath}" was not found.`,
				);
				return [];
			}
			if (!(maybeFolder instanceof TFolder)) {
				new Notice(
					this.currentLang === "ru"
						? `"${folderPath}" — это не папка.`
						: `"${folderPath}" is not a folder.`,
				);
				return [];
			}
			root = maybeFolder;
		} else {
			root = vault.getRoot();
		}

		const files: TFile[] = [];
		this.collectMarkdownFiles(root, files);

		// При очень больших хранилищах ограничиваемся наиболее свежими заметками,
		// чтобы не блокировать интерфейс. Значение задаётся в настройках плагина.
		const MAX_NOTES = this.plugin.settings.maxNotes ?? 600;
		const sortedFiles = files
			.slice()
			.sort((a, b) => {
				const aTime =
					typeof a.stat.ctime === "number"
						? a.stat.ctime
						: a.stat.mtime;
				const bTime =
					typeof b.stat.ctime === "number"
						? b.stat.ctime
						: b.stat.mtime;
				return bTime - aTime;
			})
			.slice(0, MAX_NOTES);

		const cards: GalleryNoteCard[] = [];
		for (const file of sortedFiles) {
			const content = await vault.cachedRead(file);
			const { title, snippet } = this.extractTitleAndSnippet(
				file,
				content,
			);
			const tags = this.extractTags(file);
			const created =
				typeof file.stat.ctime === "number"
					? file.stat.ctime
					: file.stat.mtime;
			cards.push({ file, title, snippet, tags, created });
		}

		// Можно сортировать по имени или по дате — пока оставим как есть
		return cards;
	}

	private collectMarkdownFiles(folder: TFolder, result: TFile[]): void {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				this.collectMarkdownFiles(child, result);
			} else if (child instanceof TFile) {
				if (child.extension === "md") {
					result.push(child);
				}
			}
		}
	}

	private extractTitleAndSnippet(
		file: TFile,
		content: string,
	): { title: string; snippet: string } {
		const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
		const firstContentLineIdx = this.findContentStartLineIndex(lines);

		let title = file.basename;
		for (let i = firstContentLineIdx; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const trimmed = line.trim();
			if (trimmed.startsWith("# ")) {
				title = trimmed.replace(/^#\s+/, "").trim();
				break;
			}
		}

		let snippet = "";
		for (let i = firstContentLineIdx; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const trimmed = line.trim();
			if (!trimmed) continue;
			if (trimmed.startsWith("#")) continue;
			// Пропускаем строки, состоящие только из картинок/встроенных файлов,
			// чтобы не показывать markdown‑синтаксис вроде ![[image.png]].
			if (trimmed.startsWith("![[") || trimmed.startsWith("![")) continue;
			// Пропускаем разделители properties/frontmatter, чтобы в snippet не попадало '---'.
			if (trimmed === "---") continue;
			snippet = trimmed;
			break;
		}

		if (!snippet) {
			snippet =
				this.currentLang === "ru"
					? "Пустая заметка"
					: "Empty note";
		} else if (snippet.length > 280) {
			snippet = snippet.slice(0, 277) + "...";
		}

		if (title.length > 80) {
			title = title.slice(0, 77) + "...";
		}

		return { title, snippet };
	}

	/**
	 * Если заметка начинается с блока properties/frontmatter (YAML между --- ... ---),
	 * возвращает индекс первой строки после этого блока. Иначе возвращает 0.
	 */
	private findContentStartLineIndex(lines: string[]): number {
		// Пропускаем пустые строки в начале
		let i = 0;
		while (i < lines.length && !lines[i]?.trim()) i++;

		if ((lines[i] ?? "").trim() !== "---") return 0;

		// Ищем закрывающий '---'
		for (let j = i + 1; j < lines.length; j++) {
			if ((lines[j] ?? "").trim() === "---") {
				return j + 1;
			}
		}

		// Если закрывающего разделителя нет — не считаем это frontmatter.
		return 0;
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

	// Русская форма слова по числу: 1 заметку, 2‑4 заметки, 5+ заметок
	private getRuPlural(n: number, forms: [string, string, string]): string {
		const abs = Math.abs(n) % 100;
		const last = abs % 10;
		if (abs > 10 && abs < 20) return forms[2];
		if (last > 1 && last < 5) return forms[1];
		if (last === 1) return forms[0];
		return forms[2];
	}

	private extractTags(file: TFile): string[] {
		const { metadataCache } = this.app;
		const cache = metadataCache.getFileCache(file);

		const tagSet = new Set<string>();

		// Теги из body (#tag)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bodyTags: any[] | undefined = cache?.tags;
		if (bodyTags) {
			for (const t of bodyTags) {
				const raw = typeof t.tag === "string" ? t.tag : "";
				if (!raw) continue;
				const norm = raw.replace(/^#/, "").trim().toLowerCase();
				if (norm) tagSet.add(norm);
			}
		}

		// Теги из frontmatter (tags: tag | [tag1, tag2])
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const fm: any | undefined = cache?.frontmatter;
		if (fm && fm.tags) {
			const fmTags = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
			for (const rawTag of fmTags) {
				if (typeof rawTag !== "string") continue;
				const norm = rawTag.replace(/^#/, "").trim().toLowerCase();
				if (norm) tagSet.add(norm);
			}
		}

		return Array.from(tagSet).sort();
	}

	private async openNote(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	private findFirstImageForFile(noteFile: TFile): TFile | null {
		const { metadataCache } = this.app;
		const cache = metadataCache.getFileCache(noteFile);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const embeds: any[] | undefined = cache?.embeds;
		if (!embeds || !embeds.length) return null;

		const imageExtensions = new Set([
			"png",
			"jpg",
			"jpeg",
			"gif",
			"webp",
			"bmp",
			"svg",
		]);

		for (const embed of embeds) {
			const link: string | undefined = embed.link;
			if (!link) continue;
			const target = metadataCache.getFirstLinkpathDest(
				link,
				noteFile.path,
			);
			if (
				target instanceof TFile &&
				imageExtensions.has(target.extension.toLowerCase())
			) {
				return target;
			}
		}

		return null;
	}

	private getColumnCount(): number {
		const width =
			this.gridEl?.clientWidth ??
			this.containerEl?.clientWidth ??
			window.innerWidth;

		if (width < 700) return 1;
		if (width < 1024) return 3;
		// на больших экранах держим 6 колонок, чтобы сохранить текущий визуальный стиль
		return 6;
	}

	private async refreshNotes(): Promise<void> {
		this.allNotes = await this.loadNotesFromFolder();
		this.renderTagFilters();
		this.updateFolderInfo();
		this.updateTagsInfo();
		await this.renderNotes();
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

		// Если тегов нет — визуально делаем кнопку "приглушённой"
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
		let notes: GalleryNoteCard[];

		if (!this.selectedTags.size) {
			notes = [...this.allNotes];
		} else {
			const required = Array.from(this.selectedTags);
			notes = this.allNotes.filter((note) =>
				required.every((tag) => note.tags.includes(tag)),
			);
		}

		notes.sort((a, b) => {
			if (this.sortOrder === "new-first") {
				return b.created - a.created;
			}
			// old-first
			return a.created - b.created;
		});

		return notes;
	}

	private renderTagFilters(): void {
		if (!this.tagFilterContainerEl) return;

		this.tagFilterContainerEl.empty();

		// Собираем множество всех тегов по всем заметкам
		const tagSet = new Set<string>();
		for (const note of this.allNotes) {
			for (const tag of note.tags) {
				tagSet.add(tag);
			}
		}

		const allTags = Array.from(tagSet).sort();
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

	async onClose(): Promise<void> {
		this.gridEl = null;
		this.tagFilterContainerEl = null;
		this.allNotes = [];
		this.selectedTags.clear();
		this.folderInfoButton = null;
		this.tagsInfoButton = null;
		this.sortOrderButton = null;
		this.allAvailableTags = [];
	}
}


