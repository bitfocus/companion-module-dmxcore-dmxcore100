import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBaseUrl, buildWsUrl } from './api.js'
import {
	allSelectChoices,
	entityVariableId,
	parseDeviceInfo,
	parseDeviceStatus,
	parseEntities,
	parseStates,
} from './entities.js'
import {
	applyStates,
	createInitialState,
	isSwitchOff,
	isSwitchOn,
	nowPlayingMatchesEntity,
	replaceCatalog,
	variableValuesFromState,
} from './state.js'
import { formatPercent, formatPercentUnit, percentToLevel } from './util.js'

void test('builds Integration API URLs', () => {
	const config = { host: '10.0.0.5', port: 80, useHttps: false, allowInsecureTls: false }
	assert.equal(buildBaseUrl(config), 'http://10.0.0.5:80/api/integration/v1')
	assert.equal(buildWsUrl(config), 'ws://10.0.0.5:80/api/integration/v1/events')

	const desktopPort = { ...config, port: 8000 }
	assert.equal(buildBaseUrl(desktopPort), 'http://10.0.0.5:8000/api/integration/v1')

	const tls = { ...config, useHttps: true, port: 443 }
	assert.equal(buildBaseUrl(tls), 'https://10.0.0.5:443/api/integration/v1')
	assert.equal(buildWsUrl(tls), 'wss://10.0.0.5:443/api/integration/v1/events')

	const ipv6 = { ...config, host: '2001:db8::1' }
	assert.equal(buildBaseUrl(ipv6), 'http://[2001:db8::1]:80/api/integration/v1')
	assert.equal(buildWsUrl(ipv6), 'ws://[2001:db8::1]:80/api/integration/v1/events')

	const ipv6Bracketed = { ...config, host: '[2001:db8::1]' }
	assert.equal(buildBaseUrl(ipv6Bracketed), 'http://[2001:db8::1]:80/api/integration/v1')
})

void test('parses catalog entities and rejects unknown kinds', () => {
	const entities = parseEntities({
		entities: [
			{ code: 'cue.INTRO', name: 'Intro', kind: 'scene' },
			{ code: 'preset.PARTY', name: 'Party', kind: 'switch' },
			{ code: 'system.masterdimmer', name: 'Master', kind: 'level' },
			{ code: 'bad', name: 'Bad', kind: 'nope' },
			{ code: '', name: 'Empty', kind: 'button' },
		],
	})

	assert.equal(entities.length, 3)
	assert.equal(entities[0]?.code, 'cue.INTRO')
	assert.equal(entities[1]?.kind, 'switch')
	assert.equal(entities[2]?.kind, 'level')
})

void test('parses device info and /info status snapshot', () => {
	const info = parseDeviceInfo({
		protocolVersion: 1,
		serial: 'ABC',
		productName: 'DMX Core 100',
		deviceName: 'FOH',
		softwareVersion: '2.0.0',
	})
	assert.equal(info?.protocolVersion, 1)
	assert.equal(info?.product, 'DMX Core 100')
	assert.equal(info?.deviceName, 'FOH')

	const status = parseDeviceStatus({
		protocolVersion: 1,
		serial: 'ABC',
		productName: 'DMX Core 100',
		deviceName: 'FOH',
		softwareVersion: 'balena.2026.909.1',
		hostName: '9a9dfde',
		showName: 'Mandylights',
		sysCpuUsage: 65.1,
		cpuTemperatureC: 59.4,
		boardTemperatureC: 47.0,
		audioAvailable: true,
		playerName: null,
		playerCode: 'INTRO',
		recorder: 'INACTIVE',
	})
	assert.equal(status?.showName, 'Mandylights')
	assert.equal(status?.hostName, '9a9dfde')
	assert.equal(status?.cpuTemperatureC, 59.4)
	assert.equal(status?.playerName, '')
	assert.equal(status?.playerCode, 'INTRO')
	assert.equal(status?.audioAvailable, true)

	const states = parseStates({
		states: [
			{ code: 'system.masterdimmer', level: 0.4 },
			{ code: 'preset.PARTY', isOn: true },
			{ code: 'system.nowplaying', text: 'Cue: Intro' },
		],
	})
	assert.ok(states)
	assert.equal(states.length, 3)
	assert.equal(states[0]?.level, 0.4)
	assert.equal(states[1]?.isOn, true)
	assert.equal(states[2]?.text, 'Cue: Intro')
	assert.equal(parseStates({ states: 'nope' }), null)
	assert.equal(parseStates(null), null)
})

