import type { CompanionPresetDefinitions, CompanionPresetSection, CompanionTextSize } from '@companion-module/base'
import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import { Colors, PLAYBACK_DEFAULT, SYSTEM_AUDIO_VOLUME, SYSTEM_MASTER, SYSTEM_STOP } from './constants.js'
import type { IntegrationEntity } from './entities.js'
import { entitiesOfKind } from './entities.js'

/** Fixed size so labels stay readable without auto upsizing that mid-word wraps. */
const PRESET_TEXT_SIZE: CompanionTextSize = '14'

function buttonStyle(
	text: string,
	bgcolor: number,
	color: number = Colors.White,
): {
	text: string
	size: CompanionTextSize
	color: number
	bgcolor: number
	show_topbar: false
} {
	return {
		text,
		size: PRESET_TEXT_SIZE,
		color,
		bgcolor,
		show_topbar: false,
	}
}

function shortLabel(entity: IntegrationEntity, max = 22): string {
	const name = entity.name.trim() || entity.code
	if (name.length <= max) return name
	return `${name.slice(0, max - 1)}…`
}

function presetId(prefix: string, code: string): string {
	const safe = code
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
	return `${prefix}_${safe || 'entity'}`
}

function varRef(label: string, name: string): string {
	return `$(${label}:${name})`
}

function isAudioVolumeEntity(entity: IntegrationEntity): boolean {
	if (entity.kind !== 'level') return false
	if (entity.code.toLowerCase() === SYSTEM_AUDIO_VOLUME) return true
	const hay = `${entity.code} ${entity.name}`.toLowerCase()
	return /audio\s*volume|audiovolume|audio\.volume/.test(hay)
}

function findAudioVolume(levels: IntegrationEntity[]): IntegrationEntity | undefined {
	return (
		levels.find((level) => level.code.toLowerCase() === SYSTEM_AUDIO_VOLUME) ??
		levels.find((level) => isAudioVolumeEntity(level))
	)
}

function scenePlaybackKind(code: string): 'cue' | 'timeline' | 'sound' {
	const prefix = code.split('.')[0]?.toLowerCase() ?? ''
	switch (prefix) {
		case 'timeline':
			return 'timeline'
		case 'sound':
			return 'sound'
		case 'cue':
		default:
			return 'cue'
	}
}

