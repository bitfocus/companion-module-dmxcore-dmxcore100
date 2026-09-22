import type { DropdownChoice } from '@companion-module/base'
import { assertNever } from './util.js'
import type { EntityKind } from './constants.js'
import { EntityKinds } from './constants.js'

export type IntegrationEntity = {
	code: string
	name: string
	kind: EntityKind
	choices?: string[]
}

export type EntityState = {
	code: string
	isOn?: boolean
	level?: number
	choice?: string
	text?: string
}

export type DeviceInfo = {
	protocolVersion: number
	serial: string
	product: string
	deviceName: string
	softwareVersion: string
}

/**
 * Health / show snapshot from Integration `GET /info` (polled).
 * WebSocket `hello` stays identity-only; these fields come from HTTP `/info`.
 */
export type DeviceStatus = {
	hostName: string
	deviceNickname: string
	appVersion: string
	showName: string
	sysCpuUsage: number | null
	appCpuUsage: number | null
	sysMemoryUsageMB: number | null
	sysMemoryTotalMB: number | null
	appMemoryUsageMB: number | null
	storageUsageMB: number | null
	storageTotalMB: number | null
	cpuTemperatureC: number | null
	boardTemperatureC: number | null
	audioAvailable: boolean | null
	networkSpeedMbit: number | null
	playerName: string
	playerCode: string
	appUpTimeH: number | null
	sysUpTimeH: number | null
	recorder: string
}

export type ExecuteCommand = 'activate' | 'turnOn' | 'turnOff' | 'toggle' | 'setLevel' | 'setChoice'

export type ExecuteRequest = {
	code: string
	command: ExecuteCommand
	level?: number
	choice?: string
	/** Cue/sound only: 0 = forever, 1 = once, N = N times. Omit to use device defaults. */
	loop?: number
	fadeInMs?: number
	fadeOutMs?: number
}

export function isEntityKind(value: unknown): value is EntityKind {
	return typeof value === 'string' && (EntityKinds as readonly string[]).includes(value)
}

export function parseEntity(raw: unknown): IntegrationEntity | null {
	if (!raw || typeof raw !== 'object') return null
	const obj = raw as Record<string, unknown>
	if (typeof obj.code !== 'string' || !obj.code) return null
	if (typeof obj.name !== 'string') return null
	if (!isEntityKind(obj.kind)) return null

	const entity: IntegrationEntity = {
		code: obj.code,
		name: obj.name,
		kind: obj.kind,
	}

	if (Array.isArray(obj.choices)) {
		entity.choices = obj.choices.filter((c): c is string => typeof c === 'string')
	}

	return entity
}

export function parseEntities(raw: unknown): IntegrationEntity[] {
	if (!raw || typeof raw !== 'object') return []
	const entities = (raw as { entities?: unknown }).entities
	if (!Array.isArray(entities)) return []
	return entities.map(parseEntity).filter((e): e is IntegrationEntity => e !== null)
}

export function parseStateEntry(raw: unknown): EntityState | null {
	if (!raw || typeof raw !== 'object') return null
	const obj = raw as Record<string, unknown>
	if (typeof obj.code !== 'string' || !obj.code) return null

	const state: EntityState = { code: obj.code }
	if (typeof obj.isOn === 'boolean') state.isOn = obj.isOn
	if (typeof obj.level === 'number' && Number.isFinite(obj.level)) state.level = obj.level
	if (typeof obj.choice === 'string') state.choice = obj.choice
	if (typeof obj.text === 'string') state.text = obj.text
	return state
}

export function parseStates(raw: unknown): EntityState[] | null {
	if (!raw || typeof raw !== 'object') return null
	const states = (raw as { states?: unknown }).states
	if (!Array.isArray(states)) return null
	return states.map(parseStateEntry).filter((s): s is EntityState => s !== null)
}

export function parseDeviceInfo(raw: unknown): DeviceInfo | null {
	if (!raw || typeof raw !== 'object') return null
	const obj = raw as Record<string, unknown>
	const protocolVersion = typeof obj.protocolVersion === 'number' ? obj.protocolVersion : NaN
	if (!Number.isFinite(protocolVersion)) return null

	return {
		protocolVersion,
		serial: typeof obj.serial === 'string' ? obj.serial : '',
		product: typeof obj.product === 'string' ? obj.product : typeof obj.productName === 'string' ? obj.productName : '',
		deviceName: typeof obj.deviceName === 'string' ? obj.deviceName : typeof obj.name === 'string' ? obj.name : '',
		softwareVersion:
			typeof obj.softwareVersion === 'string'
				? obj.softwareVersion
				: typeof obj.version === 'string'
					? obj.version
					: '',
	}
}

function optionalFiniteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null
}

