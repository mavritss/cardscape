export function getColumnCountFromWidth(width: number): number {
	if (width < 520) return 1;
	if (width < 850) return 2;
	if (width < 1180) return 3;
	if (width < 1500) return 4;
	if (width < 1850) return 5;
	return 6;
}
