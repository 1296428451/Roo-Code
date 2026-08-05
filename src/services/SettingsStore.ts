import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as yaml from "yaml"

import {
	GLOBAL_SETTINGS_KEYS,
	PROVIDER_SETTINGS_KEYS,
	SECRET_STATE_KEYS,
	GLOBAL_SECRET_KEYS,
	GLOBAL_STATE_KEYS,
	type GlobalSettings,
	type ProviderSettings,
	type SecretState,
	type GlobalState,
	type RooCodeSettings,
	isSecretStateKey,
} from "@roo-code/types"

import { logger } from "../utils/logging"
import { GlobalFileNames } from "../shared/globalFileNames"

function encodeSecret(value: string): string {
	return Buffer.from(value).toString("base64")
}

function decodeSecret(value: string): string {
	return Buffer.from(value, "base64").toString("utf-8")
}

type GlobalStateKey = keyof GlobalState
type SecretStateKey = keyof SecretState
type RooCodeSettingsKey = keyof RooCodeSettings

const MASTER_CONFIG_FILE = "roo-code-config.json"

const LEGACY_FILES = ["global-settings.yaml", "secrets.yaml", "provider-profiles.yaml"]

const VSCODE_GLOBALSTATE_MIGRATION_KEY = "vscodeGlobalStateMigratedToFile"

interface MasterConfig {
	globalSettings?: Record<string, unknown>
	secrets?: Record<string, unknown>
	providerProfiles?: Record<string, unknown>
	customModes?: unknown[]
}

export type LogFn = (message: string) => void

export class SettingsStore {
	private settingsDir: string
	private stateCache: GlobalState = {}
	private secretCache: SecretState = {}
	private providerProfilesCache: Record<string, unknown> | null = null
	private customModesCache: unknown[] | null = null
	private logFn: LogFn | null = null

	private _lock = Promise.resolve()
	private lock<T>(cb: () => Promise<T>) {
		const next = this._lock.then(cb)
		this._lock = next.catch(() => {}) as Promise<void>
		return next
	}

	constructor(settingsDir: string, logFn: LogFn | null = null) {
		this.settingsDir = settingsDir
		this.logFn = logFn
	}

	setLogger(logFn: LogFn | null) {
		this.logFn = logFn
	}

	private log(message: string) {
		logger.info(message)
		if (this.logFn) {
			this.logFn(message)
		}
	}

	get directory(): string {
		return this.settingsDir
	}

	getSettingsDir(): string {
		return this.settingsDir
	}

	async ensureDirectory(): Promise<void> {
		await fs.mkdir(this.settingsDir, { recursive: true })
	}

	private masterConfigPath(): string {
		return path.join(this.settingsDir, MASTER_CONFIG_FILE)
	}

	async configFileExists(): Promise<boolean> {
		try {
			await fs.access(this.masterConfigPath())
			return true
		} catch {
			return false
		}
	}

