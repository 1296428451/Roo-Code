import * as vscode from "vscode"
import { ZodError } from "zod"

import {
	PROVIDER_SETTINGS_KEYS,
	GLOBAL_SETTINGS_KEYS,
	SECRET_STATE_KEYS,
	GLOBAL_STATE_KEYS,
	GLOBAL_SECRET_KEYS,
	type ProviderSettings,
	type GlobalSettings,
	type SecretState,
	type GlobalState,
	type RooCodeSettings,
	providerSettingsSchema,
	globalSettingsSchema,
	isSecretStateKey,
	isProviderName,
	isRetiredProvider,
} from "@roo-code/types"

import { logger } from "../../utils/logging"
import { supportPrompt } from "../../shared/support-prompt"
import { getSettingsStore } from "../../services/SettingsStore"

type GlobalStateKey = keyof GlobalState
type SecretStateKey = keyof SecretState
type RooCodeSettingsKey = keyof RooCodeSettings

const PASS_THROUGH_STATE_KEYS = ["taskHistory"]

export const isPassThroughStateKey = (key: string) => PASS_THROUGH_STATE_KEYS.includes(key)

const globalSettingsExportSchema = globalSettingsSchema.omit({
	taskHistory: true,
	listApiConfigMeta: true,
	currentApiConfigName: true,
})

export class ContextProxy {
	private readonly originalContext: vscode.ExtensionContext
	private _isInitialized = false
	private logFn: ((message: string) => void) | null = null

	constructor(context: vscode.ExtensionContext) {
		this.originalContext = context
		this._isInitialized = false
	}

	setLogger(logFn: ((message: string) => void) | null): void {
		this.logFn = logFn
	}

	private log(message: string): void {
		if (this.logFn) {
			this.logFn(message)
		}
		console.log(message)
	}

	public get isInitialized() {
		return this._isInitialized
	}

	private get store() {
		return getSettingsStore()
	}

	public async initialize() {
		await this.store.loadAll()

		// Sync pass-through keys from SettingsStore -> VS Code globalState so that
		// the getGlobalState() pass-through still works for data stored in the file.
		for (const key of PASS_THROUGH_STATE_KEYS) {
			try {
				const fromFile = (this.store.getGlobalState as any)(key)
				if (fromFile !== undefined) {
					const fromVsCode = this.originalContext.globalState.get(key)
					const fileStr = JSON.stringify(fromFile)
					const vsStr = JSON.stringify(fromVsCode)
					if (vsStr !== fileStr) {
						logger.info(`[ContextProxy] Syncing SettingsStore.${key} (len=${fileStr.length}) to VS Code globalState (vsCodeLen=${vsStr?.length || 0})`)
						await this.originalContext.globalState.update(key, fromFile)
					}
				}
			} catch (err) {
				logger.error(`[ContextProxy] Failed to sync pass-through key ${key} from SettingsStore to globalState: ${err}`)
			}
		}

		await this.migrateImageGenerationSettings()
		await this.migrateInvalidApiProvider()
		await this.migrateLegacyCondensingPrompt()
		await this.migrateOldDefaultCondensingPrompt()

		await this.store.persistAll()

		this._isInitialized = true
	}

