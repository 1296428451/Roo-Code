import os from "os"
import * as path from "path"
import fs from "fs/promises"
import * as yaml from "yaml"

import * as vscode from "vscode"
import { z, ZodError } from "zod"

import {
	globalSettingsSchema,
	providerSettingsWithIdSchema,
	isProviderName,
	type ProviderSettingsWithId,
} from "@roo-code/types"

import { ProviderSettingsManager, providerProfilesSchema } from "./ProviderSettingsManager"
import { ContextProxy } from "./ContextProxy"
import { CustomModesManager } from "./CustomModesManager"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../utils/export"
import { t } from "../../i18n"

export type ImportOptions = {
	providerSettingsManager: ProviderSettingsManager
	contextProxy: ContextProxy
	customModesManager: CustomModesManager
}

type ExportOptions = {
	providerSettingsManager: ProviderSettingsManager
	contextProxy: ContextProxy
}
type ImportWithProviderOptions = ImportOptions & {
	provider: {
		settingsImportedAt?: number
		postStateToWebview: () => Promise<void>
	}
}

function sanitizeProviderConfig(configName: string, apiConfig: unknown): { config: unknown; warning?: string } {
	if (typeof apiConfig !== "object" || apiConfig === null) {
		return { config: apiConfig }
	}

	const config = apiConfig as Record<string, unknown>

	if (config.apiProvider !== undefined && !isProviderName(config.apiProvider)) {
		const invalidProvider = config.apiProvider
		const { apiProvider, ...restConfig } = config
		return {
			config: restConfig,
			warning: `Profile "${configName}": Invalid provider "${invalidProvider}" was removed. Please reconfigure this profile.`,
		}
	}

	return { config: apiConfig }
}

function parseFileContent(content: string, filePath: string): unknown {
	if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
		return yaml.parse(content)
	}

	return JSON.parse(content)
}

export async function importSettingsFromPath(
	filePath: string,
	{ providerSettingsManager, contextProxy, customModesManager }: ImportOptions,
) {
	const lenientProviderProfilesSchema = providerProfilesSchema.extend({
		apiConfigs: z.record(z.string(), z.any()),
	})

	const lenientSchema = z.object({
		providerProfiles: lenientProviderProfilesSchema,
		globalSettings: globalSettingsSchema.optional(),
		secrets: z.unknown().optional(),
	})

	try {
		const previousProviderProfiles = await providerSettingsManager.export()

		const rawContent = await fs.readFile(filePath, "utf-8")
		const rawData = parseFileContent(rawContent, filePath)
		const { providerProfiles: rawProviderProfiles, globalSettings = {} } = lenientSchema.parse(rawData)

		const warnings: string[] = []
		const validApiConfigs: Record<string, ProviderSettingsWithId> = {}

		for (const [configName, rawConfig] of Object.entries(rawProviderProfiles.apiConfigs)) {
			const { config: sanitizedConfig, warning } = sanitizeProviderConfig(configName, rawConfig)
			if (warning) {
				warnings.push(warning)
			}

			const result = providerSettingsWithIdSchema.safeParse(sanitizedConfig)
			if (result.success) {
				validApiConfigs[configName] = result.data
			} else {
				const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")
				warnings.push(`Profile "${configName}" was skipped: ${issues}`)
			}
		}

		if (Object.keys(validApiConfigs).length === 0 && warnings.length > 0) {
			return {
				success: false,
				error: `No valid profiles could be imported:\n${warnings.join("\n")}`,
			}
		}

		let currentApiConfigName = rawProviderProfiles.currentApiConfigName
		const validProfileNames = Object.keys(validApiConfigs)
		if (!validApiConfigs[currentApiConfigName]) {
			if (validProfileNames.length > 0) {
				currentApiConfigName = validProfileNames[0]
				warnings.push(
					`Profile "${rawProviderProfiles.currentApiConfigName}" was not available; defaulting to "${currentApiConfigName}".`,
				)
			} else {
				currentApiConfigName = previousProviderProfiles.currentApiConfigName
			}
		}

		const providerProfiles = {
			currentApiConfigName,
			apiConfigs: {
				...previousProviderProfiles.apiConfigs,
				...validApiConfigs,
			},
			modeApiConfigs: {
				...previousProviderProfiles.modeApiConfigs,
				...rawProviderProfiles.modeApiConfigs,
			},
		}

		await Promise.all(
			(globalSettings.customModes ?? []).map((mode) => customModesManager.updateCustomMode(mode.slug, mode)),
		)

		await providerSettingsManager.import(providerProfiles)
		await contextProxy.setValues(globalSettings)

		const currentProviderName = providerProfiles.currentApiConfigName
		const currentProvider = providerProfiles.apiConfigs[currentProviderName]
		await contextProxy.setValue("currentApiConfigName", currentProviderName)

		if (currentProvider) {
			await contextProxy.setProviderSettings(currentProvider)
		}

		await contextProxy.setValue("listApiConfigMeta", await providerSettingsManager.listConfig())

		return {
			providerProfiles,
			globalSettings,
			success: true,
			warnings: warnings.length > 0 ? warnings : undefined,
		}
	} catch (e) {
		let error = "Unknown error"

		if (e instanceof ZodError) {
			error = e.issues.map((issue) => `[${issue.path.join(".")}]: ${issue.message}`).join("\n")
		} else if (e instanceof Error) {
			error = e.message
		}

		return { success: false, error }
	}
}

