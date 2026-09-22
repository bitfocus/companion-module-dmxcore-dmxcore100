import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { variableDefinitionsFromState, variableValuesFromState } from './state.js'

export type VariablesSchema = {
	product: string
	device_name: string
	serial: string
	software_version: string
	protocol_version: string
	connected: string
	now_playing: string
	master_percent: string
	master_level: string
	audio_volume_percent: string
	entity_count: string
	show_name: string
	hostname: string
	app_version: string
	cpu_temp_c: string
	board_temp_c: string
	sys_cpu_percent: string
	app_cpu_percent: string
	sys_memory_mb: string
	sys_memory_total_mb: string
	app_memory_mb: string
	storage_mb: string
	storage_total_mb: string
	network_speed_mbit: string
	audio_available: string
	app_uptime_h: string
	sys_uptime_h: string
	recorder: string
	player_name: string
	player_code: string
	[id: string]: string | number | undefined
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions = variableDefinitionsFromState(self.state)
	self.setVariableDefinitions(definitions as CompanionVariableDefinitions<VariablesSchema>)
	self.setVariableValues(variableValuesFromState(self.state))
}
