import type { EntityState } from './entities.js'

/** Prior level before the first unconfirmed optimistic setLevel for an entity code. */
export type PendingOptimisticLevels = Map<string, number | null>

/**
 * Remember the pre-optimistic level once per code until the device confirms or we roll back.
 * Later ticks on the same code keep the original prior so a rejection restores the last known-good value.
 */
export function trackOptimisticSetLevel(
	pending: PendingOptimisticLevels,
	code: string,
	currentLevel: number | null,
): void {
	if (!code || pending.has(code)) return
	pending.set(code, currentLevel)
}

/** Device state echo for this code confirms or replaces the optimistic value. */
export function confirmOptimisticSetLevel(pending: PendingOptimisticLevels, code: string): void {
	pending.delete(code)
}

export function confirmOptimisticSetLevels(pending: PendingOptimisticLevels, codes: Iterable<string>): void {
	for (const code of codes) pending.delete(code)
}

/** Confirm only entries that include a numeric level so level-free partials keep rollback state. */
export function confirmOptimisticSetLevelsFromStates(
	pending: PendingOptimisticLevels,
	states: Iterable<EntityState>,
): void {
	for (const entry of states) {
		if (typeof entry.level === 'number') pending.delete(entry.code)
	}
}

/**
 * Tracks an in-flight device reconcile so execute() can wait for the newest snapshot.
 * A newer run replaces the current promise; completing older runs do not clear it.
 */
export class ReconcileGate {
	#current: Promise<void> | null = null
	#seq = 0

	invalidate(): void {
		this.#seq++
		this.#current = null
	}

	async run(task: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
		const seq = ++this.#seq
		const work = (async () => {
			try {
				await task(() => seq === this.#seq)
			} finally {
				if (this.#seq === seq) this.#current = null
			}
		})()
		this.#current = work
		await work
	}

	async wait(): Promise<void> {
		while (this.#current) {
			await this.#current
		}
	}
}

/**
 * Take the rollback prior for a rejected execute. `undefined` means nothing was pending.
 * `null` means pending but the prior level was unknown — caller should refresh device state.
 * Unknown priors stay in the map until a successful full snapshot confirms them.
 */
export function takeOptimisticRollback(pending: PendingOptimisticLevels, code: string): number | null | undefined {
	if (!pending.has(code)) return undefined
	const prior = pending.get(code) ?? null
	if (typeof prior === 'number') pending.delete(code)
	return prior
}

/** Take numeric rollback baselines. Unknown (`null`) priors stay until a full snapshot. */
export function takeAllOptimisticRollbacks(
	pending: PendingOptimisticLevels,
): Array<{ code: string; priorLevel: number }> {
	const rollbacks: Array<{ code: string; priorLevel: number }> = []
	for (const [code, priorLevel] of pending) {
		if (typeof priorLevel !== 'number') continue
		rollbacks.push({ code, priorLevel })
		pending.delete(code)
	}
	return rollbacks
}
