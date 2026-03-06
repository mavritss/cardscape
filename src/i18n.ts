import type { App } from "obsidian";

/**
 * Поддерживаемые языки интерфейса плагина.
 *
 * - "auto" — автоматически подстраиваться под язык Obsidian.
 * - "ru"   — русский.
 * - "en"   — английский.
 */
export type UiLanguage = "auto" | "ru" | "en";

export type ResolvedUiLanguage = "ru" | "en";

/**
 * Аккуратно определяем язык интерфейса:
 * 1) Если пользователь явно выбрал язык в настройках — используем его.
 * 2) Иначе смотрим на язык Obsidian (`app.locale`).
 * 3) Всё остальное по умолчанию трактуем как английский.
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


