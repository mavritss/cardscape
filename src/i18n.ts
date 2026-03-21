import type { App } from "obsidian";

/**
 * Supported plugin UI languages.
 *
 * - "auto" - match Obsidian locale.
 * - "ru"   - Russian.
 * - "en"   - English.
 */
export type UiLanguage = "auto" | "ru" | "en";

export type ResolvedUiLanguage = "ru" | "en";

/**
 * Resolve effective UI language:
 * 1) Use explicit user setting, if present.
 * 2) Otherwise inspect Obsidian locale (`app.locale`).
 * 3) Fallback to English for everything else.
 */
export function resolveUiLanguage(
	app: App,
	explicit: UiLanguage | undefined,
): ResolvedUiLanguage {
	const choice = explicit ?? "auto";

	if (choice === "ru" || choice === "en") {
		return choice;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyApp = app as any;
	const rawLocale: unknown = anyApp?.locale;

	if (typeof rawLocale === "string") {
		const lowered = rawLocale.toLowerCase();
		if (lowered.startsWith("ru")) return "ru";
		if (lowered.startsWith("en")) return "en";
	}

	return "en";
}


