import { ExtensionContext } from "vscode"
import { z, ZodError } from "zod"

import {
	type ProviderSettingsWithId,
	providerSettingsWithIdSchema,
	discriminatedProviderSettingsWithIdSchema,
	ProviderSettingsEntry,
	DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
	getModelId,
	openRouterDefaultModelId,
	type ProviderName,
	isProviderName,
	isRetiredProvider,
	SECRET_STATE_KEYS,
} from "@roo-code/types"

import { Mode, modes } from "../../shared/modes"
import { buildApiHandler } from "../../api"
import { getSettingsStore } from "../../services/SettingsStore"

type ModelMigrations = {
	[K in ProviderName]?: Record<string, string>
}

const MODEL_MIGRATIONS: ModelMigrations = {} as const satisfies ModelMigrations

function isValidBase64(str: string): boolean {
	if (!str || str.length < 4) return false
	try {
		const decoded = Buffer.from(str, "base64").toString("utf-8")
		const reEncoded = Buffer.from(decoded).toString("base64")
		return reEncoded === str
	} catch {
		return false
	}
}

function decodeBase64ApiKeys(apiConfig: Record<string, unknown>): Record<string, unknown> {
	const decoded = { ...apiConfig }
	for (const key of SECRET_STATE_KEYS) {
		if (key in decoded && typeof decoded[key] === "string") {
			const value = decoded[key] as string
			if (isValidBase64(value)) {
				decoded[key] = Buffer.from(value, "base64").toString("utf-8")
			}
		}
	}
	return decoded
}

function encodeBase64ApiKeys(apiConfig: Record<string, unknown>): Record<string, unknown> {
	const encoded = { ...apiConfig }
	for (const key of SECRET_STATE_KEYS) {
		if (key in encoded && typeof encoded[key] === "string") {
			const value = encoded[key] as string
			if (!isValidBase64(value)) {
				encoded[key] = Buffer.from(value).toString("base64")
			}
		}
	}
	return encoded
}

export const providerProfilesSchema = z.object({
	currentApiConfigName: z.string(),
	apiConfigs: z.record(z.string(), providerSettingsWithIdSchema),
	modeApiConfigs: z.record(z.string(), z.string()).optional(),
	migrations: z
		.object({
			rateLimitSecondsMigrated: z.boolean().optional(),
			openAiHeadersMigrated: z.boolean().optional(),
			consecutiveMistakeLimitMigrated: z.boolean().optional(),
			todoListEnabledMigrated: z.boolean().optional(),
			claudeCodeLegacySettingsMigrated: z.boolean().optional(),
		})
		.optional(),
})

export type ProviderProfiles = z.infer<typeof providerProfilesSchema>

type LogFn = (message: string) => void

export class ProviderSettingsManager {
	private static readonly SCOPE_PREFIX = "roo_cline_config_"
	private readonly defaultConfigId = this.generateId()

	private readonly defaultModeApiConfigs: Record<string, string> = Object.fromEntries(
		modes.map((mode) => [mode.slug, this.defaultConfigId]),
	)

	private readonly defaultProviderProfiles: ProviderProfiles = {
		currentApiConfigName: "default",
		apiConfigs: {
			default: {
				id: this.defaultConfigId,
				apiProvider: "openrouter",
				openRouterModelId: openRouterDefaultModelId,
			},
		},
		modeApiConfigs: this.defaultModeApiConfigs,
		migrations: {
			rateLimitSecondsMigrated: true,
			openAiHeadersMigrated: true,
			consecutiveMistakeLimitMigrated: true,
			todoListEnabledMigrated: true,
			claudeCodeLegacySettingsMigrated: true,
		},
	}

	private readonly context: ExtensionContext
	private logFn: LogFn | null = null

	constructor(context: ExtensionContext) {
		this.context = context

		this.initialize().catch(console.error)
	}

	setLogger(logFn: LogFn | null) {
		this.logFn = logFn
	}

	private log(message: string) {
		if (this.logFn) {
			this.logFn(message)
		}
	}

	private get store() {
		return getSettingsStore()
	}

	public generateId() {
		return Math.random().toString(36).substring(2, 15)
	}

