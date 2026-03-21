import type { TFile } from "obsidian";

export interface GalleryNoteCard {
	file: TFile;
	title: string;
	snippet: string;
	tags: string[];
	created: number;
}

export type GallerySortOrder = "new-first" | "old-first";
