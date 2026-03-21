import type { GalleryNoteCard, GallerySortOrder } from "./types";

export function getFilteredNotes(
	allNotes: GalleryNoteCard[],
	selectedTags: Set<string>,
	sortOrder: GallerySortOrder,
): GalleryNoteCard[] {
	let notes: GalleryNoteCard[];

	if (!selectedTags.size) {
		notes = [...allNotes];
	} else {
		const required = Array.from(selectedTags);
		notes = allNotes.filter((note) =>
			required.every((tag) => note.tags.includes(tag)),
		);
	}

	notes.sort((a, b) => {
		if (sortOrder === "new-first") {
			return b.created - a.created;
		}
		return a.created - b.created;
	});

	return notes;
}

export function collectAvailableTags(notes: GalleryNoteCard[]): string[] {
	const tagSet = new Set<string>();
	for (const note of notes) {
		for (const tag of note.tags) {
			tagSet.add(tag);
		}
	}
	return Array.from(tagSet).sort();
}