void test('applies catalog and state into variables', () => {
	const state = createInitialState()
	state.info = {
		protocolVersion: 1,
		serial: 'ABC',
		product: 'DMX Core 100',
		deviceName: 'FOH',
		softwareVersion: '2.0.0',
	}
	state.status = {
		hostName: 'core-foh',
		deviceNickname: 'FOH Rack',
		appVersion: 'balena.2026.909.1',
		showName: 'Mandylights',
		sysCpuUsage: 10,
		appCpuUsage: 5,
		sysMemoryUsageMB: 900,
		sysMemoryTotalMB: 4000,
		appMemoryUsageMB: 700,
		storageUsageMB: 1000,
		storageTotalMB: 28000,
		cpuTemperatureC: 50.5,
		boardTemperatureC: 40,
		audioAvailable: true,
		networkSpeedMbit: 1000,
		playerName: '',
		playerCode: '',
		appUpTimeH: 2.5,
		sysUpTimeH: 10,
		recorder: 'INACTIVE',
	}
	state.connected = true

	replaceCatalog(state, [
		{ code: 'system.masterdimmer', name: 'Master', kind: 'level' },
		{ code: 'preset.PARTY', name: 'Party', kind: 'switch' },
		{ code: 'system.nowplaying', name: 'Now Playing', kind: 'sensor' },
		{ code: 'cv.Mode', name: 'Mode', kind: 'select', choices: ['A', 'B'] },
		{ code: 'cue.INTRO', name: 'Intro', kind: 'scene' },
	])

	applyStates(
		state,
		[
			{ code: 'system.masterdimmer', level: 0.25 },
			{ code: 'preset.PARTY', isOn: true },
			{ code: 'system.nowplaying', text: 'Cue: INTRO' },
			{ code: 'cv.Mode', choice: 'B' },
		],
		true,
	)

	const values = variableValuesFromState(state)
	assert.equal(values.device_name, 'FOH Rack')
	assert.equal(values.show_name, 'Mandylights')
	assert.equal(values.hostname, 'core-foh')
	assert.equal(values.cpu_temp_c, '50.5')
	assert.equal(values.connected, 'true')
	assert.equal(values.now_playing, 'Cue: INTRO')
	assert.equal(values.master_percent, '25%')
	assert.equal(values.audio_volume_percent, '')
	assert.equal(values[entityVariableId('level', 'system.masterdimmer')], '25%')
	assert.equal(values[entityVariableId('switch', 'preset.PARTY')], 'on')
	assert.equal(values[entityVariableId('select', 'cv.Mode')], 'B')
	assert.equal(values[entityVariableId('sensor', 'system.nowplaying')], 'Cue: INTRO')
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO'), true)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.OUTRO'), false)

	applyStates(state, [{ code: 'system.nowplaying', text: '' }], false)
	assert.equal(variableValuesFromState(state).now_playing, 'Stopped')
})

void test('now-playing match keeps cue and sound codes distinct', () => {
	const state = createInitialState()
	replaceCatalog(state, [
		{ code: 'cue.INTRO', name: 'Intro', kind: 'scene' },
		{ code: 'sound.INTRO', name: 'Intro', kind: 'scene' },
		{ code: 'system.nowplaying', name: 'Now Playing', kind: 'sensor' },
	])

	applyStates(state, [{ code: 'system.nowplaying', text: 'Cue: INTRO' }], true)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO'), true)
	assert.equal(nowPlayingMatchesEntity(state, 'sound.INTRO'), false)

	applyStates(state, [{ code: 'system.nowplaying', text: 'Sound: INTRO' }], true)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO'), false)
	assert.equal(nowPlayingMatchesEntity(state, 'sound.INTRO'), true)
})