	private async migrateLegacyCondensingPrompt() {
		try {
			const legacyPrompt = this.store.getGlobalState("customCondensingPrompt")
			if (legacyPrompt) {
				const currentSupportPrompts = this.store.getGlobalState("customSupportPrompts") || {}

				const isCustomized = legacyPrompt.trim() !== supportPrompt.default.CONDENSE.trim()
				if (!currentSupportPrompts.CONDENSE && isCustomized) {
					logger.info("Migrating customized legacy customCondensingPrompt to customSupportPrompts")
					const updatedPrompts = { ...currentSupportPrompts, CONDENSE: legacyPrompt }
					this.store.setGlobalState("customSupportPrompts", updatedPrompts)
				} else if (!isCustomized) {
					logger.info("Skipping migration: legacy customCondensingPrompt equals the default prompt")
				}

				this.store.setGlobalState("customCondensingPrompt", undefined)
			}
		} catch (error) {
			logger.error(
				`Error during customCondensingPrompt migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private async migrateOldDefaultCondensingPrompt() {
		try {
			const currentSupportPrompts = this.store.getGlobalState("customSupportPrompts") || {}

			const savedCondensePrompt = currentSupportPrompts.CONDENSE

			if (savedCondensePrompt && this.isOldV1DefaultCondensePrompt(savedCondensePrompt)) {
				logger.info(
					"Clearing old v1 default condensing prompt from customSupportPrompts.CONDENSE - user will now get the improved v2 default",
				)

				const { CONDENSE: _, ...remainingPrompts } = currentSupportPrompts
				const updatedPrompts = Object.keys(remainingPrompts).length > 0 ? remainingPrompts : undefined

				this.store.setGlobalState("customSupportPrompts", updatedPrompts)
			}
		} catch (error) {
			logger.error(
				`Error during old default condensing prompt migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private isOldV1DefaultCondensePrompt(prompt: string): boolean {
		const v1RequiredPhrases = [
			"Your task is to create a detailed summary of the conversation so far",
			"1. Previous Conversation:",
			"2. Current Work:",
			"3. Key Technical Concepts:",
			"4. Relevant Files and Code:",
			"5. Problem Solving:",
			"6. Pending Tasks and Next Steps:",
			"Output only the summary of the conversation so far",
		]

		const v2Features = [
			"<analysis>",
			"SYSTEM OPERATION",
			"Errors and fixes",
			"All user messages",
			"7.",
			"8.",
			"9.",
		]

		const hasAllV1Phrases = v1RequiredPhrases.every((phrase) => prompt.toLowerCase().includes(phrase.toLowerCase()))
		const hasNoV2Features = v2Features.every((feature) => !prompt.toLowerCase().includes(feature.toLowerCase()))

		return hasAllV1Phrases && hasNoV2Features
	}

	private async migrateInvalidApiProvider() {
		try {
			const apiProvider = this.store.getGlobalState("apiProvider")
			const isKnownProvider =
				typeof apiProvider === "string" && (isProviderName(apiProvider) || isRetiredProvider(apiProvider))

			if (apiProvider !== undefined && !isKnownProvider) {
				logger.info(`[ContextProxy] Found invalid provider "${apiProvider}" in storage - clearing it`)
				this.store.setGlobalState("apiProvider", undefined)
			}
		} catch (error) {
			logger.error(
				`Error during invalid API provider migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private async migrateImageGenerationSettings() {
		try {
			const oldNestedSettings = this.store.getGlobalState("openRouterImageGenerationSettings" as any) as any

			if (oldNestedSettings && typeof oldNestedSettings === "object") {
				logger.info("Migrating old nested image generation settings to flattened structure")

				const currentImageApiKey = this.store.getSecret("openRouterImageApiKey")
				if (oldNestedSettings.openRouterApiKey && !currentImageApiKey) {
					this.store.setSecret("openRouterImageApiKey", oldNestedSettings.openRouterApiKey)
					logger.info("Migrated openRouterImageApiKey to secrets")
				}

				const currentSelectedModel = this.store.getGlobalState("openRouterImageGenerationSelectedModel")
				if (oldNestedSettings.selectedModel && !currentSelectedModel) {
					this.store.setGlobalState("openRouterImageGenerationSelectedModel", oldNestedSettings.selectedModel)
					logger.info("Migrated openRouterImageGenerationSelectedModel to global state")
				}

				this.store.setGlobalState("openRouterImageGenerationSettings" as any, undefined)
				logger.info("Removed old nested openRouterImageGenerationSettings")
			}
		} catch (error) {
			logger.error(
				`Error during image generation settings migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	public get extensionUri() {
		return this.originalContext.extensionUri
	}

	public get extensionPath() {
		return this.originalContext.extensionPath
	}

	public get globalStorageUri() {
		return this.originalContext.globalStorageUri
	}

	public get logUri() {
		return this.originalContext.logUri
	}

	public get extension() {
		return this.originalContext.extension
	}

	public get extensionMode() {
		return this.originalContext.extensionMode
	}

	getGlobalState<K extends GlobalStateKey>(key: K): GlobalState[K]
	getGlobalState<K extends GlobalStateKey>(key: K, defaultValue: GlobalState[K]): GlobalState[K]
	getGlobalState<K extends GlobalStateKey>(key: K, defaultValue?: GlobalState[K]): GlobalState[K] {
		if (isPassThroughStateKey(key)) {
			const value = this.originalContext.globalState.get<GlobalState[K]>(key)
			return value === undefined || value === null ? defaultValue : value
		}

		const value = this.store.getGlobalState(key)
		return value !== undefined ? value : defaultValue
	}

	async updateGlobalState<K extends GlobalStateKey>(key: K, value: GlobalState[K]) {
		if (isPassThroughStateKey(key)) {
			return this.originalContext.globalState.update(key, value)
		}

		this.store.setGlobalState(key, value)
		await this.store.persistGlobalSettings()
	}

	private getAllGlobalState(): GlobalState {
		return Object.fromEntries(GLOBAL_STATE_KEYS.map((key) => [key, this.getGlobalState(key)]))
	}

	getSecret(key: SecretStateKey) {
		return this.store.getSecret(key)
	}

	async storeSecret(key: SecretStateKey, value?: string) {
		this.store.setSecret(key, value)
		await this.store.persistSecrets()
	}

	async refreshSecrets(): Promise<void> {
		await this.store.loadAll()
	}

	private getAllSecretState(): SecretState {
		return Object.fromEntries([
			...SECRET_STATE_KEYS.map((key) => [key, this.getSecret(key as SecretStateKey)]),
			...GLOBAL_SECRET_KEYS.map((key) => [key, this.getSecret(key as SecretStateKey)]),
		])
	}

	public getGlobalSettings(): GlobalSettings {
		const values = this.getValues()

		try {
			return globalSettingsSchema.parse(values)
		} catch (error) {
			return GLOBAL_SETTINGS_KEYS.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {} as GlobalSettings)
		}
	}

	public getProviderSettings(): ProviderSettings {
		const values = this.getValues()

		const sanitizedValues = this.sanitizeProviderValues(values)

		try {
			return providerSettingsSchema.parse(sanitizedValues)
		} catch (error) {
			return PROVIDER_SETTINGS_KEYS.reduce(
				(acc, key) => ({ ...acc, [key]: sanitizedValues[key] }),
				{} as ProviderSettings,
			)
		}
	}

	private sanitizeProviderValues(values: RooCodeSettings): RooCodeSettings {
		const legacyKeys = ["claudeCodePath", "claudeCodeMaxOutputTokens"] as const

		let sanitizedValues = values
		for (const key of legacyKeys) {
			if (key in sanitizedValues) {
				const copy = { ...sanitizedValues } as Record<string, unknown>
				delete copy[key as string]
				sanitizedValues = copy as RooCodeSettings
			}
		}

		const isKnownProvider =
			typeof values.apiProvider === "string" &&
			(isProviderName(values.apiProvider) || isRetiredProvider(values.apiProvider))

		if (values.apiProvider !== undefined && !isKnownProvider) {
			logger.info(`[ContextProxy] Sanitizing invalid provider "${values.apiProvider}" - resetting to undefined`)
			const { apiProvider, ...restValues } = sanitizedValues
			return restValues as RooCodeSettings
		}
		return sanitizedValues
	}

	public async setProviderSettings(values: ProviderSettings) {
		if (values.openAiHeaders !== undefined) {
			if (!values.openAiHeaders || Object.keys(values.openAiHeaders).length === 0) {
				values.openAiHeaders = {}
			}
		}

		const currentState = this.store.getAllGlobalState()
		const clearedState = PROVIDER_SETTINGS_KEYS
			.filter((key) => !isSecretStateKey(key))
			.filter((key) => !!currentState[key])
			.reduce((acc, key) => ({ ...acc, [key]: undefined }), {} as ProviderSettings)

		await this.setValues({
			...clearedState,
			...values,
		})
	}

	public async setValue<K extends RooCodeSettingsKey>(key: K, value: RooCodeSettings[K]) {
		if (isSecretStateKey(key)) {
			await this.storeSecret(key as SecretStateKey, value as string)
		} else {
			await this.updateGlobalState(key as GlobalStateKey, value)
		}
	}

	public getValue<K extends RooCodeSettingsKey>(key: K): RooCodeSettings[K] {
		return isSecretStateKey(key)
			? (this.getSecret(key as SecretStateKey) as RooCodeSettings[K])
			: (this.getGlobalState(key as GlobalStateKey) as RooCodeSettings[K])
	}

	public getValues(): RooCodeSettings {
		const globalState = this.getAllGlobalState()
		const secretState = this.getAllSecretState()
		return { ...globalState, ...secretState }
	}

	public async dumpConfig(): Promise<void> {
		const globalState = this.getAllGlobalState()
		const mcpServers = globalState.mcpServers
		const mcpServersType = typeof mcpServers
		const mcpServersKeys = mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)
			? Object.keys(mcpServers)
			: []

		this.log("[GlobalConfiguration] loading complete")
		this.log(`  mcpServers type: ${mcpServersType}, keys: [${mcpServersKeys.join(", ")}], count: ${mcpServersKeys.length}`)
	}

	public async setValues(values: RooCodeSettings) {
		const entries = Object.entries(values) as [RooCodeSettingsKey, unknown][]
		await Promise.all(entries.map(([key, value]) => this.setValue(key, value)))
	}

	public async export(): Promise<GlobalSettings | undefined> {
		try {
			const globalSettings = globalSettingsExportSchema.parse(this.getValues())

			globalSettings.customModes = globalSettings.customModes?.filter((mode) => mode.source === "global")

			return Object.fromEntries(Object.entries(globalSettings).filter(([_, value]) => value !== undefined))
		} catch (error) {
			return undefined
		}
	}

	public async resetAllState() {
		await this.store.resetAll()
		await this.initialize()
	}

	private static _instance: ContextProxy | null = null

	static get instance() {
		if (!this._instance) {
			throw new Error("ContextProxy not initialized")
		}

		return this._instance
	}

	static async getInstance(context: vscode.ExtensionContext) {
		if (this._instance) {
			return this._instance
		}

		this._instance = new ContextProxy(context)
		await this._instance.initialize()

		return this._instance
	}
}