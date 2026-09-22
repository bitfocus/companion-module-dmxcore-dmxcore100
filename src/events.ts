import { Agent as HttpsAgent } from 'node:https'
import WebSocket, { type RawData } from 'ws'
import type { ModuleConfig } from './config.js'
import { buildWsUrl } from './api.js'
import type { DeviceInfo, EntityState, ExecuteRequest, IntegrationEntity } from './entities.js'
import { parseDeviceInfo, parseEntities, parseStates } from './entities.js'
import { WS_PING_INTERVAL_MS, WS_RECONNECT_MAX_MS, WS_RECONNECT_MS } from './constants.js'

function rawDataToString(data: RawData): string {
	if (typeof data === 'string') return data
	if (Buffer.isBuffer(data)) return data.toString('utf8')
	if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
	return Buffer.from(data).toString('utf8')
}

export type EventsHandlers = {
	onHello: (info: DeviceInfo) => void
	onCatalog: (entities: IntegrationEntity[]) => void
	onState: (states: EntityState[], full: boolean) => void
	onError: (message: string, details?: { code?: string }) => void
	onOpen: () => void
	onClose: () => void
	log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
}

export class IntegrationEventSocket {
	readonly #config: ModuleConfig
	readonly #apiKey: string
	readonly #handlers: EventsHandlers

	#socket: WebSocket | undefined
	#pingTimer: ReturnType<typeof setInterval> | undefined
	#reconnectTimer: ReturnType<typeof setTimeout> | undefined
	#stopped = false
	#sawHello = false
	#reconnectDelay = WS_RECONNECT_MS
	#lastPongAt = 0
	/** Next `state` frame is a full snapshot (connect bootstrap or after catalog). */
	#awaitingFullState = true

	constructor(config: ModuleConfig, apiKey: string, handlers: EventsHandlers) {
		this.#config = config
		this.#apiKey = apiKey
		this.#handlers = handlers
	}

	get isOpen(): boolean {
		return this.#socket?.readyState === WebSocket.OPEN
	}

	get sawHello(): boolean {
		return this.#sawHello
	}

	start(): void {
		this.#stopped = false
		this.#connect()
	}

	stop(): void {
		this.#stopped = true
		this.#clearTimers()
		const socket = this.#socket
		this.#socket = undefined
		if (socket) {
			socket.removeAllListeners()
			try {
				socket.close()
			} catch {
				// ignore
			}
		}
	}

	/**
	 * Queue an execute frame on the event socket.
	 * @returns true if the frame was written to the socket — not a device execution acknowledgement.
	 */
	sendExecute(request: ExecuteRequest): boolean {
		return this.#send({ type: 'execute', ...request })
	}

	sendPing(): boolean {
		return this.#send({ type: 'ping' })
	}

	#connect(): void {
		this.#clearTimers()
		this.#sawHello = false
		this.#awaitingFullState = true

		const previous = this.#socket
		this.#socket = undefined
		if (previous) {
			previous.removeAllListeners()
			try {
				previous.close()
			} catch {
				// ignore
			}
		}

		const url = buildWsUrl(this.#config)
		const options: WebSocket.ClientOptions = {
			headers: {
				Authorization: `Bearer ${this.#apiKey}`,
			},
		}

		if (this.#config.useHttps) {
			options.agent = new HttpsAgent({ rejectUnauthorized: !this.#config.allowInsecureTls })
		}

		this.#handlers.log('debug', `WebSocket connecting to ${url}`)
		const socket = new WebSocket(url, options)
		this.#socket = socket

		socket.on('open', () => {
			this.#lastPongAt = Date.now()
			this.#handlers.onOpen()
			this.#pingTimer = setInterval(() => {
				if (this.#socket !== socket) return
				if (Date.now() - this.#lastPongAt > WS_PING_INTERVAL_MS * 2) {
					this.#handlers.log('warn', 'WebSocket pong timeout; terminating socket')
					socket.terminate()
					return
				}
				this.sendPing()
			}, WS_PING_INTERVAL_MS)
		})

		socket.on('message', (data) => {
			this.#onMessage(rawDataToString(data))
		})

		socket.on('error', (error) => {
			this.#handlers.log('error', `WebSocket error: ${error.message}`)
			this.#handlers.onError(error.message)
		})

		socket.on('close', () => {
			this.#clearPing()
			if (this.#socket !== socket) return
			this.#socket = undefined
			this.#handlers.onClose()
			if (!this.#stopped) {
				const delay = this.#reconnectDelay
				this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, WS_RECONNECT_MAX_MS)
				this.#reconnectTimer = setTimeout(() => this.#connect(), delay)
			}
		})
	}

	#onMessage(raw: string): void {
		let frame: unknown
		try {
			frame = JSON.parse(raw) as unknown
		} catch {
			this.#handlers.log('debug', `Ignoring non-JSON WebSocket frame`)
			return
		}

		if (!frame || typeof frame !== 'object') return
		const type = (frame as { type?: unknown }).type
		if (typeof type !== 'string') return

		switch (type) {
			case 'hello': {
				const info = parseDeviceInfo(frame)
				if (!info) {
					this.#handlers.onError('Invalid hello frame')
					return
				}
				this.#sawHello = true
				this.#reconnectDelay = WS_RECONNECT_MS
				this.#lastPongAt = Date.now()
				this.#handlers.onHello(info)
				return
			}
			case 'catalog': {
				// Device sends a full state snapshot after catalog changes.
				this.#awaitingFullState = true
				this.#handlers.onCatalog(parseEntities(frame))
				return
			}
			case 'state': {
				const states = parseStates(frame)
				if (!states) {
					this.#handlers.onError('Invalid state frame')
					return
				}
				const full = this.#awaitingFullState
				this.#awaitingFullState = false
				this.#handlers.onState(states, full)
				return
			}
			case 'pong':
				this.#lastPongAt = Date.now()
				return
			case 'error': {
				const message =
					typeof (frame as { error?: unknown }).error === 'string'
						? (frame as { error: string }).error
						: 'WebSocket error frame'
				const code =
					typeof (frame as { code?: unknown }).code === 'string' ? (frame as { code: string }).code : undefined
				this.#handlers.onError(message, code ? { code } : undefined)
				return
			}
			default:
				this.#handlers.log('debug', `Ignoring WebSocket frame type ${type}`)
		}
	}

	#send(payload: Record<string, unknown>): boolean {
		if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) return false
		this.#socket.send(JSON.stringify(payload))
		return true
	}

	#clearPing(): void {
		if (this.#pingTimer) {
			clearInterval(this.#pingTimer)
			this.#pingTimer = undefined
		}
	}

	#clearTimers(): void {
		this.#clearPing()
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer)
			this.#reconnectTimer = undefined
		}
	}
}
