import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { DEFAULT_HTTP_PORT, STATUS_POLL_MS, SUPPORTED_PROTOCOL_VERSION } from './constants.js'
import { IntegrationApiClient, IntegrationApiError } from './api.js'
import { IntegrationEventSocket } from './events.js'
import type { DeviceInfo, EntityState, ExecuteRequest, IntegrationEntity } from './entities.js'
import {
	applyStates,
	createInitialState,
	displayDeviceName,
	getLevel,
	replaceCatalog,
	type DmxCoreState,
	variableValuesFromState,
} from './state.js'
import {
	confirmOptimisticSetLevelsFromStates,
	ReconcileGate,
	takeAllOptimisticRollbacks,
	takeOptimisticRollback,
	trackOptimisticSetLevel,
	type PendingOptimisticLevels,
} from './optimistic.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	secrets: ModuleSecrets = { apiKey: '' }
	readonly state: DmxCoreState = createInitialState()

	#api: IntegrationApiClient | undefined
	#events: IntegrationEventSocket | undefined
	#connectGeneration = 0
	#statusPollTimer: ReturnType<typeof setInterval> | undefined
	readonly #pendingOptimisticLevels: PendingOptimisticLevels = new Map()
	readonly #reconcile = new ReconcileGate()

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = this.#normaliseConfig(config)
		this.secrets = this.#normaliseSecrets(secrets)
		this.#exportDefinitions()
		await this.#startConnection()
	}

	async destroy(): Promise<void> {
		this.#stopConnection()
		this.log('debug', 'DMX Core connection closed')
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.config = this.#normaliseConfig(config)
		this.secrets = this.#normaliseSecrets(secrets)
		this.#exportDefinitions()
		await this.#startConnection()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	async execute(request: ExecuteRequest, options?: { preferWs?: boolean }): Promise<boolean> {
		const api = this.#api
		const events = this.#events
		const generation = this.#connectGeneration
		if (!api) {
			this.log('warn', `Cannot execute ${request.command} on ${request.code}: not connected`)
			return false
		}

		await this.#reconcile.wait()
		if (generation !== this.#connectGeneration || api !== this.#api) return false

		try {
			if (options?.preferWs && events?.sendExecute(request)) {
				// WS execute is fire-and-forget (error frames only). Treat a queued frame as accepted
				// and apply setLevel locally so rotary ticks can accumulate before the device echo.
				this.log('debug', `WS execute ${request.command} ${request.code}`)
				this.#applyOptimisticExecute(request, true)
				return true
			}

			await api.execute(request)
			this.log('debug', `HTTP execute ${request.command} ${request.code}`)
			// HTTP already accepted the command; refresh UI without tracking a rollback.
			this.#applyOptimisticExecute(request, false)
			return true
		} catch (error) {
			this.#handleApiError('execute', error)
			return false
		}
	}

	/** Optimistically update a level so rotary labels refresh before the WS state echo. */
	applyLocalLevel(code: string, level: number): void {
		applyStates(this.state, [{ code, level }], false)
		this.#publishState()
	}

	#applyOptimisticExecute(request: ExecuteRequest, trackPending: boolean): void {
		if (request.command !== 'setLevel' || typeof request.level !== 'number') return
		if (trackPending) {
			trackOptimisticSetLevel(this.#pendingOptimisticLevels, request.code, getLevel(this.state, request.code))
		}
		this.applyLocalLevel(request.code, request.level)
	}

	async refreshCatalog(): Promise<void> {
		if (!this.#api) {
			this.log('warn', 'Cannot refresh catalog: not connected')
			return
		}

		try {
			const [entities, states] = await Promise.all([this.#api.getCatalog(), this.#api.getState()])
			this.#onCatalog(entities)
			this.#onState(states, true)
			await this.#refreshStatus()
			this.log('info', `Refreshed catalog (${entities.length} entities)`)
		} catch (error) {
			this.#handleApiError('refresh', error)
		}
	}

	#normaliseConfig(config: ModuleConfig): ModuleConfig {
		return {
			host: config.host ?? '',
			port: config.port || DEFAULT_HTTP_PORT,
			useHttps: config.useHttps === true,
			allowInsecureTls: config.allowInsecureTls === true,
		}
	}

	#normaliseSecrets(secrets: ModuleSecrets | undefined): ModuleSecrets {
		return {
			apiKey: secrets?.apiKey ?? '',
		}
	}

	#exportDefinitions(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
		UpdateVariableDefinitions(this)
	}

	async #startConnection(): Promise<void> {
		this.#stopConnection()
		const generation = ++this.#connectGeneration

		const host = this.config.host.trim()
		const apiKey = this.secrets.apiKey.trim()

		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Set the DMX Core IP address')
			return
		}
		if (!apiKey) {
			this.updateStatus(InstanceStatus.BadConfig, 'Set the Integration API key')
			return
		}

		this.updateStatus(InstanceStatus.Connecting, `Contacting ${host}:${this.config.port}`)
		this.#api = new IntegrationApiClient({ config: this.config, apiKey })

		try {
			const info = await this.#api.getInfo()
			if (generation !== this.#connectGeneration) return

			this.#onHello(info)

			const [entities, states] = await Promise.all([this.#api.getCatalog(), this.#api.getState()])
			if (generation !== this.#connectGeneration) return

			this.#onCatalog(entities)
			this.#onState(states, true)
			await this.#refreshStatus()
			if (generation !== this.#connectGeneration) return
			this.#startStatusPoll()
		} catch (error) {
			if (generation !== this.#connectGeneration) return
			this.#api?.destroy()
			this.#api = undefined
			this.#handleApiError('connect', error)
			return
		}

		this.#events = new IntegrationEventSocket(this.config, apiKey, {
			onOpen: () => {
				this.log('debug', 'Integration API WebSocket open')
			},
			onHello: (info) => {
				this.#onHello(info)
				this.state.connected = true
				const label = displayDeviceName(this.state) || host
				this.updateStatus(InstanceStatus.Ok, `${label} (protocol ${info.protocolVersion})`)
				this.#publishState()
			},
			onCatalog: (entities) => this.#onCatalog(entities),
			onState: (states, full) => this.#onState(states, full),
			onError: (message, details) => {
				this.log('warn', `Integration API event error: ${message}`)
				this.#onExecuteError(message, details?.code)
			},
			onClose: () => {
				this.state.connected = false
				this.#onOptimisticConnectionLost()
				this.#publishState()
				if (this.#api) {
					this.updateStatus(InstanceStatus.Connecting, 'WebSocket reconnecting…')
				}
			},
			log: (level, message) => this.log(level, message),
		})
		this.#events.start()
	}

	#stopConnection(): void {
		this.#connectGeneration++
		this.#stopStatusPoll()
		this.#events?.stop()
		this.#events = undefined
		this.#api?.destroy()
		this.#api = undefined
		this.state.connected = false
		this.state.info = null
		this.state.status = null
		this.#restoreOptimisticRollbacks(takeAllOptimisticRollbacks(this.#pendingOptimisticLevels))
		this.#reconcile.invalidate()
	}

	#startStatusPoll(): void {
		this.#stopStatusPoll()
		this.#statusPollTimer = setInterval(() => {
			void this.#refreshStatus()
		}, STATUS_POLL_MS)
	}

	#stopStatusPoll(): void {
		if (this.#statusPollTimer) {
			clearInterval(this.#statusPollTimer)
			this.#statusPollTimer = undefined
		}
	}

	async #refreshStatus(): Promise<void> {
		if (!this.#api) return
		try {
			this.state.status = await this.#api.getStatus()
			this.#publishState()
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.log('debug', `Integration /info status snapshot unavailable: ${message}`)
		}
	}

	#onHello(info: DeviceInfo): void {
		this.state.info = info
		if (info.protocolVersion > SUPPORTED_PROTOCOL_VERSION) {
			this.log(
				'warn',
				`Device protocolVersion ${info.protocolVersion} is newer than supported ${SUPPORTED_PROTOCOL_VERSION}`,
			)
		}
	}

	#onCatalog(entities: IntegrationEntity[]): void {
		replaceCatalog(this.state, entities)
		this.#exportDefinitions()
		this.#publishState()
	}

	#onState(states: EntityState[], full: boolean): void {
		if (full) {
			this.#pendingOptimisticLevels.clear()
		} else {
			confirmOptimisticSetLevelsFromStates(this.#pendingOptimisticLevels, states)
		}
		applyStates(this.state, states, full)
		this.#publishState()
	}

	#onExecuteError(_message: string, code?: string): void {
		if (code) {
			const prior = takeOptimisticRollback(this.#pendingOptimisticLevels, code)
			if (prior === undefined) return
			if (typeof prior === 'number') {
				this.applyLocalLevel(code, prior)
				return
			}
			void this.#reconcileFromDevice()
			return
		}

		if (this.#pendingOptimisticLevels.size === 0) return
		this.#restoreOptimisticRollbacks(takeAllOptimisticRollbacks(this.#pendingOptimisticLevels))
		void this.#reconcileFromDevice()
	}

	#onOptimisticConnectionLost(): void {
		if (this.#pendingOptimisticLevels.size === 0) return
		this.#restoreOptimisticRollbacks(takeAllOptimisticRollbacks(this.#pendingOptimisticLevels))
		void this.#reconcileFromDevice()
	}

	#restoreOptimisticRollbacks(rollbacks: Array<{ code: string; priorLevel: number }>): void {
		if (rollbacks.length === 0) return
		applyStates(
			this.state,
			rollbacks.map(({ code, priorLevel }) => ({ code, level: priorLevel })),
			false,
		)
		this.#publishState()
	}

	async #reconcileFromDevice(): Promise<void> {
		const api = this.#api
		if (!api) return

		const generation = this.#connectGeneration
		await this.#reconcile.run(async (isCurrent) => {
			try {
				const states = await api.getState()
				if (generation !== this.#connectGeneration || !isCurrent()) return
				this.#onState(states, true)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				this.log('debug', `Unable to reconcile levels from device state: ${message}`)
			}
		})
	}

	#publishState(): void {
		this.setVariableValues(variableValuesFromState(this.state))
		this.checkFeedbacks(
			'connectionOk',
			'nowPlaying',
			'nowPlayingMatches',
			'switchOn',
			'switchOff',
			'levelAtLeast',
			'levelAtMost',
			'choiceEquals',
			'sensorContains',
		)
	}

	#handleApiError(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error)
		this.log('error', `Integration API ${context} failed: ${message}`)

		// Command validation errors should not mark the whole connection as down.
		if (context === 'execute' && error instanceof IntegrationApiError && error.status >= 400 && error.status < 500) {
			if (error.status === 401 || error.status === 403) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, message)
			}
			return
		}

		if (error instanceof IntegrationApiError && (error.status === 401 || error.status === 403)) {
			this.updateStatus(InstanceStatus.AuthenticationFailure, message)
			return
		}
		if (error instanceof IntegrationApiError && error.status === 404) {
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Integration API not found (enable it under Device → System)')
			return
		}

		this.updateStatus(InstanceStatus.ConnectionFailure, message)
	}
}
