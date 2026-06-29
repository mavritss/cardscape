import { Notice, TFile, normalizePath, type App } from "obsidian";
import YAML from "yaml";
import type CardscapePlugin from "../main";
import type { GalleryPluginSettings } from "../settings";

type FrontmatterLike = Record<string, unknown>;

type HealthIssue = {
	path: string;
	title: string;
	detail: string;
};

type BrokenImageIssue = HealthIssue & {
	link: string;
};

type UnknownTagIssue = HealthIssue & {
	tag: string;
};

type CacheIssue = HealthIssue & {
	kind: "missing" | "stale" | "extra" | "index-missing";
};

type HealthReport = {
	generated_at: string;
	counts: {
		no_tags: number;
		unknown_tags: number;
		empty_summary: number;
		broken_images: number;
		stale_cache: number;
	};
	no_tags: HealthIssue[];
	unknown_tags: UnknownTagIssue[];
	empty_summary: HealthIssue[];
	broken_images: BrokenImageIssue[];
	stale_cache: CacheIssue[];
};

type TagVocabulary = {
	roots: Set<string>;
	tags: Set<string>;
	openRoots: Set<string>;
};

type CardIndexEntry = {
	path?: unknown;
	source_mtime?: unknown;
	source_size?: unknown;
	title?: unknown;
};

type CardIndex = {
	cards?: unknown[];
};

const HEALTH_JSON_PATH = ".ai/index-health.json";
const HEALTH_MARKDOWN_PATH = "2 – Узлы/Состояние индекса.md";
const DEFAULT_CARD_INDEX_PATH = ".ai/cardscape-index.json";

export async function generateAndOpenIndexHealth(
	plugin: CardscapePlugin,
): Promise<void> {
	const report = await buildIndexHealthReport(
		plugin.app,
		plugin.settings,
	);
	await ensureParentFolder(plugin.app, HEALTH_JSON_PATH);
	await plugin.app.vault.adapter.write(
		HEALTH_JSON_PATH,
		JSON.stringify(serializableReport(report), null, 2),
	);
	const reportFile = await writeMarkdownReport(
		plugin.app,
		HEALTH_MARKDOWN_PATH,
		renderHealthMarkdown(report),
	);

	await plugin.app.workspace.getLeaf(true).openFile(reportFile);

	new Notice("Index health report updated");
}

