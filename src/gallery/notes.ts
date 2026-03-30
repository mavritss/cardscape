import { Notice, TFile, TFolder, type App } from "obsidian";
import type { GalleryPluginSettings } from "../settings";
import type { ResolvedUiLanguage } from "../i18n";
import type { GalleryNoteCard } from "./types";

type TagLike = { tag?: unknown };
type FrontmatterLike = { tags?: unknown };
type EmbedLike = { link?: unknown };

export async function loadNotesFromFolder(
	app: App,
	settings: GalleryPluginSettings,
	currentLang: ResolvedUiLanguage,
): Promise<GalleryNoteCard[]> {
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
		cards.push({ file, title, snippet, tags, created });
	}

	return cards;
}

function collectMarkdownFiles(folder: TFolder, result: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			collectMarkdownFiles(child, result);
		} else if (child instanceof TFile && child.extension === "md") {
			result.push(child);
		}
	}
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

	// Tags from body (#tag)
	const bodyTags = cache?.tags as TagLike[] | undefined;
	if (bodyTags) {
		for (const t of bodyTags) {
			const raw = typeof t.tag === "string" ? t.tag : "";
			if (!raw) continue;
			const norm = raw.replace(/^#/, "").trim().toLowerCase();
			if (norm) tagSet.add(norm);
		}
	}

	// Tags from frontmatter (tags: tag | [tag1, tag2])
	const frontmatter = cache?.frontmatter as FrontmatterLike | undefined;
	if (frontmatter && frontmatter.tags) {
		const fmTags = Array.isArray(frontmatter.tags)
			? frontmatter.tags
			: [frontmatter.tags];
		for (const rawTag of fmTags) {
			if (typeof rawTag !== "string") continue;
			const norm = rawTag.replace(/^#/, "").trim().toLowerCase();
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