	private async readConfig(): Promise<MasterConfig> {
		try {
			const content = await fs.readFile(this.masterConfigPath(), "utf-8")
			const parsed = JSON.parse(content)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as MasterConfig
			}
			return {}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return {}
			}
			throw error
		}
	}

	private async writeConfig(config: MasterConfig): Promise<void> {
		const content = JSON.stringify(config, null, 2)
		await fs.writeFile(this.masterConfigPath(), content, "utf-8")
	}

	private async tryMigrateLegacyFiles(): Promise<MasterConfig | null> {
		const legacyData: MasterConfig = {}
		let foundFiles: string[] = []

		for (const file of LEGACY_FILES) {
			const filePath = path.join(this.settingsDir, file)
			try {
				const content = await fs.readFile(filePath, "utf-8")
				const parsed = yaml.parse(content)
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					foundFiles.push(file)
					if (file === "global-settings.yaml") {
						legacyData.globalSettings = parsed as Record<string, unknown>
					} else if (file === "secrets.yaml") {
						legacyData.secrets = parsed as Record<string, unknown>
					} else if (file === "provider-profiles.yaml") {
						legacyData.providerProfiles = parsed as Record<string, unknown>
					}
				}
			} catch {
				// file doesn't exist or can't be read, skip
			}
		}

		const hasLegacyData = Object.values(legacyData).some((v) => v !== undefined && Object.keys(v).length > 0)
		if (!hasLegacyData) return null

		return legacyData
	}

	/**
	 * Migrates settings from VS Code's globalState and secrets APIs into the file-based SettingsStore.
	 * This is necessary because older versions of the extension stored settings in VS Code's globalState/secrets.
	 */
	async tryMigrateFromVscodeStorage(
		vscodeContext: vscode.ExtensionContext,
	): Promise<boolean> {
		try {
			const migrationDone = vscodeContext.globalState.get<boolean>(VSCODE_GLOBALSTATE_MIGRATION_KEY)

			const configExists = await this.configFileExists()
			let existingConfig: MasterConfig | null = null
			if (configExists) {
				existingConfig = await this.readConfig()
			}

			const existingGlobalSettingsKeys = Object.keys(existingConfig?.globalSettings || {})
			const existingProviderProfiles = existingConfig?.providerProfiles
				? Object.keys(existingConfig.providerProfiles).length > 0
				: false

			const globalSettingsFromVscode: Record<string, unknown> = {}
			const secretsFromVscode: Record<string, string> = {}
			let providerProfilesFromVscode: Record<string, unknown> | null = null

			// 1. Collect global state (non-secret settings) from VS Code globalState
			const foundGlobalKeys: string[] = []
			for (const key of GLOBAL_STATE_KEYS) {
				try {
					const value = vscodeContext.globalState.get(key as string)
					if (value !== undefined) {
						globalSettingsFromVscode[key as string] = value
						foundGlobalKeys.push(key as string)
					}
				} catch {
					// ignore individual key errors
				}
			}

			// Special handling for listApiConfigMeta, currentApiConfigName and other list type data
			;["listApiConfigMeta", "currentApiConfigName", "pinnedApiConfigs", "modeApiConfigs", "customModes"].forEach(
				(key) => {
					try {
						const value = vscodeContext.globalState.get(key)
						if (value !== undefined) {
							globalSettingsFromVscode[key] = value
							if (!foundGlobalKeys.includes(key)) {
								foundGlobalKeys.push(key)
							}
						}
					} catch {
						// ignore
					}
				},
			)

			// 2. Collect secrets from VS Code secrets API
			const foundSecretKeys: string[] = []
			for (const key of [...SECRET_STATE_KEYS, ...GLOBAL_SECRET_KEYS]) {
				try {
					const value = await vscodeContext.secrets.get(key)
					if (value !== undefined && value !== "") {
						secretsFromVscode[key] = value
						foundSecretKeys.push(key)
					}
				} catch {
					// ignore individual key errors
				}
			}

			// 3. Try to load provider profiles from old secrets (stored under the old key format
			const oldProviderConfigKey = "roo_cline_config_api_config"
			try {
				const profilesJson = await vscodeContext.secrets.get(oldProviderConfigKey)
				if (profilesJson) {
					try {
						const parsed = JSON.parse(profilesJson)
						if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
							if ("currentApiConfigName" in parsed || "apiConfigs" in parsed) {
								providerProfilesFromVscode = parsed
							}
						}
					} catch (e) {
					}
				}
			} catch {
				// ignore
			}

			const hasData =
				foundGlobalKeys.length > 0 || foundSecretKeys.length > 0 || providerProfilesFromVscode !== null

			if (!hasData) {
				if (!migrationDone) {
					await vscodeContext.globalState.update(VSCODE_GLOBALSTATE_MIGRATION_KEY, true)
				}
				return false
			}

			// If migration already done and config exists? Skip.
			// We only want to migrate once; but we can always re-import if the file has no data yet.
			const configHasData =
				existingGlobalSettingsKeys.length > 0 || existingProviderProfiles

			if (migrationDone && configHasData) {
				return false
			}

				// Merge: Only migrate keys that don't already exist in the config file
			const config: MasterConfig = existingConfig || {}
			let mergedCount = 0

			// Extract special keys that should be top-level config keys, not globalSettings
			// customModes: should be config.customModes, not config.globalSettings.customModes
			let customModesToMigrate: unknown[] | null = null
			const cleanedGlobalSettings: Record<string, unknown> = {}
			for (const [key, value] of Object.entries(globalSettingsFromVscode)) {
				if (key === "customModes" && Array.isArray(value) && value.length > 0) {
					customModesToMigrate = value
				} else {
					cleanedGlobalSettings[key] = value
				}
			}

			// Merge global settings
			if (Object.keys(cleanedGlobalSettings).length > 0) {
				const existing = config.globalSettings || {}
				const merged: Record<string, unknown> = { ...existing }
				for (const [key, value] of Object.entries(cleanedGlobalSettings)) {
					if (!(key in existing)) {
						merged[key] = value
						mergedCount++
					}
				}
				config.globalSettings = merged
			}

			// Migrate customModes to TOP-LEVEL config.customModes (not nested in globalSettings!)
			if (customModesToMigrate && customModesToMigrate.length > 0) {
				if (!config.customModes || config.customModes.length === 0) {
					config.customModes = customModesToMigrate
					mergedCount += customModesToMigrate.length
				}
			}

			if (Object.keys(secretsFromVscode).length > 0) {
				const existing = config.secrets || {}
				const mergedSecrets: Record<string, unknown> = { ...existing }
				for (const [key, value] of Object.entries(secretsFromVscode)) {
					if (!(key in existing)) {
						mergedSecrets[key] = encodeSecret(value)
						mergedCount++
					}
				}
				config.secrets = mergedSecrets

				// Also put image generation secret into globalSettings as GLOBAL_SECRET_KEYS are expected there
				for (const key of GLOBAL_SECRET_KEYS) {
					if (secretsFromVscode[key] && config.globalSettings && !(key in config.globalSettings)) {
						;(config.globalSettings as Record<string, unknown>)[key] = encodeSecret(secretsFromVscode[key])
					}
				}
			}

			// Merge provider profiles
			if (providerProfilesFromVscode && !config.providerProfiles) {
				config.providerProfiles = providerProfilesFromVscode
				mergedCount++
			}

			if (mergedCount === 0 && !providerProfilesFromVscode) {
				await vscodeContext.globalState.update(VSCODE_GLOBALSTATE_MIGRATION_KEY, true)
				return false
			}

			// Write the merged config
			await this.writeConfig(config)
			await vscodeContext.globalState.update(VSCODE_GLOBALSTATE_MIGRATION_KEY, true)

			return true
		} catch (error) {
			return false
		}
	}

	async loadAll(): Promise<void> {
		await this.ensureDirectory()

		let config = await this.readConfig()
		let configNeedsWrite = false

		const configFileExists = await this.configFileExists()

		if (Object.keys(config).length === 0) {
			const legacy = await this.tryMigrateLegacyFiles()
			if (legacy) {
				config = legacy
				configNeedsWrite = true
				for (const file of LEGACY_FILES) {
					const filePath = path.join(this.settingsDir, file)
					try {
						await fs.unlink(filePath)
					} catch {
					}
				}
			}
		}

		if (!config.customModes || !Array.isArray(config.customModes) || config.customModes.length === 0) {
			const nestedCustomModes = (config.globalSettings as Record<string, unknown>)?.customModes
			if (nestedCustomModes && Array.isArray(nestedCustomModes) && nestedCustomModes.length > 0) {
				config.customModes = nestedCustomModes
				delete (config.globalSettings as Record<string, unknown>).customModes
				configNeedsWrite = true
			}
		}

		const globalData = config.globalSettings || {}
		const secretData: Record<string, unknown> = { ...(config.secrets || {}) }

		const secretKeyCount = Object.keys(secretData).length
		if (config.secrets) {
			delete config.secrets
			configNeedsWrite = true
		}

		if (configNeedsWrite) {
			await this.writeConfig(config)
		}

		let loadedGlobalCount = 0
		const loadedGlobalKeys: string[] = []
		for (const key of GLOBAL_SETTINGS_KEYS) {
			if (key in globalData) {
				this.stateCache[key as keyof GlobalState] = globalData[key] as any
				loadedGlobalCount++
				loadedGlobalKeys.push(key as string)
			}
		}

		for (const key of PROVIDER_SETTINGS_KEYS) {
			if (isSecretStateKey(key)) continue
			if (key in globalData) {
				this.stateCache[key as keyof GlobalState] = globalData[key] as any
				loadedGlobalCount++
				loadedGlobalKeys.push(key as string)
			}
		}

		if ("taskHistory" in globalData) {
			const th = globalData.taskHistory
		}
		if ("mcpEnabled" in globalData) {
		}
		if ("modeApiConfigs" in globalData) {
		}

		// Load mcpServers from mcp_settings.json if master config has no valid mcpServers
		const mcpServersInGlobalData = "mcpServers" in globalData ? globalData.mcpServers : undefined
		const hasValidMcpServersInGlobalData =
			mcpServersInGlobalData &&
			typeof mcpServersInGlobalData === "object" &&
			!Array.isArray(mcpServersInGlobalData) &&
			Object.keys(mcpServersInGlobalData).length > 0

		if (!hasValidMcpServersInGlobalData) {
			try {
				const mcpSettingsPath = path.join(this.settingsDir, GlobalFileNames.mcpSettings)
				const mcpContent = await fs.readFile(mcpSettingsPath, "utf-8")
				const mcpConfig = JSON.parse(mcpContent)
				if (mcpConfig && typeof mcpConfig === "object" && "mcpServers" in mcpConfig) {
					const mcpServers = mcpConfig.mcpServers
					if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers) && Object.keys(mcpServers).length > 0) {
						this.stateCache["mcpServers" as keyof GlobalState] = mcpServers as any
						loadedGlobalCount++
						loadedGlobalKeys.push("mcpServers")
					}
				}
			} catch (err) {
				// mcp_settings.json doesn't exist or can't be read - that's fine
			}
		}

		let loadedSecretCount = 0
		for (const key of SECRET_STATE_KEYS) {
			if (key in secretData) {
				const encodedValue = secretData[key]
				if (typeof encodedValue === "string") {
					this.secretCache[key as SecretStateKey] = decodeSecret(encodedValue) as any
				} else {
					this.secretCache[key as SecretStateKey] = encodedValue as any
				}
				loadedSecretCount++
			}
		}

		for (const key of GLOBAL_SECRET_KEYS) {
			if (key in secretData) {
				const encodedValue = secretData[key]
				if (typeof encodedValue === "string") {
					this.secretCache[key as SecretStateKey] = decodeSecret(encodedValue) as any
				} else {
					this.secretCache[key as SecretStateKey] = encodedValue as any
				}
				loadedSecretCount++
			}
		}

		if (config.providerProfiles) {
			this.providerProfilesCache = config.providerProfiles
		}

		if (config.customModes) {
			this.customModesCache = config.customModes
		}
	}

	getGlobalState<K extends GlobalStateKey>(key: K): GlobalState[K] {
		return this.stateCache[key]
	}

	setGlobalState<K extends GlobalStateKey>(key: K, value: GlobalState[K]): void {
		this.stateCache[key] = value
	}

	getSecret<K extends SecretStateKey>(key: K): SecretState[K] {
		return this.secretCache[key]
	}

	setSecret<K extends SecretStateKey>(key: K, value: SecretState[K]): void {
		this.secretCache[key] = value
	}

	private buildGlobalSettingsData(): Record<string, unknown> {
		const data: Record<string, unknown> = {}

		for (const key of GLOBAL_SETTINGS_KEYS) {
			const value = this.stateCache[key as keyof GlobalState]
			if (value !== undefined) {
				data[key] = value
			}
		}

		for (const key of PROVIDER_SETTINGS_KEYS) {
			if (isSecretStateKey(key)) continue
			const value = this.stateCache[key as keyof GlobalState]
			if (value !== undefined) {
				data[key] = value
			}
		}

		return data
	}

	private buildSecretsData(): Record<string, unknown> {
		const data: Record<string, unknown> = {}

		for (const key of SECRET_STATE_KEYS) {
			const value = this.secretCache[key as SecretStateKey]
			if (value !== undefined) {
				data[key] = encodeSecret(value as string)
			}
		}

		for (const key of GLOBAL_SECRET_KEYS) {
			const value = this.secretCache[key as SecretStateKey]
			if (value !== undefined) {
				data[key] = encodeSecret(value as string)
			}
		}

		return data
	}

	async persistGlobalSettings(): Promise<void> {
		await this.lock(async () => {
			await this.ensureDirectory()

			const config = await this.readConfig()
			config.globalSettings = this.buildGlobalSettingsData()
			await this.writeConfig(config)
		})
	}

	async persistSecrets(): Promise<void> {
		await this.lock(async () => {
			await this.ensureDirectory()

			const config = await this.readConfig()
			if (Object.keys(config.secrets || {}).length > 0) {
				config.secrets = this.buildSecretsData()
			} else {
				delete config.secrets
			}
			await this.writeConfig(config)
		})
	}

	async persistAll(): Promise<void> {
		await this.lock(async () => {
			await this.ensureDirectory()

			const config = await this.readConfig()
			config.globalSettings = this.buildGlobalSettingsData()
			if (Object.keys(config.secrets || {}).length > 0) {
				config.secrets = this.buildSecretsData()
			} else {
				delete config.secrets
			}
			await this.writeConfig(config)
		})
	}

	async loadProviderProfiles(): Promise<Record<string, unknown> | null> {
		await this.ensureDirectory()

		if (this.providerProfilesCache !== null) {
			const keys = Object.keys(this.providerProfilesCache)
			if (keys.length === 0) return null
			return this.providerProfilesCache
		}

		const config = await this.readConfig()
		if (config.providerProfiles && Object.keys(config.providerProfiles).length > 0) {
			const jsonString = JSON.stringify(config.providerProfiles)
			const parsed = JSON.parse(jsonString) as Record<string, unknown>
			this.providerProfilesCache = parsed
			return this.providerProfilesCache
		}

		return null
	}

	async saveProviderProfiles(profiles: Record<string, unknown>): Promise<void> {
		await this.lock(async () => {
			await this.ensureDirectory()

			this.providerProfilesCache = profiles

			const config = await this.readConfig()
			const jsonString = JSON.stringify(profiles)
			config.providerProfiles = JSON.parse(jsonString)
			await this.writeConfig(config)
		})
	}

	async loadCustomModes(): Promise<unknown[] | null> {
		await this.ensureDirectory()

		if (this.customModesCache !== null) {
			return this.customModesCache
		}

		const config = await this.readConfig()
		if (config.customModes && Array.isArray(config.customModes) && config.customModes.length > 0) {
			this.customModesCache = config.customModes
			return config.customModes
		}

		return null
	}

	async saveCustomModes(modes: unknown[]): Promise<void> {
		await this.lock(async () => {
			await this.ensureDirectory()

			this.customModesCache = modes

			const config = await this.readConfig()
			config.customModes = modes
			await this.writeConfig(config)
		})
	}

	async resetAll(): Promise<void> {
		this.stateCache = {}
		this.secretCache = {}
		this.providerProfilesCache = null
		this.customModesCache = null

		try {
			await fs.unlink(this.masterConfigPath())
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				logger.error(`Failed to delete master config: ${error}`)
			}
		}
	}

	getAllGlobalState(): GlobalState {
		const result: Record<string, unknown> = {}
		for (const key of GLOBAL_SETTINGS_KEYS) {
			result[key] = this.stateCache[key as keyof GlobalState]
		}
		for (const key of PROVIDER_SETTINGS_KEYS) {
			if (isSecretStateKey(key)) continue
			result[key] = this.stateCache[key as keyof GlobalState]
		}
		return result as GlobalState
	}

	getAllSecretState(): SecretState {
		const result: Record<string, unknown> = {}
		for (const key of SECRET_STATE_KEYS) {
			result[key] = this.secretCache[key as SecretStateKey]
		}
		for (const key of GLOBAL_SECRET_KEYS) {
			result[key] = this.secretCache[key as SecretStateKey]
		}
		return result as SecretState
	}

	getValues(): RooCodeSettings {
		const globalState = this.getAllGlobalState()
		const secretState = this.getAllSecretState()
		return { ...globalState, ...secretState }
	}
}

let _store: SettingsStore | null = null

export function getSettingsStore(): SettingsStore {
	if (!_store) {
		throw new Error("SettingsStore not initialized. Call initSettingsStore first.")
	}
	return _store
}

export async function initSettingsStore(settingsDir: string, logFn: LogFn | null = null): Promise<SettingsStore> {
	if (_store) {
		if (logFn) {
			_store.setLogger(logFn)
		}
		return _store
	}
	_store = new SettingsStore(settingsDir, logFn)
	await _store.loadAll()
	return _store
}

export function resetSettingsStore(): void {
	_store = null
}