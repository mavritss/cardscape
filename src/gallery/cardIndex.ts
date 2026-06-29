import { Notice, Plugin, TAbstractFile, TFile, normalizePath } from "obsidian";
import type { GalleryPluginSettings } from "../settings";

type FrontmatterLike = Record<string, unknown>;

type CardIndexEntry = {
	path: string;
	title: string;
	summary: string;
	tags: string[];
	type: string;
	folder_id: string;
	preview_image: string | null;
	has_visuals: boolean;
	created: string;
	updated: string;
	modified: string;
	source_mtime?: number;
	source_size?: number;
	indexed_at?: string;
};

type CardIndex = {
	cards?: unknown;
};

type CardscapePluginLike = Plugin & {
	settings: GalleryPluginSettings;
};

const DEFAULT_INDEX_PATH = ".ai/cardscape-index.json";
const UPSERT_DELAY_MS = 700;
const FLUSH_DELAY_MS = 500;

export class CardIndexSynchronizer {
	private readonly cardsByPath = new Map<string, CardIndexEntry>();
	private readonly pendingUpserts = new Map<string, number>();
	private indexLoaded = false;
	private flushTimer: number | null = null;

	constructor(
		private readonly plugin: CardscapePluginLike,
		private readonly onIndexWritten: () => void,
	) {}