export function UpdatePresets(self: ModuleInstance): void {
	const label = self.label || 'dmxcore'
	const entities = [...self.state.entities.values()]
	const scenes = entitiesOfKind(entities, 'scene')
	const switches = entitiesOfKind(entities, 'switch')
	const buttons = entitiesOfKind(entities, 'button')
	const levels = entitiesOfKind(entities, 'level')

	const stopCode = self.state.entities.has(SYSTEM_STOP) ? SYSTEM_STOP : 'system.stop'
	const masterCode = self.state.entities.has(SYSTEM_MASTER) ? SYSTEM_MASTER : 'system.masterdimmer'

	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		now_playing: {
			type: 'simple',
			name: 'Now Playing',
			keywords: ['status', 'sensor', 'now playing', 'stopped'],
			style: buttonStyle(varRef(label, 'now_playing'), Colors.Stopped),
			steps: [
				{
					down: [{ actionId: 'refreshCatalog', options: {} }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'nowPlaying',
					options: {},
					style: { bgcolor: Colors.Playing, color: Colors.White },
				},
			],
		},
		stop_button: {
			type: 'simple',
			name: 'Stop Playback',
			keywords: ['stop', 'button', 'playback'],
			style: buttonStyle('Stop\nPlayback', Colors.Stop),
			steps: [
				{
					down: [{ actionId: 'activateButton', options: { code: stopCode } }],
					up: [],
				},
			],
			feedbacks: [],
		},
		master_0: {
			type: 'simple',
			name: 'Master 0%',
			style: buttonStyle('Master\n0%', Colors.MasterOff),
			steps: [
				{
					down: [{ actionId: 'setLevel', options: { code: masterCode, percent: 0 } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'levelAtMost',
					options: { code: masterCode, percent: 0 },
					style: { bgcolor: Colors.Master, color: Colors.Black },
				},
			],
		},
		master_50: {
			type: 'simple',
			name: 'Master 50%',
			style: buttonStyle('Master\n50%', Colors.Master),
			steps: [
				{
					down: [{ actionId: 'setLevel', options: { code: masterCode, percent: 50 } }],
					up: [],
				},
			],
			feedbacks: [],
		},
		master_100: {
			type: 'simple',
			name: 'Master 100%',
			style: buttonStyle('Master\n100%', Colors.Master),
			steps: [
				{
					down: [{ actionId: 'setLevel', options: { code: masterCode, percent: 100 } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'levelAtLeast',
					options: { code: masterCode, percent: 100 },
					style: { bgcolor: Colors.Playing, color: Colors.White },
				},
			],
		},
		master_encoder: {
			type: 'simple',
			name: 'Master Dimmer',
			keywords: ['master', 'dimmer', 'encoder', 'rotary'],
			style: buttonStyle(`Master\nDimmer\n${varRef(label, 'master_percent')}`, Colors.Master, Colors.Black),
			options: { stepAutoProgress: false },
			steps: [
				{
					down: [{ actionId: 'setLevel', options: { code: masterCode, percent: 100 } }],
					up: [],
					rotate_left: [{ actionId: 'bumpLevel', options: { code: masterCode, deltaPercent: -5 } }],
					rotate_right: [{ actionId: 'bumpLevel', options: { code: masterCode, deltaPercent: 5 } }],
				},
			],
			feedbacks: [],
		},
		refresh: {
			type: 'simple',
			name: 'Refresh Playback objects',
			style: buttonStyle('Refresh\nPlayback\nobjects', Colors.Device),
			steps: [
				{
					down: [{ actionId: 'refreshCatalog', options: {} }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'connectionOk',
					options: {},
					style: { bgcolor: Colors.Playing, color: Colors.White },
				},
			],
		},
	}

	const cuePresetIds: string[] = []
	const timelinePresetIds: string[] = []
	const soundPresetIds: string[] = []

	for (const scene of scenes) {
		const kind = scenePlaybackKind(scene.code)
		const id = presetId(kind === 'timeline' ? 'timeline' : kind === 'sound' ? 'sound' : 'scene', scene.code)
		const groupIds = kind === 'timeline' ? timelinePresetIds : kind === 'sound' ? soundPresetIds : cuePresetIds
		groupIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Play ${scene.name}`,
			keywords: [kind, 'scene', 'play', scene.code],
			style: buttonStyle(shortLabel(scene), kind === 'timeline' ? Colors.Effect : Colors.Play),
			steps: [
				{
					down: [
						{
							actionId: 'activateScene',
							options: {
								code: scene.code,
								loop: PLAYBACK_DEFAULT,
								fadeInMs: PLAYBACK_DEFAULT,
								fadeOutMs: PLAYBACK_DEFAULT,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'nowPlayingMatches',
					options: { code: scene.code },
					style: { bgcolor: Colors.Playing, color: Colors.White },
				},
			],
		}
	}

	if (cuePresetIds.length === 0 && timelinePresetIds.length === 0 && soundPresetIds.length === 0) {
		presets.activate_scene = {
			type: 'simple',
			name: 'Activate Scene',
			keywords: ['scene', 'cue', 'play'],
			style: buttonStyle('Scene', Colors.Play),
			steps: [
				{
					down: [
						{
							actionId: 'activateScene',
							options: {
								code: 'cue.INTRO',
								loop: PLAYBACK_DEFAULT,
								fadeInMs: PLAYBACK_DEFAULT,
								fadeOutMs: PLAYBACK_DEFAULT,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		}
		cuePresetIds.push('activate_scene')
	}

	const switchPresetIds: string[] = []
	for (const sw of switches) {
		const id = presetId('switch', sw.code)
		switchPresetIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Toggle ${sw.name}`,
			keywords: ['switch', 'toggle', sw.code],
			style: buttonStyle(shortLabel(sw), Colors.Preset),
			steps: [
				{
					down: [{ actionId: 'switchEntity', options: { code: sw.code, command: 'toggle' } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'switchOn',
					options: { code: sw.code },
					style: { bgcolor: Colors.SwitchOn, color: Colors.Black },
				},
			],
		}
	}

	const buttonPresetIds: string[] = []
	for (const button of buttons) {
		if (button.code === stopCode) continue
		const id = presetId('button', button.code)
		buttonPresetIds.push(id)
		presets[id] = {
			type: 'simple',
			name: button.name,
			keywords: ['button', button.code],
			style: buttonStyle(shortLabel(button), Colors.Device),
			steps: [
				{
					down: [{ actionId: 'activateButton', options: { code: button.code } }],
					up: [],
				},
			],
			feedbacks: [],
		}
	}

	const audioVolume = findAudioVolume(levels)
	const audioVolumeCode = audioVolume?.code

	if (audioVolume && audioVolumeCode) {
		presets.audio_volume_encoder = {
			type: 'simple',
			name: 'Audio Volume',
			keywords: ['audio', 'volume', 'encoder', 'rotary', audioVolumeCode],
			style: buttonStyle(`Audio\nVolume\n${varRef(label, 'audio_volume_percent')}`, Colors.Master, Colors.Black),
			options: { stepAutoProgress: false },
			steps: [
				{
					down: [{ actionId: 'setLevel', options: { code: audioVolumeCode, percent: 100 } }],
					up: [],
					rotate_left: [{ actionId: 'bumpLevel', options: { code: audioVolumeCode, deltaPercent: -5 } }],
					rotate_right: [{ actionId: 'bumpLevel', options: { code: audioVolumeCode, deltaPercent: 5 } }],
				},
			],
			feedbacks: [],
		}
	}

	const levelPresetIds: string[] = []
	for (const level of levels) {
		if (level.code === masterCode) continue
		if (audioVolumeCode && level.code === audioVolumeCode) continue
		const id = presetId('level', level.code)
		levelPresetIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `${level.name} 100%`,
			keywords: ['level', level.code],
			style: buttonStyle(`${shortLabel(level)}\n100%`, Colors.Master),
			steps: [
				{
					down: [{ actionId: 'setLevel', options: { code: level.code, percent: 100 } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'levelAtLeast',
					options: { code: level.code, percent: 100 },
					style: { bgcolor: Colors.Playing, color: Colors.White },
				},
			],
		}
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'playback',
			name: 'Playback',
			description: 'Scenes, timelines, and sounds from the live catalog.',
			definitions: [
				...(cuePresetIds.length
					? [{ id: 'scenes', type: 'simple' as const, name: 'Scenes', presets: cuePresetIds }]
					: []),
				...(timelinePresetIds.length
					? [{ id: 'timelines', type: 'simple' as const, name: 'Timelines', presets: timelinePresetIds }]
					: []),
				...(soundPresetIds.length
					? [{ id: 'sounds', type: 'simple' as const, name: 'Sounds', presets: soundPresetIds }]
					: []),
			],
		},
	]

	structure.push({
		id: 'looks',
		name: 'Looks & buttons',
		definitions: [
			{
				id: 'control',
				type: 'simple',
				name: 'Control',
				presets: [...switchPresetIds, 'stop_button'],
			},
			...(buttonPresetIds.length
				? [{ id: 'buttons', type: 'simple' as const, name: 'Buttons', presets: buttonPresetIds }]
				: []),
		],
	})

	const rotaryPresets = ['master_encoder', ...(audioVolumeCode ? (['audio_volume_encoder'] as const) : [])]

	structure.push({
		id: 'master',
		name: 'Levels',
		definitions: [
			{
				id: 'rotary',
				type: 'simple',
				name: 'Rotary',
				presets: [...rotaryPresets],
			},
			{
				id: 'master',
				type: 'simple',
				name: 'Master dimmer',
				presets: ['master_0', 'master_50', 'master_100'],
			},
			...(levelPresetIds.length
				? [{ id: 'other_levels', type: 'simple' as const, name: 'Other levels', presets: levelPresetIds }]
				: []),
		],
	})

	structure.push({
		id: 'device',
		name: 'Device',
		definitions: [
			{
				id: 'status',
				type: 'simple',
				name: 'Status',
				presets: ['now_playing', 'refresh'],
			},
		],
	})

	self.setPresetDefinitions(structure, presets)
}
