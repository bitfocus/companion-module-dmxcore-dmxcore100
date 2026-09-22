import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig, ModuleSecrets } from './config.js'
import { DEFAULT_HTTP_PORT } from './constants.js'

/**
 * Drop OSC-era config fields and seed Integration API defaults while keeping host.
 */
const upgradeToIntegrationApi: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets> = (_context, props) => {
	const updatedActions: never[] = []
	const updatedFeedbacks: never[] = []

	if (!props.config) {
		return { updatedConfig: null, updatedActions, updatedFeedbacks }
	}

	const legacy = props.config as ModuleConfig & {
		listenForFeedback?: boolean
		feedbackPort?: number
		pingInterval?: number
		controlCodes?: string
		apiKey?: string
	}

	const updatedConfig: ModuleConfig = {
		host: legacy.host ?? '',
		port: typeof legacy.port === 'number' && legacy.port > 0 ? legacy.port : DEFAULT_HTTP_PORT,
		useHttps: legacy.useHttps === true,
		allowInsecureTls: legacy.allowInsecureTls === true,
	}

	// Older module / docs defaulted to 8080 (nothing in Core listens there). Remap to HTTP 80.
	// Do not remap 8000 — desktop Core uses HTTP 8000 (and OSC also used UDP 8000).
	if (legacy.port === 8080) {
		updatedConfig.port = DEFAULT_HTTP_PORT
	}

	let updatedSecrets: ModuleSecrets | null = null
	if ((!props.secrets || !props.secrets.apiKey) && typeof legacy.apiKey === 'string' && legacy.apiKey) {
		updatedSecrets = { apiKey: legacy.apiKey }
	}

	return {
		updatedConfig,
		updatedSecrets,
		updatedActions,
		updatedFeedbacks,
	}
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = [upgradeToIntegrationApi]
