export const DEFAULT_HTTP_PORT = 80
export const SUPPORTED_PROTOCOL_VERSION = 1
export const REQUEST_TIMEOUT_MS = 10000
export const WS_PING_INTERVAL_MS = 15000
export const WS_RECONNECT_MS = 3000
export const WS_RECONNECT_MAX_MS = 30000
/** How often to refresh Integration `/info` health fields (temps, CPU, show name, …). */
export const STATUS_POLL_MS = 30000

export const SYSTEM_MASTER = 'system.masterdimmer'
export const SYSTEM_STOP = 'system.stop'
export const SYSTEM_NOW_PLAYING = 'system.nowplaying'
/** Integration API code for the system audio volume level. */
export const SYSTEM_AUDIO_VOLUME = 'system.volume'
/** Sentinel: omit optional activate fields so the device uses Settings → Playback defaults. */
export const PLAYBACK_DEFAULT = -1

export const Colors = {
	White: 0xffffff,
	Black: 0x000000,
	Dark: 0x141414,
	Play: 0x1b4f72,
	Playing: 0x1e8449,
	Stop: 0x7b241c,
	Stopped: 0x922b21,
	Preset: 0x4a235a,
	Effect: 0xa04000,
	Master: 0xb9770e,
	MasterOff: 0x2c2c2c,
	Switch: 0x1a5276,
	SwitchOn: 0xf1c40f,
	Status: 0x17202a,
	Device: 0x1c2833,
} as const

export const EntityKinds = ['scene', 'switch', 'level', 'select', 'button', 'sensor'] as const
export type EntityKind = (typeof EntityKinds)[number]

export const SwitchCommands = ['turnOn', 'turnOff', 'toggle'] as const
export type SwitchCommand = (typeof SwitchCommands)[number]