	private _lock = Promise.resolve()
	private lock<T>(cb: () => Promise<T>) {
		const next = this._lock.then(cb)
		this._lock = next.catch(() => {}) as Promise<void>
		return next
	}

	public async initialize() {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()

				const numConfigs = Object.keys(providerProfiles.apiConfigs || {}).length
				this.log(
					`Loaded profiles: current=${providerProfiles.currentApiConfigName}, configs=${numConfigs}`,
				)

				if (!providerProfiles || numConfigs === 0) {
					this.log(`No valid profiles loaded, saving default profiles...`)
					await this.store.saveProviderProfiles(this.defaultProviderProfiles as unknown as Record<string, unknown>)
					return
				}

				let isDirty = false

				if (!providerProfiles.modeApiConfigs) {
					const currentName = providerProfiles.currentApiConfigName
					const seedId =
						providerProfiles.apiConfigs[currentName]?.id ??
						Object.values(providerProfiles.apiConfigs)[0]?.id ??
						this.defaultConfigId
					providerProfiles.modeApiConfigs = Object.fromEntries(modes.map((m) => [m.slug, seedId]))
					isDirty = true
				}

				if (this.applyModelMigrations(providerProfiles)) {
					isDirty = true
				}

				for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
					if (!apiConfig.id) {
						apiConfig.id = this.generateId()
						isDirty = true
					}
				}

				if (!providerProfiles.migrations) {
					providerProfiles.migrations = {
						rateLimitSecondsMigrated: false,
						openAiHeadersMigrated: false,
						consecutiveMistakeLimitMigrated: false,
						todoListEnabledMigrated: false,
						claudeCodeLegacySettingsMigrated: false,
					}
					isDirty = true
				}

				if (!providerProfiles.migrations.rateLimitSecondsMigrated) {
					await this.migrateRateLimitSeconds(providerProfiles)
					providerProfiles.migrations.rateLimitSecondsMigrated = true
					isDirty = true
				}

				if (!providerProfiles.migrations.openAiHeadersMigrated) {
					await this.migrateOpenAiHeaders(providerProfiles)
					providerProfiles.migrations.openAiHeadersMigrated = true
					isDirty = true
				}

				if (!providerProfiles.migrations.consecutiveMistakeLimitMigrated) {
					await this.migrateConsecutiveMistakeLimit(providerProfiles)
					providerProfiles.migrations.consecutiveMistakeLimitMigrated = true
					isDirty = true
				}

				if (!providerProfiles.migrations.todoListEnabledMigrated) {
					await this.migrateTodoListEnabled(providerProfiles)
					providerProfiles.migrations.todoListEnabledMigrated = true
					isDirty = true
				}

				if (!providerProfiles.migrations.claudeCodeLegacySettingsMigrated) {
					for (const apiConfig of Object.values(providerProfiles.apiConfigs)) {
						if ((apiConfig.apiProvider as string) !== "claude-code") continue

						const config = apiConfig as unknown as Record<string, unknown>
						if ("claudeCodePath" in config) {
							delete config.claudeCodePath
							isDirty = true
						}
						if ("claudeCodeMaxOutputTokens" in config) {
							delete config.claudeCodeMaxOutputTokens
							isDirty = true
						}
					}

					providerProfiles.migrations.claudeCodeLegacySettingsMigrated = true
					isDirty = true
				}

				if (isDirty) {
					await this.store.saveProviderProfiles(providerProfiles as unknown as Record<string, unknown>)
				}

