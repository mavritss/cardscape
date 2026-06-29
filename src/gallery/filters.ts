import type { GalleryNoteCard, GallerySortOrder, TagGroup } from "./types";

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
			required.every((tag) => note.tags.some((noteTag) => tagMatches(noteTag, tag))),
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

function tagMatches(noteTag: string, selectedTag: string): boolean {
	return noteTag === selectedTag || noteTag.startsWith(`${selectedTag}/`);
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

export function collectTagGroups(notes: GalleryNoteCard[]): TagGroup[] {
	const groups = new Map<string, { children: Set<string>; count: number }>();

	for (const note of notes) {
		const noteRoots = new Set<string>();
		for (const tag of note.tags) {
			const [root, ...rest] = tag.split("/");
			if (!root) continue;
			if (!groups.has(root)) {
				groups.set(root, { children: new Set<string>(), count: 0 });
			}
			noteRoots.add(root);
			if (rest.length) {
				groups.get(root)?.children.add(`${root}/${rest.join("/")}`);
			}
		}
		for (const root of noteRoots) {
			const group = groups.get(root);
			if (group) group.count += 1;
		}
	}

	return Array.from(groups.entries())
		.map(([tag, group]) => ({
			tag,
			children: Array.from(group.children).sort(),
			count: group.count,
		}))
		.sort((a, b) => a.tag.localeCompare(b.tag));
}
