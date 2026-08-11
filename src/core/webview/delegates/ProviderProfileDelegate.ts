import * as vscode from "vscode"
import * as path from "path"
import fs from "fs/promises"
import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"

import {
	type ExtensionState,
	type ProviderName,
	type ProviderSettings,
	type ProviderSettingsEntry,
	type HistoryItem,
	type GlobalState,
	type RooCodeSettings,
	type CodeActionId,
	type CodeActionName,
	type TerminalActionId,
	type TerminalActionPromptType,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	DEFAULT_MODES,
	openRouterDefaultModelId,
	requestyDefaultModelId,
	DEFAULT_WRITE_DELAY_MS,
	isRetiredProvider,
	getModelId,
	RooCodeEventName,
} from "@roo-code/types"

import { Package } from "../../../shared/package"
import { Mode, defaultModeSlug, getModeBySlug } from "../../../shared/modes"
import { experimentDefault } from "../../../shared/experiments"
import { formatLanguage } from "../../../shared/language"
import { EMBEDDING_MODEL_PROFILES } from "../../../shared/embeddingModels"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { McpHub } from "../../../services/mcp/McpHub"
import { getWorkspacePath } from "../../../utils/path"
import type { ClineProvider } from "../ClineProvider"
import { REQUESTY_BASE_URL } from "../../../shared/utils/requesty"

export class ProviderProfileDelegate {
	constructor(private readonly provider: ClineProvider) {}

	get providerSettingsManager() {
		return this.provider.providerSettingsManager
	}

	get contextProxy() {
		return this.provider.contextProxy
	}

	get context() {
		return this.provider.context
	}

	get taskHistoryStore() {
		return this.provider.taskHistoryStore
	}

	/**
	 * Check if config file exists and set settingsImportedAt if it does.
	 */
	public async ensureSettingsImportedAtFromConfig(): Promise<boolean> {
		if (this.provider.settingsImportedAt) {
			return false
		}

		try {
			const { getSettingsStore } = await import("../../../services/SettingsStore")
			const settingsStore = getSettingsStore()
			const configExists = await settingsStore.configFileExists()
			if (configExists && !this.provider.settingsImportedAt) {
				this.provider.settingsImportedAt = 1
				await this.context.globalState.update("settingsImportedAt", this.provider.settingsImportedAt)
				this.provider.log("[ensureSettingsImportedAtFromConfig] Config file exists, settingsImportedAt set")
				return true
			}
		} catch (error) {
			this.provider.log(`[ensureSettingsImportedAtFromConfig] Error: ${error}`)
		}

		return false
	}

	/**
	 * Hydrates runtime provider state from the persisted global settings file.
	 */
	public async hydrateProviderProfileFromConfig(): Promise<boolean> {
		try {
			const { getSettingsStore } = await import("../../../services/SettingsStore")
			const providerProfiles = await getSettingsStore().loadProviderProfiles()

			if (!providerProfiles) {
				return false
			}

			const profileName = providerProfiles?.currentApiConfigName as string | undefined

			if (!profileName) {
				return false
			}

			const ppAny = providerProfiles as any
			const ppModeConfigs = ppAny.modeApiConfigs
			let needSyncModeConfigs = false
			if (ppModeConfigs && typeof ppModeConfigs === "object" && Object.keys(ppModeConfigs).length > 0) {
				const currentGlobalStateModeConfigs = this.provider.getGlobalState("modeApiConfigs")
				const currentPpStr = JSON.stringify(ppModeConfigs)
				const currentGsStr = JSON.stringify(currentGlobalStateModeConfigs || {})
				if (currentPpStr !== currentGsStr) {
					needSyncModeConfigs = true
				}
			}

			const hasConfig = await this.providerSettingsManager.hasConfig(profileName)

			if (!hasConfig) {
				return false
			}

			await this.provider.activateProviderProfile({ name: profileName }, { persistModeConfig: false, persistTaskHistory: false })

			if (needSyncModeConfigs && ppModeConfigs) {
				await this.contextProxy.setValue("modeApiConfigs", ppModeConfigs)
			} else {
				const allModeConfigs = await this.providerSettingsManager.getAllModeConfigs()
				const gsModeConfigs = this.provider.getGlobalState("modeApiConfigs")
				if (JSON.stringify(allModeConfigs) !== JSON.stringify(gsModeConfigs || {})) {
					await this.contextProxy.setValue("modeApiConfigs", allModeConfigs)
				}
			}

			return true
		} catch (error) {
			return false
		}
	}

