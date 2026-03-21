export function getColumnCountFromWidth(width: number): number {
	if (width < 700) return 1;
	if (width < 1024) return 3;
	// Keep 6 columns on wide screens for current visual density.
	return 6;
}