async function buildIndexHealthReport(
	app: App,
	settings: GalleryPluginSettings,
): Promise<HealthReport> {
	const generatedAt = new Date().toISOString();
	const vocabulary = await loadTagVocabulary(app);
	const cardIndex = await loadCardIndex(app, settings);
	const cardByPath = new Map<string, CardIndexEntry>();
	const staleCache: CacheIssue[] = [];

	if (cardIndex === null) {
		staleCache.push({
			path: normalizePath(settings.cardIndexPath || DEFAULT_CARD_INDEX_PATH),
			title: "Cardscape index",
			kind: "index-missing",
			detail: "Cardscape index is missing or cannot be parsed.",
		});
	} else {
		for (const rawCard of cardIndex.cards ?? []) {
			if (!rawCard || typeof rawCard !== "object") continue;
			const card = rawCard as CardIndexEntry;
			if (typeof card.path !== "string") continue;
			cardByPath.set(normalizePath(card.path), card);
		}
	}

	const noTags: HealthIssue[] = [];
	const unknownTags: UnknownTagIssue[] = [];
	const emptySummary: HealthIssue[] = [];
	const brokenImages: BrokenImageIssue[] = [];
	const seenIndexablePaths = new Set<string>();

	for (const file of app.vault.getMarkdownFiles()) {
		const path = normalizePath(file.path);
		if (!isReviewableNotePath(path)) continue;

		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = (cache?.frontmatter ?? {}) as FrontmatterLike;
		const title = titleFrom(file, frontmatter);
		const tags = readFrontmatterTags(frontmatter);
		const link = noteLink(path, title);

		if (!tags.length) {
			noTags.push({
				path,
				title,
				detail: `${link} has no Properties tags.`,
			});
		}

		for (const tag of tags) {
			if (!isKnownTag(tag, vocabulary)) {
				unknownTags.push({
					path,
					title,
					tag,
					detail: `${link} uses unknown tag #${tag}.`,
				});
			}
		}

		if (
			typeof frontmatter.summary !== "string" ||
			!frontmatter.summary.trim()
		) {
			emptySummary.push({
				path,
				title,
				detail: `${link} has an empty summary.`,
			});
		}

		for (const issue of findBrokenImages(app, file, title)) {
			brokenImages.push(issue);
		}

		if (!isCardscapeIndexablePath(path)) continue;
		seenIndexablePaths.add(path);
		const card = cardByPath.get(path);
		if (!card) {
			staleCache.push({
				path,
				title,
				kind: "missing",
				detail: `${link} is missing from Cardscape cache.`,
			});
			continue;
		}

		if (
			typeof card.source_mtime !== "number" ||
			typeof card.source_size !== "number" ||
			card.source_mtime !== file.stat.mtime ||
			card.source_size !== file.stat.size
		) {
			staleCache.push({
				path,
				title,
				kind: "stale",
				detail: `${link} has stale Cardscape cache metadata.`,
			});
		}
	}

	for (const [path, card] of cardByPath.entries()) {
		if (seenIndexablePaths.has(path)) continue;
		if (app.vault.getAbstractFileByPath(path) instanceof TFile) continue;
		const title = typeof card.title === "string" && card.title ? card.title : path;
		staleCache.push({
			path,
			title,
			kind: "extra",
			detail: `Cache contains a missing note: ${path}.`,
		});
	}

	return {
		generated_at: generatedAt,
		counts: {
			no_tags: noTags.length,
			unknown_tags: unknownTags.length,
			empty_summary: emptySummary.length,
			broken_images: brokenImages.length,
			stale_cache: staleCache.length,
		},
		no_tags: sortIssues(noTags),
		unknown_tags: sortIssues(unknownTags),
		empty_summary: sortIssues(emptySummary),
		broken_images: sortIssues(brokenImages),
		stale_cache: sortIssues(staleCache),
	};
}

async function loadTagVocabulary(app: App): Promise<TagVocabulary> {
	const roots = new Set<string>();
	const tags = new Set<string>();
	const openRoots = new Set(["другое", "проект"]);

	try {
		const raw = await app.vault.adapter.read(".okf/tags.yml");
		const parsed = YAML.parse(raw) as {
			root_tags?: Record<string, { children?: Record<string, unknown> }>;
		} | null;
		const rootTags = parsed?.root_tags ?? {};
		for (const [root, config] of Object.entries(rootTags)) {
			roots.add(root);
			tags.add(root);
			const children = config?.children ?? {};
			for (const child of Object.keys(children)) {
				tags.add(`${root}/${child}`);
			}
		}
	} catch {
		// If tag vocabulary cannot be read, unknown-tag checks will simply be broad.
	}

	return { roots, tags, openRoots };
}

async function loadCardIndex(
	app: App,
	settings: GalleryPluginSettings,
): Promise<CardIndex | null> {
	const path = normalizePath(settings.cardIndexPath || DEFAULT_CARD_INDEX_PATH);
	try {
		const raw = await app.vault.adapter.read(path);
		const parsed = JSON.parse(raw) as CardIndex;
		if (!Array.isArray(parsed.cards)) return null;
		return parsed;
	} catch {
		return null;
	}
}