export const importSettings = async ({ providerSettingsManager, contextProxy, customModesManager }: ImportOptions) => {
	const defaultUri = resolveDefaultSaveUri(contextProxy, "lastSettingsExportPath", "roo-code-settings.yaml", {
		useWorkspace: false,
		fallbackDir: path.join(os.homedir(), "Downloads"),
	})

	let uris: vscode.Uri[] | undefined
	try {
		uris = await vscode.window.showOpenDialog({
			filters: { "Settings Files": ["yaml", "yml", "json"] },
			canSelectMany: false,
			defaultUri,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return { success: false, error: `Failed to open file dialog: ${errorMessage}` }
	}

	if (!uris || uris.length === 0) {
		return { success: false, error: "User cancelled file selection" }
	}

	return importSettingsFromPath(uris[0].fsPath, {
		providerSettingsManager,
		contextProxy,
		customModesManager,
	})
}

export const importSettingsFromFile = async (
	{ providerSettingsManager, contextProxy, customModesManager }: ImportOptions,
	fileUri: vscode.Uri,
) => {
	return importSettingsFromPath(fileUri.fsPath, {
		providerSettingsManager,
		contextProxy,
		customModesManager,
	})
}

export const exportSettings = async ({ providerSettingsManager, contextProxy }: ExportOptions) => {
	const defaultUri = await resolveDefaultSaveUri(contextProxy, "lastSettingsExportPath", "roo-code-settings.json", {
		useWorkspace: false,
		fallbackDir: path.join(os.homedir(), "Downloads"),
	})

	const uri = await vscode.window.showSaveDialog({
		filters: { "JSON": ["json"], "YAML": ["yaml", "yml"] },
		defaultUri,
	})

	if (!uri) {
		return
	}

	await saveLastExportPath(contextProxy, "lastSettingsExportPath", uri)

	try {
		const providerProfiles = await providerSettingsManager.export()
		const globalSettings = await contextProxy.export()

		if (typeof providerProfiles === "undefined") {
			return
		}

		const dirname = path.dirname(uri.fsPath)
		await fs.mkdir(dirname, { recursive: true })

		const exportData = { providerProfiles, globalSettings }

		if (uri.fsPath.endsWith(".yaml") || uri.fsPath.endsWith(".yml")) {
			await fs.writeFile(uri.fsPath, yaml.stringify(exportData, { indent: 2, lineWidth: -1 }), "utf-8")
		} else {
			await fs.writeFile(uri.fsPath, JSON.stringify(exportData, null, 2), "utf-8")
		}
	} catch (e) {
		console.error("Failed to export settings:", e)
	}
}

export const importSettingsWithFeedback = async (
	{ providerSettingsManager, contextProxy, customModesManager, provider }: ImportWithProviderOptions,
	filePath?: string,
) => {
	let result

	if (filePath) {
		try {
			await fs.access(filePath, fs.constants.F_OK | fs.constants.R_OK)
			result = await importSettingsFromPath(filePath, {
				providerSettingsManager,
				contextProxy,
				customModesManager,
			})
		} catch (error) {
			result = {
				success: false,
				error: `Cannot access file at path "${filePath}": ${error instanceof Error ? error.message : "Unknown error"}`,
			}
		}
	} else {
		result = await importSettings({ providerSettingsManager, contextProxy, customModesManager })
	}

	if (result.success) {
		const timestamp = Date.now()
		provider.settingsImportedAt = timestamp
		await provider.context.globalState.update("settingsImportedAt", timestamp)
		await provider.postStateToWebview()

		if (result.warnings && result.warnings.length > 0) {
			console.warn("Settings import completed with warnings:", result.warnings)

			const count = result.warnings.length
			const summary =
				count === 1 ? `1 profile had issues during import.` : `${count} profiles had issues during import.`
			await vscode.window.showWarningMessage(
				`${t("common:info.settings_imported")} ${summary} See Developer Tools console for details.`,
			)
		} else {
			await vscode.window.showInformationMessage(t("common:info.settings_imported"))
		}
	} else if (result.error) {
		await vscode.window.showErrorMessage(t("common:errors.settings_import_failed", { error: result.error }))
	}
}