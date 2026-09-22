import type { CompanionActionDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { PLAYBACK_DEFAULT, SwitchCommands, type SwitchCommand } from './constants.js'
import { allSelectChoices, choiceDropdown, entityChoices, type ExecuteRequest } from './entities.js'
import { assertNever, clamp, percentToLevel } from './util.js'
import { getLevel } from './state.js'

export type ActionsSchema = {
	activateScene: {
		options: { code: string; loop: number; fadeInMs: number; fadeOutMs: number }
	}
	activateButton: { options: { code: string } }
	switchEntity: { options: { code: string; command: SwitchCommand } }
	setLevel: { options: { code: string; percent: number } }
	bumpLevel: { options: { code: string; deltaPercent: number } }
	setChoice: { options: { code: string; choice: string } }
	refreshCatalog: { options: Record<string, never> }
}

const levelField = {
	id: 'percent' as const,
	type: 'number' as const,
	label: 'Level (%)',
	default: 100,
	min: 0,
	max: 100,
	step: 0.1,
}

function switchCommandChoices(): { id: SwitchCommand; label: string }[] {
	return SwitchCommands.map((command) => ({ id: command, label: command }))
}

function supportsScenePlaybackOverrides(code: string): boolean {
	const prefix = code.split('.')[0]?.toLowerCase() ?? ''
	return prefix === 'cue' || prefix === 'sound'
}

function optionalPlaybackField(value: unknown): number | undefined {
	const n = Number(value)
	if (!Number.isFinite(n) || n < 0) return undefined
	return Math.trunc(n)
}

export function UpdateActions(self: ModuleInstance): void {
	const scenes = entityChoices(self.state.entities.values(), 'scene')
	const buttons = entityChoices(self.state.entities.values(), 'button', 'No system actions yet — refresh catalog', {
		includeCode: false,
	})
	const switches = entityChoices(self.state.entities.values(), 'switch')
	const levels = entityChoices(self.state.entities.values(), 'level')
	const selects = entityChoices(self.state.entities.values(), 'select')

	const defaultScene = scenes[0]?.id ?? ''
	const defaultButton = buttons[0]?.id ?? ''
	const defaultSwitch = switches[0]?.id ?? ''
	const defaultLevel = levels[0]?.id ?? ''
	const defaultSelect = selects[0]?.id ?? ''
	const choiceOptions = choiceDropdown(allSelectChoices(self.state.entities.values()))

	const actions: CompanionActionDefinitions<ActionsSchema> = {
		activateScene: {
			name: 'Activate scene',
			description:
				'Activate a scene (cue, timeline, sound, …). Optional Loop / Fade apply to cues and sounds only; leave at -1 to use Settings → Playback defaults. Timelines ignore these fields.',
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Scene',
					default: defaultScene,
					choices: scenes,
					allowCustom: true,
				},
				{
					id: 'loop',
					type: 'number',
					label: 'Loop (-1 = device default)',
					default: PLAYBACK_DEFAULT,
					min: PLAYBACK_DEFAULT,
					max: 9999,
					tooltip: 'Cue/sound only. 0 = forever, 1 = once, N = N times. -1 uses device defaults.',
				},
				{
					id: 'fadeInMs',
					type: 'number',
					label: 'Fade in ms (-1 = device default)',
					default: PLAYBACK_DEFAULT,
					min: PLAYBACK_DEFAULT,
					max: 600000,
					tooltip: 'Cue/sound only. 0 = none. -1 uses device defaults.',
				},
				{
					id: 'fadeOutMs',
					type: 'number',
					label: 'Fade out ms (-1 = device default)',
					default: PLAYBACK_DEFAULT,
					min: PLAYBACK_DEFAULT,
					max: 600000,
					tooltip: 'Cue/sound only. 0 = none. -1 uses device defaults.',
				},
			],
			callback: async (action) => {
				const code = String(action.options.code ?? '').trim()
				if (!code) return

				const request: ExecuteRequest = { code, command: 'activate' }
				if (supportsScenePlaybackOverrides(code)) {
					const loop = optionalPlaybackField(action.options.loop)
					const fadeInMs = optionalPlaybackField(action.options.fadeInMs)
					const fadeOutMs = optionalPlaybackField(action.options.fadeOutMs)
					if (loop !== undefined) request.loop = loop
					if (fadeInMs !== undefined) request.fadeInMs = fadeInMs
					if (fadeOutMs !== undefined) request.fadeOutMs = fadeOutMs
				}

				await self.execute(request)
			},
		},
		activateButton: {
			name: 'System actions',
			description:
				'Fire a system button such as Stop or Clear Ambient. Blackout, Mute, and Output mute are switches — use Switch entity instead.',
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Action',
					default: defaultButton,
					choices: buttons,
					allowCustom: true,
				},
			],
			callback: async (action) => {
				const code = String(action.options.code ?? '').trim()
				if (!code) return
				await self.execute({ code, command: 'activate' })
			},
		},
		switchEntity: {
			name: 'Switch entity',
			description: 'Turn on, turn off, or toggle a switch (preset, ambient, mute, blackout, …).',
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Switch',
					default: defaultSwitch,
					choices: switches,
					allowCustom: true,
				},
				{
					id: 'command',
					type: 'dropdown',
					label: 'Command',
					default: 'toggle',
					choices: switchCommandChoices(),
				},
			],
			callback: async (action) => {
				const code = String(action.options.code ?? '').trim()
				const command = action.options.command
				if (!code) return
				if (command !== 'turnOn' && command !== 'turnOff' && command !== 'toggle') {
					assertNever(command)
				}
				await self.execute({ code, command })
			},
		},
		setLevel: {
			name: 'Set level',
			description: 'Set a level entity (0–100%). Sent as 0–1 to the device.',
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Level',
					default: defaultLevel,
					choices: levels,
					allowCustom: true,
				},
				levelField,
			],
			callback: async (action) => {
				const code = String(action.options.code ?? '').trim()
				if (!code) return
				const percent = Number(action.options.percent)
				const level = percentToLevel(percent)
				await self.execute({ code, command: 'setLevel', level }, { preferWs: true })
			},
		},
		bumpLevel: {
			name: 'Bump level',
			description:
				'Adjust a level entity by a percentage delta from its current state. Local level updates as soon as the command is sent so rapid rotary ticks accumulate.',
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Level',
					default: defaultLevel,
					choices: levels,
					allowCustom: true,
				},
				{
					id: 'deltaPercent',
					type: 'number',
					label: 'Delta (%)',
					default: 5,
					min: -100,
					max: 100,
					step: 0.1,
				},
			],
			callback: async (action) => {
				const code = String(action.options.code ?? '').trim()
				if (!code) return
				const current = getLevel(self.state, code) ?? 0
				const nextPercent = clamp(current * 100 + Number(action.options.deltaPercent), 0, 100)
				const level = percentToLevel(nextPercent)
				await self.execute({ code, command: 'setLevel', level }, { preferWs: true })
			},
		},
		setChoice: {
			name: 'Set choice',
			description:
				'Set a select entity to one of its catalog choices. The Choice list is the union of choices from every select — type a custom value if a select’s option is missing.',
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Select',
					default: defaultSelect,
					choices: selects,
					allowCustom: true,
				},
				{
					id: 'choice',
					type: 'dropdown',
					label: 'Choice',
					default: choiceOptions[0]?.id ?? '',
					choices: choiceOptions,
					allowCustom: true,
					tooltip:
						'Choices are pooled from every select in the catalog. Type the exact choice if it is missing from the list.',
				},
			],
			callback: async (action) => {
				const code = String(action.options.code ?? '').trim()
				const choice = String(action.options.choice ?? '').trim()
				if (!code || !choice) return
				await self.execute({ code, command: 'setChoice', choice })
			},
		},
		refreshCatalog: {
			name: 'Refresh catalog',
			description: 'Re-fetch catalog, state, and /info health snapshot over HTTP.',
			options: [],
			callback: async () => {
				await self.refreshCatalog()
			},
		},
	}

	self.setActionDefinitions(actions)
}