function readFrontmatterTags(frontmatter: FrontmatterLike): string[] {
	const rawTags = frontmatter.tags;
	const values = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
	const tags = values
		.filter((tag): tag is string => typeof tag === "string")
		.map((tag) => tag.replace(/^#/, "").trim().toLocaleLowerCase("ru-RU"))
		.filter(Boolean);
	return Array.from(new Set(tags)).sort((a, b) => a.localeCompare(b, "ru"));
}

function isKnownTag(tag: string, vocabulary: TagVocabulary): boolean {
	if (vocabulary.tags.has(tag)) return true;
	const [root] = tag.split("/");
	if (!root) return false;
	if (!vocabulary.roots.has(root)) return false;
	return vocabulary.openRoots.has(root);
}

function findBrokenImages(
	app: App,
	file: TFile,
	title: string,
): BrokenImageIssue[] {
	const cache = app.metadataCache.getFileCache(file);
	const embeds = cache?.embeds ?? [];
	const issues: BrokenImageIssue[] = [];

	for (const embed of embeds) {
		const link = typeof embed.link === "string" ? embed.link : "";
		if (!link || !looksLikeImageLink(link)) continue;
		const target = app.metadataCache.getFirstLinkpathDest(link, file.path);
		if (target instanceof TFile) continue;
		issues.push({
			path: normalizePath(file.path),
			title,
			link,
			detail: `${noteLink(file.path, title)} has a broken image embed: ${link}.`,
		});
	}

	return issues;
}

function looksLikeImageLink(link: string): boolean {
	if (/^https?:\/\//i.test(link)) return false;
	return /\.(png|jpe?g|gif|webp|bmp|svg)([#|?].*)?$/i.test(link);
}

function titleFrom(file: TFile, frontmatter: FrontmatterLike): string {
	if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
		return frontmatter.title.trim();
	}
	return file.basename;
}

function noteLink(path: string, title: string): string {
	const cleanPath = normalizePath(path).replace(/\.md$/i, "");
	const cleanTitle = title.replace(/\|/g, "-");
	return `[[${cleanPath}|${cleanTitle}]]`;
}

function isReviewableNotePath(path: string): boolean {
	const normalized = normalizePath(path);
	if (!normalized.toLowerCase().endsWith(".md")) return false;
	if (isServicePath(normalized)) return false;
	if (shouldSkip(normalized)) return false;
	if (normalized.startsWith("2 – Узлы/")) return false;
	if (normalized.startsWith("4 – Архив/")) return false;
	if (normalized.startsWith("5 – Ресурсы/")) return false;
	return true;
}

function isCardscapeIndexablePath(path: string): boolean {
	const normalized = normalizePath(path);
	if (!normalized.toLowerCase().endsWith(".md")) return false;
	if (isServicePath(normalized)) return false;
	if (shouldSkip(normalized)) return false;
	return !normalized.startsWith("4 – Архив/");
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

function sortIssues<T extends HealthIssue>(issues: T[]): T[] {
	return issues.slice().sort((a, b) => a.path.localeCompare(b.path, "ru"));
}

function serializableReport(report: HealthReport): unknown {
	return report;
}

function renderHealthMarkdown(report: HealthReport): string {
	const lines = [
		"---",
		"type: note",
		"status: generated",
		"folder_id: tools",
		"tags: []",
		`summary: "Index health report generated ${report.generated_at}."`,
		"---",
		"",
		"# Index health",
		"",
		`Generated: ${report.generated_at}`,
		"",
		"## Summary",
		"",
		`- No tags: ${report.counts.no_tags}`,
		`- Unknown tags: ${report.counts.unknown_tags}`,
		`- Empty summary: ${report.counts.empty_summary}`,
		`- Broken images: ${report.counts.broken_images}`,
		`- Stale cache: ${report.counts.stale_cache}`,
		"",
	];

	appendSection(lines, "No tags", report.no_tags);
	appendSection(lines, "Unknown tags", report.unknown_tags);
	appendSection(lines, "Empty summary", report.empty_summary);
	appendSection(lines, "Broken images", report.broken_images);
	appendSection(lines, "Stale cache", report.stale_cache);

	return `${lines.join("\n")}\n`;
}

function appendSection(
	lines: string[],
	title: string,
	issues: HealthIssue[],
): void {
	lines.push(`## ${title}`, "");
	if (!issues.length) {
		lines.push("- OK", "");
		return;
	}
	for (const issue of issues) {
		lines.push(`- ${issue.detail}`);
	}
	lines.push("");
}

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
	const parts = normalizePath(filePath).split("/");
	parts.pop();
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (await app.vault.adapter.exists(current)) continue;
		await app.vault.adapter.mkdir(current);
	}
}

async function writeMarkdownReport(
	app: App,
	path: string,
	content: string,
): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return existing;
	}
	return app.vault.create(path, content);
}