	start(): void {
		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file) => {
				this.queueUpsert(file);
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on("create", (file) => {
				if (file instanceof TFile) this.queueUpsert(file);
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on("modify", (file) => {
				if (file instanceof TFile) this.queueUpsert(file);
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on("delete", (file) => {
				this.queueRemove(file);
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on("rename", (file, oldPath) => {
				void this.removePath(oldPath);
				if (file instanceof TFile) this.queueUpsert(file);
			}),
		);

		this.plugin.register(() => this.destroy());
	}

	async rebuildAll(): Promise<void> {
		await this.loadIndex();
		this.clearPendingUpserts();
		this.cardsByPath.clear();

		let indexedCount = 0;
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			if (!this.isIndexableMarkdownPath(file.path)) continue;
			const card = await this.buildCard(file);
			if (!card) continue;
			this.cardsByPath.set(card.path, card);
			indexedCount += 1;
		}

		await this.writeIndex();
		new Notice(`Cardscape index rebuilt: ${indexedCount} cards`);
	}

	private queueUpsert(file: TFile): void {
		if (file.extension !== "md") return;
		const path = normalizePath(file.path);
		const existingTimer = this.pendingUpserts.get(path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		const timer = window.setTimeout(() => {
			this.pendingUpserts.delete(path);
			void this.upsertFile(file);
		}, UPSERT_DELAY_MS);
		this.pendingUpserts.set(path, timer);
	}

	private queueRemove(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		void this.removePath(file.path);
	}

	private async upsertFile(file: TFile): Promise<void> {
		await this.loadIndex();

		const path = normalizePath(file.path);
		if (!this.isIndexableMarkdownPath(path)) {
			if (this.cardsByPath.delete(path)) this.scheduleFlush();
			return;
		}

		const card = await this.buildCard(file);
		if (!card) return;
		this.cardsByPath.set(card.path, card);
		this.scheduleFlush();
	}

	private async removePath(path: string): Promise<void> {
		await this.loadIndex();
		const normalized = normalizePath(path);
		this.cancelPendingUpsert(normalized);
		if (!this.cardsByPath.delete(normalized)) return;
		this.scheduleFlush();
	}

	private async loadIndex(): Promise<void> {
		if (this.indexLoaded) return;
		this.indexLoaded = true;
		this.cardsByPath.clear();

		try {
			const raw = await this.plugin.app.vault.adapter.read(this.indexPath());
			const parsed = JSON.parse(raw) as CardIndex;
			if (!Array.isArray(parsed.cards)) return;

			for (const rawCard of parsed.cards) {
				const card = this.normalizeCard(rawCard);
				if (!card) continue;
				this.cardsByPath.set(card.path, card);
			}
		} catch {
			// Missing or broken index means "start from an empty cache".
			// A full rebuild is available as an explicit command.
		}
	}

	private normalizeCard(rawCard: unknown): CardIndexEntry | null {
		if (!rawCard || typeof rawCard !== "object") return null;
		const card = rawCard as Partial<CardIndexEntry>;
		if (typeof card.path !== "string" || !card.path.trim()) return null;

		const path = normalizePath(card.path);
		if (!this.isIndexableMarkdownPath(path)) return null;

		const tags = Array.isArray(card.tags)
			? card.tags
					.filter((tag): tag is string => typeof tag === "string")
					.map((tag) => normalizeVisibleTag(tag))
					.filter((tag): tag is string => Boolean(tag))
			: [];
		const now = new Date().toISOString();
		const modified = typeof card.modified === "string" ? card.modified : now;

		return {
			path,
			title: typeof card.title === "string" ? card.title : "",
			summary: typeof card.summary === "string" ? card.summary : "",
			tags: withRootTags(tags),
			type: typeof card.type === "string" ? card.type : "note",
			folder_id: typeof card.folder_id === "string" ? card.folder_id : "notes",
			preview_image:
				typeof card.preview_image === "string" ? card.preview_image : null,
			has_visuals: Boolean(card.has_visuals),
			created: typeof card.created === "string" ? card.created : modified,
			updated: typeof card.updated === "string" ? card.updated : modified,
			modified,
			source_mtime:
				typeof card.source_mtime === "number" ? card.source_mtime : undefined,
			source_size:
				typeof card.source_size === "number" ? card.source_size : undefined,
			indexed_at:
				typeof card.indexed_at === "string" ? card.indexed_at : undefined,
		};
	}

	private async buildCard(file: TFile): Promise<CardIndexEntry | null> {
		if (!this.isIndexableMarkdownPath(file.path)) return null;

		const content = await this.plugin.app.vault.cachedRead(file);
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const frontmatter = (cache?.frontmatter ?? {}) as FrontmatterLike;
		const folderId = inferFolderId(file.path, frontmatter);
		const type = inferType(folderId, content, frontmatter);
		const modified = new Date(file.stat.mtime).toISOString();
		const tags = withRootTags(readFrontmatterTags(frontmatter));

		return {
			path: normalizePath(file.path),
			title: titleFrom(file, content, frontmatter),
			summary: summaryFrom(content, frontmatter),
			tags,
			type,
			folder_id: folderId,
			preview_image: firstEmbed(content),
			has_visuals: /!\[\[|!\[/.test(content),
			created: modified,
			updated: modified,
			modified,
			source_mtime: file.stat.mtime,
			source_size: file.stat.size,
			indexed_at: new Date().toISOString(),
		};
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
		}
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			void this.writeIndex();
		}, FLUSH_DELAY_MS);
	}

	private async writeIndex(): Promise<void> {
		await this.ensureParentFolder(this.indexPath());
		const cards = Array.from(this.cardsByPath.values()).sort(compareCards);
		await this.plugin.app.vault.adapter.write(
			this.indexPath(),
			JSON.stringify(
				{
					version: 1,
					generated_at: new Date().toISOString(),
					card_count: cards.length,
					update_mode: "incremental",
					cards,
				},
				null,
				2,
			),
		);
		this.onIndexWritten();
	}

	private async ensureParentFolder(filePath: string): Promise<void> {
		const parts = normalizePath(filePath).split("/");
		parts.pop();
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (await this.plugin.app.vault.adapter.exists(current)) continue;
			await this.plugin.app.vault.adapter.mkdir(current);
		}
	}

	private indexPath(): string {
		return normalizePath(
			this.plugin.settings.cardIndexPath?.trim() || DEFAULT_INDEX_PATH,
		);
	}

	private isIndexableMarkdownPath(path: string): boolean {
		const normalized = normalizePath(path);
		if (!normalized.toLowerCase().endsWith(".md")) return false;
		if (isServicePath(normalized)) return false;
		if (shouldSkip(normalized)) return false;
		return !normalized.startsWith("4 – Архив/");
	}

	private cancelPendingUpsert(path: string): void {
		const timer = this.pendingUpserts.get(path);
		if (timer === undefined) return;
		window.clearTimeout(timer);
		this.pendingUpserts.delete(path);
	}

	private clearPendingUpserts(): void {
		for (const timer of this.pendingUpserts.values()) {
			window.clearTimeout(timer);
		}
		this.pendingUpserts.clear();
	}

	private destroy(): void {
		this.clearPendingUpserts();
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}

function readFrontmatterTags(frontmatter: FrontmatterLike): string[] {
	const rawTags = frontmatter.tags;
	const values = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
	return uniqueSorted(
		values
			.filter((tag): tag is string => typeof tag === "string")
			.map((tag) => normalizeVisibleTag(tag))
			.filter((tag): tag is string => Boolean(tag)),
	);
}

function normalizeVisibleTag(tag: string): string | null {
	const clean = tag.replace(/^#/, "").trim();
	if (!clean) return null;
	const lower = clean.toLocaleLowerCase("ru-RU");
	if (["idea", "visual-idea", "идея", "идея/визуальная"].includes(lower)) {
		return null;
	}
	return lower;
}

function withRootTags(tags: string[]): string[] {
	const expanded = new Set(tags);
	for (const tag of tags) {
		const root = tag.split("/")[0];
		if (root) expanded.add(root);
	}
	return uniqueSorted(Array.from(expanded));
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
		a.localeCompare(b, "ru"),
	);
}

function titleFrom(file: TFile, content: string, frontmatter: FrontmatterLike): string {
	if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
		return frontmatter.title.trim();
	}
	const heading = content.match(/^\s*#\s+(.+?)\s*$/m);
	if (heading?.[1]) return heading[1].trim();
	return file.basename;
}

function summaryFrom(content: string, frontmatter: FrontmatterLike): string {
	if (typeof frontmatter.summary === "string" && frontmatter.summary.trim()) {
		return frontmatter.summary.trim();
	}
	const body = stripFrontmatter(content);
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("![") || trimmed.startsWith("[[")) continue;
		if (/^\s*[-*]\s*\[\[/.test(trimmed)) continue;
		const clean = trimmed
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
			.replace(/\[\[([^\]]+)\]\]/g, "$1");
		return clean.length > 220 ? `${clean.slice(0, 217)}...` : clean;
	}
	return "";
}

function stripFrontmatter(content: string): string {
	return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, "");
}

function firstEmbed(content: string): string | null {
	const wikiImage = content.match(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/);
	if (wikiImage?.[1]) return wikiImage[1].trim();
	const markdownImage = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
	if (markdownImage?.[1]) return markdownImage[1].trim();
	return null;
}

function inferFolderId(path: string, frontmatter: FrontmatterLike): string {
	if (typeof frontmatter.folder_id === "string" && frontmatter.folder_id.trim()) {
		return frontmatter.folder_id.trim();
	}
	if (path.startsWith("1 – Инбокс/Needs_review/")) return "inbox_review";
	if (path.startsWith("1 – Инбокс/")) return "inbox";
	if (path.startsWith("2 – Узлы/")) return "hubs";
	if (path.startsWith("3 – Заметки/01 – Идеи/")) return "ideas";
	if (path.startsWith("3 – Заметки/02 – Мысли/")) return "thoughts";
	if (path.startsWith("3 – Заметки/03 – Статьи/")) return "articles";
	if (path.startsWith("3 – Заметки/04 – Контент/")) return "content";
	if (path.startsWith("3 – Заметки/05 – Проекты/")) return "projects";
	if (path.startsWith("3 – Заметки/Книги/")) return "books";
	if (path.startsWith("3 – Заметки/Дизайн/")) return "design";
	if (path.startsWith("3 – Заметки/Сети/")) return "networks";
	if (path.startsWith("3 – Заметки/Психология/")) return "psychology";
	if (path.startsWith("3 – Заметки/Инструменты/")) return "tools";
	if (path.startsWith("3 – Заметки/Тревел/")) return "travel";
	if (path.startsWith("4 – Архив/Ежедневник/")) return "journal";
	if (path.startsWith("4 – Архив/")) return "archive";
	return "notes";
}

function inferType(
	folderId: string,
	content: string,
	frontmatter: FrontmatterLike,
): string {
	if (typeof frontmatter.type === "string" && frontmatter.type.trim()) {
		return frontmatter.type.trim();
	}
	if (folderId === "ideas") return /!\[\[|!\[/.test(content) ? "visual-idea" : "idea";
	if (folderId === "thoughts") return "thought";
	if (folderId === "journal") return "daily-note";
	if (folderId === "articles") return "source-note";
	if (folderId === "content") return "content-idea";
	if (folderId === "projects") return "project";
	if (folderId === "books") return "book-note";
	if (folderId === "design") return "design-note";
	if (folderId === "tools") return "tool-note";
	if (folderId === "hubs") return "concept";
	return "note";
}

function shouldSkip(path: string): boolean {
	return (
		path === "AGENTS.md" ||
		path === "README.md" ||
		path === "TASK.md" ||
		path === "TRIAGE_PROMPT.md" ||
		path === "index.md" ||
		path === "log.md" ||
		path === "2 – Узлы/Состояние индекса.md" ||
		path.endsWith("/index.md")
	);
}

function isServicePath(path: string): boolean {
	return (
		path.startsWith(".ai/") ||
		path.startsWith(".okf/") ||
		path.startsWith(".obsidian/") ||
		path.startsWith(".trash/") ||
		path.startsWith(".git/") ||
		path.startsWith(".agents/") ||
		path.startsWith("node_modules/")
	);
}

function compareCards(a: CardIndexEntry, b: CardIndexEntry): number {
	const bTime = Date.parse(b.modified);
	const aTime = Date.parse(a.modified);
	if (Number.isFinite(aTime) && Number.isFinite(bTime) && bTime !== aTime) {
		return bTime - aTime;
	}
	return a.path.localeCompare(b.path, "ru");
}