void test('now-playing match does not treat overlapping codes as substrings', () => {
	const state = createInitialState()
	replaceCatalog(state, [
		{ code: 'cue.INTRO', name: 'Intro', kind: 'scene' },
		{ code: 'cue.INTRO2', name: 'Intro 2', kind: 'scene' },
		{ code: 'system.nowplaying', name: 'Now Playing', kind: 'sensor' },
	])

	applyStates(state, [{ code: 'system.nowplaying', text: 'Cue: INTRO2' }], true)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO'), false)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO2'), true)

	applyStates(state, [{ code: 'system.nowplaying', text: 'Cue: INTRO' }], true)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO'), true)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO2'), false)

	applyStates(state, [{ code: 'system.nowplaying', text: 'Cue: INTRO (loop)' }], true)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO'), true)
	assert.equal(nowPlayingMatchesEntity(state, 'cue.INTRO2'), false)
})

void test('pools unique select choices in catalog order', () => {
	assert.deepEqual(
		allSelectChoices([
			{ code: 'cv.Mode', name: 'Mode', kind: 'select', choices: ['A', 'B'] },
			{ code: 'cv.Look', name: 'Look', kind: 'select', choices: ['B', 'C'] },
			{ code: 'cue.INTRO', name: 'Intro', kind: 'scene' },
			{ code: 'cv.Empty', name: 'Empty', kind: 'select' },
		]),
		['A', 'B', 'C'],
	)
})

void test('treats missing switch state as unknown, not off', () => {
	const state = createInitialState()
	replaceCatalog(state, [
		{ code: 'system.blackout', name: 'Blackout', kind: 'switch' },
		{ code: 'system.mute', name: 'Mute', kind: 'switch' },
	])
	applyStates(state, [{ code: 'system.mute', isOn: false }], true)

	assert.equal(isSwitchOn(state, 'system.mute'), false)
	assert.equal(isSwitchOff(state, 'system.mute'), true)
	assert.equal(isSwitchOn(state, 'system.blackout'), false)
	assert.equal(isSwitchOff(state, 'system.blackout'), false)
	assert.equal(variableValuesFromState(state)[entityVariableId('switch', 'system.blackout')], '')
	assert.equal(variableValuesFromState(state)[entityVariableId('switch', 'system.mute')], 'off')
})

void test('merges partial state updates', () => {
	const state = createInitialState()
	replaceCatalog(state, [
		{ code: 'system.masterdimmer', name: 'Master', kind: 'level' },
		{ code: 'system.volume', name: 'Audio Volume', kind: 'level' },
	])
	applyStates(
		state,
		[
			{ code: 'system.masterdimmer', level: 0.5, isOn: true },
			{ code: 'system.volume', level: 0.8 },
		],
		true,
	)
	applyStates(state, [{ code: 'system.masterdimmer', level: 0.25 }], false)
	assert.equal(state.states.get('system.masterdimmer')?.level, 0.25)
	assert.equal(state.states.get('system.masterdimmer')?.isOn, true)
	assert.equal(state.states.get('system.volume')?.level, 0.8)
	assert.equal(variableValuesFromState(state).audio_volume_percent, '80%')
})

void test('full state replace wipes previous entities', () => {
	const state = createInitialState()
	applyStates(
		state,
		[
			{ code: 'system.masterdimmer', level: 1 },
			{ code: 'system.mute', isOn: true },
		],
		true,
	)
	applyStates(state, [{ code: 'system.mute', isOn: false }], true)
	assert.equal(state.states.size, 1)
	assert.equal(state.states.get('system.mute')?.isOn, false)
	assert.equal(state.states.has('system.masterdimmer'), false)
})

void test('converts percent levels for execute payloads', () => {
	assert.equal(percentToLevel(0), 0)
	assert.equal(percentToLevel(50), 0.5)
	assert.equal(percentToLevel(100), 1)
	assert.equal(formatPercent(0.255), '25.5')
	assert.equal(formatPercentUnit(null), '')
	assert.equal(formatPercentUnit(0.5), '50%')
	assert.equal(formatPercentUnit(0), '0%')
	assert.equal(entityVariableId('level', 'system.masterdimmer'), 'level_system_masterdimmer')
})