				// Sync modeApiConfigs from providerProfiles to globalSettings so
				// that ContextProxy.getValues() and the frontend's getState() see them
				const finalModeConfigs = providerProfiles.modeApiConfigs ?? {}
				const existingInGlobal = (this.store as any).stateCache
					? (this.store as any).stateCache.modeApiConfigs
					: undefined
				const finalStr = JSON.stringify(finalModeConfigs)
				const existStr = JSON.stringify(existingInGlobal || {})
				if (finalStr !== existStr) {
					;(this.store.setGlobalState as any)("modeApiConfigs", finalModeConfigs)
					await this.store.persistGlobalSettings()
				}
			})
		} catch (error) {
			throw new Error(`Failed to initialize config: ${error}`)
		}
	}

	private async migrateRateLimitSeconds(providerProfiles: ProviderProfiles) {
		try {
			let rateLimitSeconds: number | undefined

			try {
				rateLimitSeconds = await this.context.globalState.get<number>("rateLimitSeconds")
			} catch (error) {
				console.error("[MigrateRateLimitSeconds] Error getting global rate limit:", error)
			}

			if (rateLimitSeconds === undefined) {
				rateLimitSeconds = 0
			}

			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (apiConfig.rateLimitSeconds === undefined) {
					apiConfig.rateLimitSeconds = rateLimitSeconds
				}
			}
		} catch (error) {
			console.error(`[MigrateRateLimitSeconds] Failed to migrate rate limit settings:`, error)
		}
	}

	private async migrateOpenAiHeaders(providerProfiles: ProviderProfiles) {
		try {
			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				const configAny = apiConfig as any

				if (
					configAny.openAiHostHeader &&
					(!apiConfig.openAiHeaders || Object.keys(apiConfig.openAiHeaders || {}).length === 0)
				) {
					apiConfig.openAiHeaders = { Host: configAny.openAiHostHeader }
					configAny.openAiHostHeader = undefined
				}
			}
		} catch (error) {
			console.error(`[MigrateOpenAiHeaders] Failed to migrate OpenAI headers:`, error)
		}
	}

	private async migrateConsecutiveMistakeLimit(providerProfiles: ProviderProfiles) {
		try {
			for (const [name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (apiConfig.consecutiveMistakeLimit == null) {
					apiConfig.consecutiveMistakeLimit = DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
				}
			}
		} catch (error) {
			console.error(`[MigrateConsecutiveMistakeLimit] Failed to migrate consecutive mistake limit:`, error)
		}
	}

	private async migrateTodoListEnabled(providerProfiles: ProviderProfiles) {
		try {
			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (apiConfig.todoListEnabled === undefined) {
					apiConfig.todoListEnabled = true
				}
			}
		} catch (error) {
			console.error(`[MigrateTodoListEnabled] Failed to migrate todo list enabled setting:`, error)
		}
	}

	private applyModelMigrations(providerProfiles: ProviderProfiles): boolean {
		let migrated = false

		try {
			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (!apiConfig.apiProvider || !apiConfig.apiModelId) {
					continue
				}

				const provider = apiConfig.apiProvider as ProviderName
				const providerMigrations = MODEL_MIGRATIONS[provider]
				if (!providerMigrations) {
					continue
				}

				const newModelId = providerMigrations[apiConfig.apiModelId]
				if (newModelId && newModelId !== apiConfig.apiModelId) {
					console.log(
						`[ModelMigration] Migrating ${apiConfig.apiProvider} model from ${apiConfig.apiModelId} to ${newModelId}`,
					)
					apiConfig.apiModelId = newModelId
					migrated = true
				}
			}
		} catch (error) {
			console.error(`[ModelMigration] Failed to apply model migrations:`, error)
		}

		return migrated
	}

	private cleanModelId(modelId: string | undefined): string | undefined {
		if (!modelId) return undefined

		if (modelId.includes("/")) {
			return modelId.split("/").pop()
		}

		return modelId
	}

	public async listConfig(): Promise<ProviderSettingsEntry[]> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()

				return Object.entries(providerProfiles.apiConfigs).map(([name, apiConfig]) => ({
					name,
					id: apiConfig.id || "",
					apiProvider: apiConfig.apiProvider,
					modelId: this.cleanModelId(getModelId(apiConfig)),
				}))
			})
		} catch (error) {
			throw new Error(`Failed to list configs: ${error}`)
		}
	}

	public async saveConfig(name: string, config: ProviderSettingsWithId): Promise<string> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				const existingId = providerProfiles.apiConfigs[name]?.id
				const id = config.id || existingId || this.generateId()

				const filteredConfig =
					typeof config.apiProvider === "string" && isRetiredProvider(config.apiProvider)
						? providerSettingsWithIdSchema.passthrough().parse(config)
						: discriminatedProviderSettingsWithIdSchema.parse(config)
				
				const encodedConfig = encodeBase64ApiKeys(filteredConfig as Record<string, unknown>)
				providerProfiles.apiConfigs[name] = { ...encodedConfig, id } as ProviderSettingsWithId
				await this.store.saveProviderProfiles(providerProfiles as unknown as Record<string, unknown>)
				return id
			})
		} catch (error) {
			throw new Error(`Failed to save config: ${error}`)
		}
	}

	public async getProfile(
		params: { name: string } | { id: string },
	): Promise<ProviderSettingsWithId & { name: string }> {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				let name: string
				let providerSettings: ProviderSettingsWithId

				if ("name" in params) {
					name = params.name

					if (!providerProfiles.apiConfigs[name]) {
						throw new Error(`Config with name '${name}' not found`)
					}

					providerSettings = providerProfiles.apiConfigs[name]
				} else {
					const id = params.id

					const entry = Object.entries(providerProfiles.apiConfigs).find(
						([_, apiConfig]) => apiConfig.id === id,
					)

					if (!entry) {
						throw new Error(`Config with ID '${id}' not found`)
					}

					name = entry[0]
					providerSettings = entry[1]
				}

				const decodedSettings = decodeBase64ApiKeys(providerSettings as Record<string, unknown>)
				return { name, ...(decodedSettings as ProviderSettingsWithId) }
			})
		} catch (error) {
			throw new Error(`Failed to get profile: ${error instanceof Error ? error.message : error}`)
		}
	}

	public async activateProfile(
		params: { name: string } | { id: string },
	): Promise<ProviderSettingsWithId & { name: string }> {
		const { name, ...providerSettings } = await this.getProfile(params)

		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				providerProfiles.currentApiConfigName = name
				await this.store.saveProviderProfiles(providerProfiles as unknown as Record<string, unknown>)
				return { name, ...providerSettings }
			})
		} catch (error) {
			throw new Error(`Failed to activate profile: ${error instanceof Error ? error.message : error}`)
		}
	}

	public async deleteConfig(name: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()

				if (!providerProfiles.apiConfigs[name]) {
					throw new Error(`Config '${name}' not found`)
				}

				if (Object.keys(providerProfiles.apiConfigs).length === 1) {
					throw new Error(`Cannot delete the last remaining configuration`)
				}

				delete providerProfiles.apiConfigs[name]
				await this.store.saveProviderProfiles(providerProfiles as unknown as Record<string, unknown>)
			})
		} catch (error) {
			throw new Error(`Failed to delete config: ${error}`)
		}
	}

	public async hasConfig(name: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				return name in providerProfiles.apiConfigs
			})
		} catch (error) {
			throw new Error(`Failed to check config existence: ${error}`)
		}
	}

	public async setModeConfig(mode: Mode, configId: string) {
		try {
			return await this.lock(async () => {
				const providerProfiles = await this.load()
				if (!providerProfiles.modeApiConfigs) {
					providerProfiles.modeApiConfigs = {}
				}
				providerProfiles.modeApiConfigs[mode] = configId
				await this.store.saveProviderProfiles(providerProfiles as unknown as Record<string, unknown>)
			})
		} catch (error) {
			throw new Error(`Failed to set mode config: ${error}`)
		}
	}

	public async getAllModeConfigs(): Promise<Record<string, string>> {
		try {
			return await this.lock(async () => {
				const { modeApiConfigs } = await this.load()
				return modeApiConfigs ?? {}
			})
		} catch (error) {
			throw new Error(`Failed to get all mode configs: ${error}`)
		}
	}

	public async getModeConfigId(mode: Mode) {
		try {
			return await this.lock(async () => {
				const { modeApiConfigs } = await this.load()
				return modeApiConfigs?.[mode]
			})
		} catch (error) {
			throw new Error(`Failed to get mode config: ${error}`)
		}
	}

	public async export() {
		try {
			return await this.lock(async () => {
				const profiles = providerProfilesSchema.parse(await this.load())
				const configs = profiles.apiConfigs
				for (const name in configs) {
					const apiProvider = configs[name].apiProvider

					if (typeof apiProvider === "string" && isRetiredProvider(apiProvider)) {
						continue
					}

					configs[name] = discriminatedProviderSettingsWithIdSchema.parse(configs[name])

					if (!configs[name].apiProvider) {
						continue
					}

					try {
						const apiHandler = buildApiHandler(configs[name])
						const modelInfo = apiHandler.getModel().info

						const supportsReasoningBudget =
							modelInfo.supportsReasoningBudget || modelInfo.requiredReasoningBudget

						if (!supportsReasoningBudget) {
							delete configs[name].modelMaxTokens
							delete configs[name].modelMaxThinkingTokens
						}
					} catch (error) {
						console.warn(`Skipping token field filtering for config '${name}': ${error}`)
					}
				}
				return profiles
			})
		} catch (error) {
			throw new Error(`Failed to export provider profiles: ${error}`)
		}
	}

	public async import(providerProfiles: ProviderProfiles) {
		try {
			return await this.lock(async () => {
				await this.store.saveProviderProfiles(providerProfiles as unknown as Record<string, unknown>)
			})
		} catch (error) {
			throw new Error(`Failed to import provider profiles: ${error}`)
		}
	}

	public async resetAllConfigs() {
		return await this.lock(async () => {
			await this.store.saveProviderProfiles({})
		})
	}

	private async load(): Promise<ProviderProfiles> {
		try {
			const rawData = await this.store.loadProviderProfiles()

			if (!rawData) {
				return this.defaultProviderProfiles
			}

			const content = JSON.stringify(rawData)

			let providerProfiles: any
			try {
				providerProfiles = providerProfilesSchema
					.extend({
						apiConfigs: z.record(z.string(), z.any()),
					})
					.parse(JSON.parse(content))
			} catch (schemaError) {
				// Try a more permissive parse - just take the raw data with any shape
				try {
					const permissiveParse = JSON.parse(content)
					if (
						permissiveParse &&
						typeof permissiveParse === "object" &&
						"apiConfigs" in permissiveParse &&
						typeof permissiveParse.apiConfigs === "object" &&
						Object.keys(permissiveParse.apiConfigs).length > 0
					) {
						providerProfiles = permissiveParse
					} else {
						throw schemaError
					}
				} catch {
					throw schemaError
				}
			}

			const apiConfigs = Object.entries(providerProfiles.apiConfigs).reduce(
				(acc, [key, apiConfig]) => {
					const sanitizedConfig = this.sanitizeProviderConfig(apiConfig)

					const providerValue =
						typeof sanitizedConfig === "object" &&
						sanitizedConfig !== null &&
						"apiProvider" in sanitizedConfig
							? (sanitizedConfig as Record<string, unknown>).apiProvider
							: undefined
					const schema =
						typeof providerValue === "string" && isRetiredProvider(providerValue)
							? providerSettingsWithIdSchema.passthrough()
							: providerSettingsWithIdSchema
					const result = schema.safeParse(sanitizedConfig)
					if (!result.success) {
						this.log(
							`load() - WARNING: apiConfig "${key}" failed schema validation for provider "${providerValue}". ` +
							`Issues: ${JSON.stringify(result.error.issues)}`,
						)
						// Add the config anyway with partial parsing - don't drop user data
						const partialConfig = { ...(sanitizedConfig as object) } as ProviderSettingsWithId
						if (!partialConfig.id) {
							partialConfig.id = this.generateId()
						}
						return { ...acc, [key]: partialConfig }
					}
					return result.success ? { ...acc, [key]: result.data } : acc
				},
				{} as Record<string, ProviderSettingsWithId>,
			)

			const result = {
				...providerProfiles,
				apiConfigs: Object.fromEntries(
					Object.entries(apiConfigs).filter(([_, apiConfig]) => apiConfig !== null),
				),
			}
			return result
		} catch (error) {
			this.log(`load() - CRITICAL ERROR: ${error instanceof Error ? error.message : String(error)}`)
			throw new Error(`Failed to read provider profiles from storage: ${error}`)
		}
	}

	private sanitizeProviderConfig(apiConfig: unknown): unknown {
		if (typeof apiConfig !== "object" || apiConfig === null) {
			return apiConfig
		}

		const config = apiConfig as Record<string, unknown>

		const apiProvider = config.apiProvider

		if (
			apiProvider !== undefined &&
			(typeof apiProvider !== "string" || (!isProviderName(apiProvider) && !isRetiredProvider(apiProvider)))
		) {
			const { apiProvider, ...restConfig } = config
			return restConfig
		}

		return apiConfig
	}
}