	/**
	 * Updates the current task's API handler.
	 */
	public updateTaskApiHandlerIfNeeded(
		providerSettings: ProviderSettings,
		options: { forceRebuild?: boolean } = {},
	): void {
		const task = this.provider.getCurrentTask()
		if (!task) return

		const { forceRebuild = false } = options

		const prevConfig = task.apiConfiguration
		const prevProvider = prevConfig?.apiProvider
		const prevModelId = prevConfig ? getModelId(prevConfig) : undefined
		const newProvider = providerSettings.apiProvider
		const newModelId = getModelId(providerSettings)

		const needsRebuild = forceRebuild || prevProvider !== newProvider || prevModelId !== newModelId

		if (needsRebuild) {
			task.updateApiConfiguration(providerSettings)
		} else {
			;(task as any).apiConfiguration = providerSettings
		}
	}

	getProviderProfileEntries(): ProviderSettingsEntry[] {
		return this.contextProxy.getValues().listApiConfigMeta || []
	}

	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.getProviderProfileEntries().find((profile) => profile.name === name)
	}

	public hasProviderProfileEntry(name: string): boolean {
		return !!this.getProviderProfileEntry(name)
	}

	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		try {
			const id = await this.providerSettingsManager.saveConfig(name, providerSettings)

			if (activate) {
				const { mode } = await this.provider.getState()

				await Promise.all([
					this.provider.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
					this.provider.updateGlobalState("currentApiConfigName", name),
					this.providerSettingsManager.setModeConfig(mode, id),
					this.contextProxy.setProviderSettings(providerSettings),
				])

				this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

				await this.persistStickyProviderProfileToCurrentTask(name)
			} else {
				await this.provider.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig())
			}

			await this.provider.postStateToWebview()
			return id
		} catch (error) {
			this.provider.log(
				`Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			vscode.window.showErrorMessage(
				(await import("../../../i18n")).t("common:errors.create_api_config"),
			)
			return undefined
		}
	}

	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry) {
		const globalSettings = this.contextProxy.getValues()
		let profileToActivate: string | undefined = globalSettings.currentApiConfigName

		if (profileToDelete.name === profileToActivate) {
			profileToActivate = this.getProviderProfileEntries().find(({ name }) => name !== profileToDelete.name)?.name
		}

		if (!profileToActivate) {
			throw new Error("You cannot delete the last profile")
		}

		const entries = this.getProviderProfileEntries().filter(({ name }) => name !== profileToDelete.name)

		await this.contextProxy.setValues({
			...globalSettings,
			currentApiConfigName: profileToActivate,
			listApiConfigMeta: entries,
		})

		await this.provider.postStateToWebview()
	}

	private async persistStickyProviderProfileToCurrentTask(apiConfigName: string): Promise<void> {
		const task = this.provider.getCurrentTask()
		if (!task) {
			return
		}

		try {
			task.setTaskApiConfigName(apiConfigName)

			const taskHistoryItem =
				this.taskHistoryStore.get(task.taskId) ??
				((await this.provider.getGlobalState("taskHistory")) ?? []).find((item: any) => item.id === task.taskId)

			if (taskHistoryItem) {
				await this.provider.updateTaskHistory({ ...taskHistoryItem, apiConfigName })
			}
		} catch (error) {
			this.provider.log(
				`Failed to persist provider profile switch for task ${task.taskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	) {
		const { name, id, ...providerSettings } = await this.providerSettingsManager.activateProfile(args)

		const persistModeConfig = options?.persistModeConfig ?? true
		const persistTaskHistory = options?.persistTaskHistory ?? true

		await Promise.all([
			this.contextProxy.setValue("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
			this.contextProxy.setValue("currentApiConfigName", name),
			this.contextProxy.setProviderSettings(providerSettings),
		])

		const { mode } = await this.provider.getState()

		if (id && persistModeConfig) {
			await this.providerSettingsManager.setModeConfig(mode, id)
			const allModeConfigs = await this.providerSettingsManager.getAllModeConfigs()
			this.contextProxy.setValue("modeApiConfigs", allModeConfigs)
		}

		this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

		if (persistTaskHistory) {
			await this.persistStickyProviderProfileToCurrentTask(name)
		}

		await this.provider.postStateToWebview()

		if (providerSettings.apiProvider) {
			this.provider.emit(RooCodeEventName.ProviderProfileChanged, { name, provider: providerSettings.apiProvider })
		}
	}

	async updateCustomInstructions(instructions?: string) {
		await this.provider.updateGlobalState("customInstructions", instructions || undefined)
		await this.provider.postStateToWebview()
	}

	async ensureMcpServersDirectoryExists(): Promise<string> {
		const os = await import("os")
		let mcpServersDir: string
		if (process.platform === "win32") {
			mcpServersDir = path.join(os.homedir(), "AppData", "Roaming", "Roo-Code", "MCP")
		} else if (process.platform === "darwin") {
			mcpServersDir = path.join(os.homedir(), "Documents", "Cline", "MCP")
		} else {
			mcpServersDir = path.join(os.homedir(), ".local", "share", "Roo-Code", "MCP")
		}

		try {
			await fs.mkdir(mcpServersDir, { recursive: true })
		} catch (error) {
			return path.join(os.homedir(), ".roo-code", "mcp")
		}
		return mcpServersDir
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		const { getSettingsDirectoryPath } = await import("../../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		return getSettingsDirectoryPath(globalStoragePath)
	}

	async handleOpenRouterCallback(code: string) {
		let { apiConfiguration, currentApiConfigName = "default" } = await this.provider.getState()

		let apiKey: string

		try {
			const baseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai/api/v1"
			const baseUrlDomain = baseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"
			const response = await axios.post(`${baseUrlDomain}/api/v1/auth/keys`, { code })

			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			this.provider.log(
				`Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			throw error
		}

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "openrouter",
			openRouterApiKey: apiKey,
			openRouterModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
		}

		await this.upsertProviderProfile(currentApiConfigName, newConfiguration)
	}

	async handleRequestyCallback(code: string, baseUrl: string | null) {
		let { apiConfiguration } = await this.provider.getState()

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "requesty",
			requestyApiKey: code,
			requestyModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
		}

		if (!baseUrl || baseUrl === REQUESTY_BASE_URL) {
			newConfiguration.requestyBaseUrl = undefined
		} else {
			newConfiguration.requestyBaseUrl = baseUrl
		}

		const profileName = `Requesty (${new Date().toLocaleString()})`
		await this.upsertProviderProfile(profileName, newConfiguration)
	}

	/**
	 * Handle switching to a new mode, including updating the associated API configuration
	 */
	public async handleModeSwitch(newMode: Mode) {
		const task = this.provider.getCurrentTask()

		if (task) {
			task.emit(RooCodeEventName.TaskModeSwitched, task.taskId, newMode)

			try {
				const taskHistoryItem =
					this.taskHistoryStore.get(task.taskId) ??
					((await this.provider.getGlobalState("taskHistory")) ?? []).find((item: any) => item.id === task.taskId)

				if (taskHistoryItem) {
					await this.provider.updateTaskHistory({ ...taskHistoryItem, mode: newMode })
				}

				;(task as any)._taskMode = newMode
			} catch (error) {
				this.provider.log(
					`Failed to persist mode switch for task ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
				)

				throw error
			}
		}

		await this.provider.updateGlobalState("mode", newMode)

		this.provider.emit(RooCodeEventName.ModeChanged, newMode)

		const lockApiConfigAcrossModes = this.context.workspaceState.get("lockApiConfigAcrossModes", false)
		if (lockApiConfigAcrossModes) {
			await this.provider.postStateToWebview()
			return
		}

		const savedConfigId = await this.providerSettingsManager.getModeConfigId(newMode)
		const listApiConfig = await this.providerSettingsManager.listConfig()

		await this.provider.updateGlobalState("listApiConfigMeta", listApiConfig)

		if (savedConfigId) {
			const profile = listApiConfig.find(({ id }) => id === savedConfigId)

			if (profile?.name) {
				const fullProfile = await this.providerSettingsManager.getProfile({ name: profile.name })
				const hasActualSettings = !!fullProfile.apiProvider

				if (hasActualSettings) {
					await this.activateProviderProfile({ name: profile.name })
				}
			}
		}

		await this.provider.postStateToWebview()
	}

	// Modes & Profiles API

	async getModes(): Promise<{ slug: string; name: string }[]> {
		const customModes = await this.provider.customModesManager.getCustomModes()
		return [...DEFAULT_MODES, ...customModes].map((m) => ({ slug: m.slug, name: m.name }))
	}

	async getMode(): Promise<string> {
		const state = await this.provider.getState()
		return state.mode || defaultModeSlug
	}

	async setMode(mode: string): Promise<void> {
		const modeObj = getModeBySlug(mode)
		if (modeObj) {
			await this.handleModeSwitch(mode)
		}
	}

	async getProviderProfiles(): Promise<ProviderSettingsEntry[]> {
		return this.getProviderProfileEntries()
	}

	async getProviderProfile(name: string): Promise<ProviderSettings> {
		return this.provider.providerSettingsManager.getProfile({ name })
	}

	async setProviderProfile(name: string, settings: ProviderSettings): Promise<void> {
		await this.upsertProviderProfile(name, settings)
	}
}