function optionalString(value: unknown): string {
	if (typeof value === 'string') return value
	if (value === null || value === undefined) return ''
	return ''
}

export function parseDeviceStatus(raw: unknown): DeviceStatus | null {
	if (!raw || typeof raw !== 'object') return null
	const obj = raw as Record<string, unknown>

	// Accept Integration `/info` health payloads (and older shapes that used nickname/appVersion).
	if (
		typeof obj.hostName !== 'string' &&
		typeof obj.deviceNickname !== 'string' &&
		typeof obj.appVersion !== 'string' &&
		typeof obj.showName !== 'string' &&
		typeof obj.protocolVersion !== 'number' &&
		typeof obj.playerCode !== 'string' &&
		typeof obj.playerName !== 'string' &&
		typeof obj.recorder !== 'string'
	) {
		return null
	}

	return {
		hostName: optionalString(obj.hostName),
		deviceNickname: optionalString(obj.deviceNickname),
		appVersion: optionalString(obj.appVersion),
		showName: optionalString(obj.showName),
		sysCpuUsage: optionalFiniteNumber(obj.sysCpuUsage),
		appCpuUsage: optionalFiniteNumber(obj.appCpuUsage),
		sysMemoryUsageMB: optionalFiniteNumber(obj.sysMemoryUsageMB),
		sysMemoryTotalMB: optionalFiniteNumber(obj.sysMemoryTotalMB),
		appMemoryUsageMB: optionalFiniteNumber(obj.appMemoryUsageMB),
		storageUsageMB: optionalFiniteNumber(obj.storageUsageMB),
		storageTotalMB: optionalFiniteNumber(obj.storageTotalMB),
		cpuTemperatureC: optionalFiniteNumber(obj.cpuTemperatureC),
		boardTemperatureC: optionalFiniteNumber(obj.boardTemperatureC),
		audioAvailable: optionalBoolean(obj.audioAvailable),
		networkSpeedMbit: optionalFiniteNumber(obj.networkSpeedMbit),
		playerName: optionalString(obj.playerName),
		playerCode: optionalString(obj.playerCode),
		appUpTimeH: optionalFiniteNumber(obj.appUpTimeH),
		sysUpTimeH: optionalFiniteNumber(obj.sysUpTimeH),
		recorder: optionalString(obj.recorder),
	}
}

export function entitiesOfKind(entities: Iterable<IntegrationEntity>, kind: EntityKind): IntegrationEntity[] {
	return [...entities].filter((entity) => entity.kind === kind)
}

export function entityChoices(
	entities: Iterable<IntegrationEntity>,
	kind: EntityKind,
	fallbackLabel = 'No entities yet — refresh catalog',
	options?: { includeCode?: boolean },
): DropdownChoice<string>[] {
	const list = entitiesOfKind(entities, kind)
	if (list.length === 0) {
		return [{ id: '', label: fallbackLabel }]
	}
	const includeCode = options?.includeCode !== false
	return list.map((entity) => ({
		id: entity.code,
		label: includeCode ? `${entity.name} (${entity.code})` : entity.name,
	}))
}

export function choiceDropdown(choices: string[] | undefined): DropdownChoice<string>[] {
	if (!choices || choices.length === 0) {
		return [{ id: '', label: 'No choices' }]
	}
	return choices.map((choice) => ({ id: choice, label: choice }))
}

/** Unique choice strings from every select, in catalog order. */
export function allSelectChoices(entities: Iterable<IntegrationEntity>): string[] {
	const seen = new Set<string>()
	const choices: string[] = []
	for (const entity of entities) {
		if (entity.kind !== 'select' || !entity.choices) continue
		for (const choice of entity.choices) {
			if (seen.has(choice)) continue
			seen.add(choice)
			choices.push(choice)
		}
	}
	return choices
}

export function entityVariableId(kind: EntityKind, code: string): string {
	const safe = code
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
	switch (kind) {
		case 'scene':
			return `scene_${safe || 'entity'}`
		case 'switch':
			return `switch_${safe || 'entity'}`
		case 'level':
			return `level_${safe || 'entity'}`
		case 'select':
			return `select_${safe || 'entity'}`
		case 'button':
			return `button_${safe || 'entity'}`
		case 'sensor':
			return `sensor_${safe || 'entity'}`
		default:
			return assertNever(kind)
	}
}

export function entityVariableName(entity: IntegrationEntity): string {
	switch (entity.kind) {
		case 'scene':
			return `Scene ${entity.name}`
		case 'switch':
			return `Switch ${entity.name}`
		case 'level':
			return `Level ${entity.name} (%)`
		case 'select':
			return `Select ${entity.name}`
		case 'button':
			return `Button ${entity.name}`
		case 'sensor':
			return `Sensor ${entity.name}`
		default:
			return assertNever(entity.kind)
	}
}
