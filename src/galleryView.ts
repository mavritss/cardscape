import {
	App,
	ItemView,
	TFile,
	TFolder,
	WorkspaceLeaf,
	Notice,
} from "obsidian";
import type MyPlugin from "./main";

export const GALLERY_VIEW_TYPE = "pinterest-cards-gallery-view";

interface GalleryNoteCard {
	file: TFile;
	title: string;
	snippet: string;
	tags: string[];
}

export class PinterestGalleryView extends ItemView {
	plugin: MyPlugin;
	gridEl: HTMLElement | null = null;
	tagFilterContainerEl: HTMLElement | null = null;
	allNotes: GalleryNoteCard[] = [];
	selectedTags: Set<string> = new Set();

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
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("pinterest-gallery-view");

		const headerEl = containerEl.createDiv("pinterest-gallery-header");
		headerEl.createEl("h2", { text: "Pinterest cards gallery" });

		const infoEl = headerEl.createDiv("pinterest-gallery-header-info");
		const folderPath =
			this.plugin.settings.folderPath?.trim() ??
			"";
		infoEl.setText(
			folderPath
				? `Папка: ${folderPath}`
				: "Папка не выбрана — будут показаны заметки из всего хранилища.",
		);

		const controlsEl = headerEl.createDiv(
			"pinterest-gallery-header-controls",
		);

		const tagsButton = controlsEl.createEl("button", {
			text: "Теги",
		});
		tagsButton.addClass("pinterest-gallery-button");

		const settingsButton = controlsEl.createEl("button", {
			text: "Настройки",
		});
		settingsButton.addClass("pinterest-gallery-button");
		settingsButton.onclick = () => {
			// Открыть вкладку настроек плагина
			this.plugin.openSettings();
		};

		this.tagFilterContainerEl =
			containerEl.createDiv("pinterest-gallery-tags");

		tagsButton.onclick = () => {
			if (!this.tagFilterContainerEl) return;
			const isCollapsed =
				this.tagFilterContainerEl.hasClass("is-collapsed");
			this.tagFilterContainerEl.toggleClass("is-collapsed", !isCollapsed);
			tagsButton.toggleClass("is-active", !isCollapsed);
		};

		this.gridEl = containerEl.createDiv("pinterest-gallery-grid");

		this.allNotes = await this.loadNotesFromFolder();
		this.renderTagFilters();
		await this.renderNotes();
	}

	async renderNotes(): Promise<void> {
		if (!this.gridEl) return;

		this.gridEl.empty();

		const notes = this.getFilteredNotes();

		if (!notes.length) {
			const emptyEl = this.gridEl.createDiv("pinterest-gallery-empty");
			emptyEl.setText(
				"В выбранной папке нет заметок. Выберите другую папку в настройках плагина.",
			);
			return;
		}

		for (const note of notes) {
			const cardEl = this.gridEl.createDiv("pinterest-gallery-card");

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

			cardEl.onclick = () => {
				void this.openNote(note.file);
			};
		}
	}

	private async loadNotesFromFolder(): Promise<GalleryNoteCard[]> {
		const vault = this.app.vault;
		const folderPath = this.plugin.settings.folderPath?.trim();

		let root: TFolder | null = null;
		if (folderPath) {
			const maybeFolder = vault.getAbstractFileByPath(folderPath);
			if (!maybeFolder) {
				new Notice(`Папка "${folderPath}" не найдена.`);
				return [];
			}
			if (!(maybeFolder instanceof TFolder)) {
				new Notice(`"${folderPath}" — это не папка.`);
				return [];
			}
			root = maybeFolder;
		} else {
			root = vault.getRoot();
		}

		const files: TFile[] = [];
		this.collectMarkdownFiles(root, files);

		const cards: GalleryNoteCard[] = [];
		for (const file of files) {
			const content = await vault.cachedRead(file);
			const { title, snippet } = this.extractTitleAndSnippet(
				file,
				content,
			);
			const tags = this.extractTags(file);
			cards.push({ file, title, snippet, tags });
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
		const lines = content.split(/\r?\n/);

		let title = file.basename;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("# ")) {
				title = trimmed.replace(/^#\s+/, "").trim();
				break;
			}
		}

		let snippet = "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			if (trimmed.startsWith("#")) continue;
			// Пропускаем строки, состоящие только из картинок/встроенных файлов,
			// чтобы не показывать markdown‑синтаксис вроде ![[image.png]].
			if (trimmed.startsWith("![[") || trimmed.startsWith("![")) continue;
			snippet = trimmed;
			break;
		}

		if (!snippet) {
			snippet = "Пустая заметка";
		} else if (snippet.length > 280) {
			snippet = snippet.slice(0, 277) + "...";
		}

		if (title.length > 80) {
			title = title.slice(0, 77) + "..."
		}

		return { title, snippet };
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

	private getFilteredNotes(): GalleryNoteCard[] {
		if (!this.selectedTags.size) {
			return this.allNotes;
		}

		const required = Array.from(this.selectedTags);
		return this.allNotes.filter((note) =>
			required.every((tag) => note.tags.includes(tag)),
		);
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

		if (!allTags.length) {
			this.tagFilterContainerEl.addClass("is-collapsed");
			const emptyEl = this.tagFilterContainerEl.createDiv(
				"pinterest-gallery-tags-empty",
			);
			emptyEl.setText("Теги пока не найдены.");
			return;
		}

		const labelRow = this.tagFilterContainerEl.createDiv(
			"pinterest-gallery-tags-label-row",
		);
		labelRow.createSpan({
			text: "Фильтр по тегам",
		});

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

				void this.renderNotes();
			};
		}
	}

	async onClose(): Promise<void> {
		this.gridEl = null;
		this.tagFilterContainerEl = null;
		this.allNotes = [];
		this.selectedTags.clear();
	}
}


