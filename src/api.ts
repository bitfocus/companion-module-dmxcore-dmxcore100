import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { ModuleConfig } from './config.js'
import { REQUEST_TIMEOUT_MS } from './constants.js'
import type { DeviceInfo, DeviceStatus, ExecuteRequest, IntegrationEntity, EntityState } from './entities.js'
import { parseDeviceInfo, parseDeviceStatus, parseEntities, parseStates } from './entities.js'

export type ApiClientOptions = {
	config: ModuleConfig
	apiKey: string
}

export class IntegrationApiError extends Error {
	readonly status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = 'IntegrationApiError'
		this.status = status
	}
}

/** Wrap bare IPv6 literals so URL composition stays valid. */
function formatHostForUrl(host: string): string {
	if (host.startsWith('[')) return host
	if (host.includes(':')) return `[${host}]`
	return host
}

export function buildBaseUrl(config: ModuleConfig): string {
	const host = formatHostForUrl(config.host.trim())
	const scheme = config.useHttps ? 'https' : 'http'
	return `${scheme}://${host}:${config.port}/api/integration/v1`
}

export function buildWsUrl(config: ModuleConfig): string {
	const host = formatHostForUrl(config.host.trim())
	const scheme = config.useHttps ? 'wss' : 'ws'
	return `${scheme}://${host}:${config.port}/api/integration/v1/events`
}

function authHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		Accept: 'application/json',
	}
}

async function readBody(res: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of res) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	return Buffer.concat(chunks).toString('utf8')
}

export class IntegrationApiClient {
	readonly #config: ModuleConfig
	readonly #apiKey: string
	readonly #httpsAgent: https.Agent | undefined

	constructor(options: ApiClientOptions) {
		this.#config = options.config
		this.#apiKey = options.apiKey
		if (options.config.useHttps) {
			this.#httpsAgent = new https.Agent({
				keepAlive: true,
				rejectUnauthorized: !options.config.allowInsecureTls,
			})
		}
	}

	destroy(): void {
		this.#httpsAgent?.destroy()
	}

	async getInfo(): Promise<DeviceInfo> {
		const raw = await this.#requestJson('GET', '/info')
		const info = parseDeviceInfo(raw)
		if (!info) throw new IntegrationApiError(0, 'Invalid /info response')
		return info
	}

	/** Health / show snapshot — same Integration `GET /info` as identity (not admin `/api/status`). */
	async getStatus(): Promise<DeviceStatus> {
		const raw = await this.#requestJson('GET', '/info')
		const status = parseDeviceStatus(raw)
		if (!status) throw new IntegrationApiError(0, 'Invalid /info status snapshot')
		return status
	}

	async getCatalog(): Promise<IntegrationEntity[]> {
		const raw = await this.#requestJson('GET', '/catalog')
		return parseEntities(raw)
	}

	async getState(): Promise<EntityState[]> {
		const raw = await this.#requestJson('GET', '/state')
		const states = parseStates(raw)
		if (!states) throw new IntegrationApiError(0, 'Invalid /state response')
		return states
	}

	async execute(request: ExecuteRequest): Promise<void> {
		await this.#requestJson('POST', '/execute', request)
	}

	async #requestJson(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
		const url = new URL(path.startsWith('http') ? path : `${buildBaseUrl(this.#config)}${path}`)

		const payload = body === undefined ? undefined : JSON.stringify(body)
		const headers: Record<string, string> = {
			...authHeaders(this.#apiKey),
		}
		if (payload !== undefined) {
			headers['Content-Type'] = 'application/json'
			headers['Content-Length'] = Buffer.byteLength(payload).toString()
		}

		const lib = url.protocol === 'https:' ? https : http
		const agent = url.protocol === 'https:' ? this.#httpsAgent : undefined

		return await new Promise((resolve, reject) => {
			let settled = false
			const settleReject = (error: unknown): void => {
				if (settled) return
				settled = true
				reject(error instanceof Error ? error : new Error(String(error)))
			}
			const settleResolve = (value: unknown): void => {
				if (settled) return
				settled = true
				resolve(value)
			}

			const req = lib.request(
				{
					protocol: url.protocol,
					hostname: url.hostname,
					port: url.port,
					path: `${url.pathname}${url.search}`,
					method,
					headers,
					agent,
					timeout: REQUEST_TIMEOUT_MS,
				},
				(res) => {
					void readBody(res)
						.then((text) => {
							const status = res.statusCode ?? 0
							let parsed: unknown = undefined
							if (text) {
								try {
									parsed = JSON.parse(text) as unknown
								} catch {
									parsed = text
								}
							}

							if (status >= 400) {
								const message =
									parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
										? (parsed as { error: string }).error
										: typeof parsed === 'string' && parsed
											? parsed
											: `HTTP ${status}`
								settleReject(new IntegrationApiError(status, message))
								return
							}

							settleResolve(parsed)
						})
						.catch(settleReject)
				},
			)

			req.on('timeout', () => {
				req.destroy()
				settleReject(new Error('Request timed out'))
			})
			req.on('error', settleReject)
			if (payload !== undefined) req.write(payload)
			req.end()
		})
	}
}
