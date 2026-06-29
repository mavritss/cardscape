import type { TFile } from "obsidian";

export interface GalleryNoteCard {
	file: TFile;
	title: string;
	snippet: string;
	tags: string[];
	created: number;
	previewImagePath?: string;
	source?: "index" | "markdown";
}

export type GallerySortOrder = "new-first" | "old-first";

export interface TagGroup {
	tag: string;
	children: string[];
	count: number;
}
