import type { SomeCompanionConfigField } from '@companion-module/base'
import { DEFAULT_HTTP_PORT } from './constants.js'

export type ModuleConfig = {
	host: string
	port: number
	useHttps: boolean
	allowInsecureTls: boolean
}

export type ModuleSecrets = {
	apiKey: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Connection',
			width: 12,
			value:
				'Uses the DMX Core Integration API. On the device: Device → System → Enable Integration API, then Issue Integration API Key. Paste the key below. No OSC Client registration is required. Port: hardware often 80/443; desktop software 8000/8001 (same as the Web UI).',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'DMX Core IP / hostname',
			width: 8,
			default: '',
		},
		{
			type: 'number',
			id: 'port',
			label: 'HTTP(S) port',
			width: 4,
			min: 1,
			max: 65535,
			default: DEFAULT_HTTP_PORT,
			tooltip:
				'Hardware units often use HTTP 80 / HTTPS 443. Desktop software defaults are HTTP 8000 / HTTPS 8001. Match the port you use for the Web UI.',
		},
		{
			type: 'checkbox',
			id: 'useHttps',
			label: 'Use HTTPS',
			width: 6,
			default: false,
			disableAutoExpression: true,
		},
		{
			type: 'checkbox',
			id: 'allowInsecureTls',
			label: 'Allow insecure TLS (self-signed)',
			width: 6,
			default: false,
			disableAutoExpression: true,
			isVisibleExpression: '$(options:useHttps) === true',
		},
		{
			type: 'secret-text',
			id: 'apiKey',
			label: 'Integration API key',
			width: 12,
			default: '',
			tooltip: 'Shown once when issued under Device → System or User Management → API Keys. Treat like a password.',
		},
	]
}
