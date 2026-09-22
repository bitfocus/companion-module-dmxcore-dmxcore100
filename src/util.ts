export function assertNever(value: never, message = 'Unexpected value'): never {
	throw new Error(`${message}: ${String(value)}`)
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

export function percentToLevel(percent: number): number {
	return clamp(percent / 100, 0, 1)
}

export function levelToPercent(level: number): number {
	return Math.round(clamp(level, 0, 1) * 1000) / 10
}

export function formatPercent(level: number | null): string {
	if (level === null) return ''
	const percent = levelToPercent(level)
	return Number.isInteger(percent) ? String(percent) : percent.toFixed(1)
}

/** Button-safe percent label. Unknown levels stay blank (not 0%) so other faders aren’t shown as muted. */
export function formatPercentUnit(level: number | null): string {
	if (level === null) return ''
	return `${formatPercent(level)}%`
}

/**
 * True when `needle` appears in `haystack` as a whole alphanumeric token.
 * `INTRO` matches `Cue: INTRO` and `INTRO (loop)`, but not `INTRO2`.
 */
export function containsAlphanumericToken(haystack: string, needle: string): boolean {
	const n = needle.trim()
	if (!n) return false

	let from = 0
	while (from <= haystack.length - n.length) {
		const idx = haystack.indexOf(n, from)
		if (idx === -1) return false

		const before = idx === 0 ? '' : haystack.charAt(idx - 1)
		const afterIdx = idx + n.length
		const after = afterIdx >= haystack.length ? '' : haystack.charAt(afterIdx)
		const beforeOk = before === '' || /[^a-z0-9]/i.test(before)
		const afterOk = after === '' || /[^a-z0-9]/i.test(after)
		if (beforeOk && afterOk) return true

		from = idx + 1
	}

	return false
}
