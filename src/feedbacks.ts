import type { CompanionFeedbackDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { Colors } from './constants.js'
import { entityChoices } from './entities.js'
import {
	getLevel,
	isNowPlaying,
	isSwitchOff,
	isSwitchOn,
	nowPlayingMatchesEntity,
	selectChoice,
	sensorText,
} from './state.js'
import { percentToLevel } from './util.js'

export type FeedbacksSchema = {
	connectionOk: {
		type: 'boolean'
		options: Record<string, never>
	}
	nowPlaying: {
		type: 'boolean'
		options: Record<string, never>
	}
	nowPlayingMatches: {
		type: 'boolean'
		options: { code: string }
	}
	switchOn: {
		type: 'boolean'
		options: { code: string }
	}
	switchOff: {
		type: 'boolean'
		options: { code: string }
	}
	levelAtLeast: {
		type: 'boolean'
		options: { code: string; percent: number }
	}
	levelAtMost: {
		type: 'boolean'
		options: { code: string; percent: number }
	}
	choiceEquals: {
		type: 'boolean'
		options: { code: string; choice: string }
	}
	sensorContains: {
		type: 'boolean'
		options: { code: string; text: string }
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const scenes = entityChoices(self.state.entities.values(), 'scene')
	const switches = entityChoices(self.state.entities.values(), 'switch')
	const levels = entityChoices(self.state.entities.values(), 'level')
	const selects = entityChoices(self.state.entities.values(), 'select')
	const sensors = entityChoices(self.state.entities.values(), 'sensor')

	const feedbacks: CompanionFeedbackDefinitions<FeedbacksSchema> = {
		connectionOk: {
			name: 'Connection OK',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.Playing,
				color: Colors.White,
			},
			options: [],
			callback: () => self.state.connected,
		},
		nowPlaying: {
			name: 'Something is playing',
			description: 'True when the now-playing sensor has text (idle shows as Stopped on the variable).',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.Playing,
				color: Colors.White,
			},
			options: [],
			callback: () => isNowPlaying(self.state),
		},
		nowPlayingMatches: {
			name: 'Now playing matches scene',
			description:
				'True when system.nowplaying text matches the scene’s catalog name or code suffix as a whole token (e.g. Cue: INTRO, not Cue: INTRO2).',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.Playing,
				color: Colors.White,
			},
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Scene',
					default: scenes[0]?.id ?? '',
					choices: scenes,
					allowCustom: true,
				},
			],
			callback: (feedback) => {
				const code = String(feedback.options.code ?? '').trim()
				if (!code) return false
				return nowPlayingMatchesEntity(self.state, code)
			},
		},
		switchOn: {
			name: 'Switch is on',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.SwitchOn,
				color: Colors.Black,
			},
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Switch',
					default: switches[0]?.id ?? '',
					choices: switches,
					allowCustom: true,
				},
			],
			callback: (feedback) => isSwitchOn(self.state, String(feedback.options.code ?? '').trim()),
		},
		switchOff: {
			name: 'Switch is off',
			description: 'True only when the device has reported off. Missing / unknown state does not light this feedback.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.Stopped,
				color: Colors.White,
			},
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Switch',
					default: switches[0]?.id ?? '',
					choices: switches,
					allowCustom: true,
				},
			],
			callback: (feedback) => {
				const code = String(feedback.options.code ?? '').trim()
				if (!code) return false
				return isSwitchOff(self.state, code)
			},
		},
		levelAtLeast: {
			name: 'Level at least',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.Master,
				color: Colors.Black,
			},
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Level',
					default: levels[0]?.id ?? '',
					choices: levels,
					allowCustom: true,
				},
				{
					id: 'percent',
					type: 'number',
					label: 'Percent',
					default: 100,
					min: 0,
					max: 100,
				},
			],
			callback: (feedback) => {
				const code = String(feedback.options.code ?? '').trim()
				const level = getLevel(self.state, code)
				if (level === null) return false
				return level + 1e-6 >= percentToLevel(Number(feedback.options.percent))
			},
		},
		levelAtMost: {
			name: 'Level at most',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.MasterOff,
				color: Colors.White,
			},
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Level',
					default: levels[0]?.id ?? '',
					choices: levels,
					allowCustom: true,
				},
				{
					id: 'percent',
					type: 'number',
					label: 'Percent',
					default: 0,
					min: 0,
					max: 100,
				},
			],
			callback: (feedback) => {
				const code = String(feedback.options.code ?? '').trim()
				const level = getLevel(self.state, code)
				if (level === null) return false
				return level - 1e-6 <= percentToLevel(Number(feedback.options.percent))
			},
		},
		choiceEquals: {
			name: 'Select choice equals',
			description: 'Case-insensitive match against the device’s current choice (Core returns catalog canonical form).',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.Preset,
				color: Colors.White,
			},
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Select',
					default: selects[0]?.id ?? '',
					choices: selects,
					allowCustom: true,
				},
				{
					id: 'choice',
					type: 'textinput',
					label: 'Choice',
					default: '',
					useVariables: true,
				},
			],
			callback: (feedback) => {
				const code = String(feedback.options.code ?? '').trim()
				const expected = String(feedback.options.choice ?? '').trim()
				if (!code || !expected) return false
				return selectChoice(self.state, code).toLowerCase() === expected.toLowerCase()
			},
		},
		sensorContains: {
			name: 'Sensor text contains',
			type: 'boolean',
			defaultStyle: {
				bgcolor: Colors.Play,
				color: Colors.White,
			},
			options: [
				{
					id: 'code',
					type: 'dropdown',
					label: 'Sensor',
					default: sensors[0]?.id ?? '',
					choices: sensors,
					allowCustom: true,
				},
				{
					id: 'text',
					type: 'textinput',
					label: 'Contains',
					default: '',
					useVariables: true,
				},
			],
			callback: (feedback) => {
				const code = String(feedback.options.code ?? '').trim()
				const needle = String(feedback.options.text ?? '')
					.trim()
					.toLowerCase()
				if (!code || !needle) return false
				return sensorText(self.state, code).toLowerCase().includes(needle)
			},
		},
	}

	self.setFeedbackDefinitions(feedbacks)
}
