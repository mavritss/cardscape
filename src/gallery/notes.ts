import { Notice, TFile, TFolder, normalizePath, type App } from "obsidian";
import type { GalleryPluginSettings } from "../settings";
import type { ResolvedUiLanguage } from "../i18n";
import type { GalleryNoteCard } from "./types";

type FrontmatterLike = { tags?: unknown };
type EmbedLike = { link?: unknown };
type CardIndexEntry = {
	path?: unknown;
	title?: unknown;
	summary?: unknown;
	tags?: unknown;
	created?: unknown;
	updated?: unknown;
	modified?: unknown;
	preview_image?: unknown;
};

type CardIndex = {
	cards?: unknown;
};

export async function loadNotesFromFolder(
	app: App,
	settings: GalleryPluginSettings,
	currentLang: ResolvedUiLanguage,
): Promise<GalleryNoteCard[]> {
	if (settings.useCardIndex ?? true) {
		const indexedCards = await loadNotesFromCardIndex(
			app,
			settings,
			currentLang,
		);
		if (indexedCards) return indexedCards;
	}

	const vault = app.vault;
	const folderPath = settings.folderPath?.trim();

	let root: TFolder | null = null;
	if (folderPath) {
		const maybeFolder = vault.getAbstractFileByPath(folderPath);
		if (!maybeFolder) {
			new Notice(
				currentLang === "ru"
					? `Папка "${folderPath}" не найдена.`
					: `Folder "${folderPath}" was not found.`,
			);
			return [];
		}
		if (!(maybeFolder instanceof TFolder)) {
			new Notice(
				currentLang === "ru"
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
	collectMarkdownFiles(root, files);

	// Use a bounded subset to avoid blocking UI in large vaults.
	const maxNotes = settings.maxNotes ?? 600;
	const sortedFiles = files
		.slice()
		.sort((a, b) => {
			const aTime = typeof a.stat.ctime === "number" ? a.stat.ctime : a.stat.mtime;
			const bTime = typeof b.stat.ctime === "number" ? b.stat.ctime : b.stat.mtime;
			return bTime - aTime;
		})
		.slice(0, maxNotes);

	const cards: GalleryNoteCard[] = [];
	for (const file of sortedFiles) {
		const content = await vault.cachedRead(file);
		const { title, snippet } = extractTitleAndSnippet(file, content, currentLang);
		const tags = extractTags(app, file);
		const created = typeof file.stat.ctime === "number" ? file.stat.ctime : file.stat.mtime;
		cards.push({ file, title, snippet, tags, created, source: "markdown" });
	}

	return cards;
}

async function loadNotesFromCardIndex(
	app: App,
	settings: GalleryPluginSettings,
	currentLang: ResolvedUiLanguage,
): Promise<GalleryNoteCard[] | null> {
	const vault = app.vault;
	const indexPath = normalizePath(
		settings.cardIndexPath?.trim() || ".ai/cardscape-index.json",
	);

	try {
		const raw = await vault.adapter.read(indexPath);
		const parsed = JSON.parse(raw) as CardIndex;
		if (!Array.isArray(parsed.cards)) return null;

		const folderPath = normalizePath(settings.folderPath?.trim() ?? "");
		const cards: GalleryNoteCard[] = [];

		for (const rawCard of parsed.cards as CardIndexEntry[]) {
			if (!rawCard || typeof rawCard.path !== "string") continue;
			const notePath = normalizePath(rawCard.path);
			if (folderPath && !notePath.startsWith(`${folderPath}/`)) continue;

			const maybeFile = vault.getAbstractFileByPath(notePath);
			if (!(maybeFile instanceof TFile)) continue;

			const title =
				typeof rawCard.title === "string" && rawCard.title.trim()
					? rawCard.title.trim()
					: maybeFile.basename;
			const snippet =
				typeof rawCard.summary === "string" && rawCard.summary.trim()
					? rawCard.summary.trim()
					: currentLang === "ru"
						? "Пустая заметка"
						: "Empty note";
			const tags = Array.isArray(rawCard.tags)
				? rawCard.tags
						.filter((tag): tag is string => typeof tag === "string")
						.map((tag) => tag.replace(/^#/, "").trim())
						.filter(Boolean)
				: [];
			const created = getCardTimestamp(rawCard, maybeFile);
			const previewImagePath =
				typeof rawCard.preview_image === "string"
					? rawCard.preview_image
					: undefined;

			cards.push({
				file: maybeFile,
				title,
				snippet,
				tags: Array.from(new Set(tags)).sort(),
				created,
				previewImagePath,
				source: "index",
			});
		}

		const maxNotes = settings.maxNotes ?? 600;
		return cards
			.sort((a, b) => b.created - a.created)
			.slice(0, maxNotes);
	} catch {
		return null;
	}
}

function getCardTimestamp(card: CardIndexEntry, file: TFile): number {
	for (const key of ["created", "updated", "modified"] as const) {
		const raw = card[key];
		if (typeof raw !== "string") continue;
		const parsed = Date.parse(raw);
		if (Number.isFinite(parsed)) return parsed;
	}
	return typeof file.stat.ctime === "number" ? file.stat.ctime : file.stat.mtime;
}

function collectMarkdownFiles(folder: TFolder, result: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			if (isServiceFolder(child.path)) continue;
			collectMarkdownFiles(child, result);
		} else if (child instanceof TFile && child.extension === "md") {
			if (shouldSkipMarkdownPath(child.path)) continue;
			result.push(child);
		}
	}
}

function isServiceFolder(path: string): boolean {
	const normalized = normalizePath(path);
	return (
		normalized === ".ai" ||
		normalized === ".okf" ||
		normalized === ".obsidian" ||
		normalized === ".trash" ||
		normalized === ".git" ||
		normalized === ".agents" ||
		normalized === "node_modules" ||
		normalized.startsWith(".ai/") ||
		normalized.startsWith(".okf/") ||
		normalized.startsWith(".obsidian/") ||
		normalized.startsWith(".trash/") ||
		normalized.startsWith(".git/") ||
		normalized.startsWith(".agents/") ||
		normalized.startsWith("node_modules/")
	);
}

function shouldSkipMarkdownPath(path: string): boolean {
	const normalized = normalizePath(path);
	return (
		normalized === "AGENTS.md" ||
		normalized === "README.md" ||
		normalized === "TASK.md" ||
		normalized === "TRIAGE_PROMPT.md" ||
		normalized === "index.md" ||
		normalized === "log.md" ||
		normalized === "2 – Узлы/Состояние индекса.md" ||
		normalized.endsWith("/index.md")
	);
}

function extractTitleAndSnippet(
	file: TFile,
	content: string,
	currentLang: ResolvedUiLanguage,
): { title: string; snippet: string } {
	const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
	const firstContentLineIdx = findContentStartLineIndex(lines);

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
		// Skip image/embed-only lines to avoid showing markdown syntax.
		if (trimmed.startsWith("![[") || trimmed.startsWith("![")) continue;
		// Skip frontmatter separators so snippet does not become "---".
		if (trimmed === "---") continue;
		snippet = trimmed;
		break;
	}

	if (!snippet) {
		snippet = currentLang === "ru" ? "Пустая заметка" : "Empty note";
	} else if (snippet.length > 280) {
		snippet = snippet.slice(0, 277) + "...";
	}

	if (title.length > 80) {
		title = title.slice(0, 77) + "...";
	}

	return { title, snippet };
}

/**
 * If the note starts with YAML frontmatter (`--- ... ---`),
 * return the first line index right after that block. Otherwise return 0.
 */
function findContentStartLineIndex(lines: string[]): number {
	let i = 0;
	while (i < lines.length && !lines[i]?.trim()) i++;

	if ((lines[i] ?? "").trim() !== "---") return 0;

	for (let j = i + 1; j < lines.length; j++) {
		if ((lines[j] ?? "").trim() === "---") {
			return j + 1;
		}
	}

	return 0;
}

function extractTags(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	const tagSet = new Set<string>();
	const frontmatter = cache?.frontmatter as FrontmatterLike | undefined;
	if (frontmatter && frontmatter.tags) {
		const fmTags = Array.isArray(frontmatter.tags)
			? frontmatter.tags
			: [frontmatter.tags];
		for (const rawTag of fmTags) {
			if (typeof rawTag !== "string") continue;
			const norm = rawTag.replace(/^#/, "").trim();
			if (norm) tagSet.add(norm);
		}
	}

	return Array.from(tagSet).sort();
}

export function findFirstImageForFile(app: App, noteFile: TFile): TFile | null {
	const cache = app.metadataCache.getFileCache(noteFile);
	const embeds = cache?.embeds as EmbedLike[] | undefined;
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
		const link = typeof embed.link === "string" ? embed.link : undefined;
		if (!link) continue;
		const target = app.metadataCache.getFirstLinkpathDest(link, noteFile.path);
		if (
			target instanceof TFile &&
			imageExtensions.has(target.extension.toLowerCase())
		) {
			return target;
		}
	}

	return null;
}

export function findPreviewImageForCard(app: App, note: GalleryNoteCard): TFile | null {
	if (note.previewImagePath) {
		const target = app.metadataCache.getFirstLinkpathDest(
			note.previewImagePath,
			note.file.path,
		);
		if (target instanceof TFile) return target;
	}
	return findFirstImageForFile(app, note.file);
}
