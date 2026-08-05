import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as yaml from "yaml"

import { t } from "../../i18n"
import { type ModeConfig, modeConfigSchema, type PromptComponent } from "@roo-code/types"
import { isCustomMode, getModeBySlug } from "../../shared/modes"
import { fileExistsAtPath } from "../../utils/fs"
import { getSettingsStore } from "../../services/SettingsStore"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { getWorkspacePath } from "../../utils/path"

export class CustomModesManager {
	private context: vscode.ExtensionContext
	private customModes: ModeConfig[] = []
	private onUpdateEmitter = new vscode.EventEmitter<ModeConfig[]>()
	readonly onUpdate = this.onUpdateEmitter.event
	private onUpdateCallback?: (modes: ModeConfig[]) => void

	constructor(context: vscode.ExtensionContext, onUpdate?: (modes: ModeConfig[]) => void) {
		this.context = context
		this.onUpdateCallback = onUpdate
	}

	private get store() {
		return getSettingsStore()
	}

	async initialize() {
		try {
			await this.loadCustomModes()
			console.log(`[CustomModesManager] initialize() loaded ${this.customModes.length} custom modes: ${this.customModes.map(m => m.slug).join(", ") || "(none)"}`)
			await this.updateCustomModesInGlobalState()
		} catch (error) {
			console.error(`[CustomModesManager] initialize() error: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	async getCustomModes(options: { includeBuiltIn: boolean } = { includeBuiltIn: false }): Promise<ModeConfig[]> {
		const workspaceModes = await this.getWorkspaceCustomModes()
		const globalModes = this.customModes.filter((mode) => mode.source === "global")

		const mergedModes = this.mergeCustomModes(globalModes, workspaceModes)

		if (options.includeBuiltIn) {
			return mergedModes
		}

		return mergedModes.filter((mode) => !isCustomMode(mode.slug))
	}

	async getWorkspaceCustomModes(): Promise<ModeConfig[]> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceRoot) {
			return []
		}

		const modesFilePath = path.join(workspaceRoot, ".roomodes")
		if (!(await fileExistsAtPath(modesFilePath))) {
			return []
		}

		try {
			const fs = await import("fs/promises")
			const content = await fs.readFile(modesFilePath, "utf-8")
			const parsed = JSON.parse(content)
			const modes = parsed.customModes || parsed.modes || parsed
			const modesArray = Array.isArray(modes) ? modes : [modes]

			const validModes = modesArray
				.map((mode: any) => {
					const result = modeConfigSchema.safeParse(mode)
					return result.success ? { ...result.data, source: "project" as const } : null
				})
				.filter(Boolean) as ModeConfig[]

			return validModes
		} catch (error) {
			console.error("Failed to load workspace custom modes:", error)
			return []
		}
	}

	async updateCustomMode(slug: string, mode: ModeConfig): Promise<void> {
		const existingIndex = this.customModes.findIndex((m) => m.slug === slug)
		const modeWithSource = { ...mode, source: "global" as const }

		if (existingIndex !== -1) {
			this.customModes[existingIndex] = modeWithSource
		} else {
			this.customModes.push(modeWithSource)
		}

		await this.saveCustomModes()
	}

	async deleteCustomMode(slug: string): Promise<void> {
		this.customModes = this.customModes.filter((m) => m.slug !== slug)
		await this.saveCustomModes()
	}

	async getAllCustomModes(): Promise<ModeConfig[]> {
		return this.customModes
	}

	async resetAllCustomModes(): Promise<void> {
		this.customModes = []
		await this.saveCustomModes()
	}

	private async loadCustomModes(): Promise<void> {
		try {
			// 1. First, try loading from SettingsStore's dedicated customModesCache
			const storeModes = await this.store.loadCustomModes()
			if (storeModes && storeModes.length > 0) {
				const validStoreModes = storeModes
					.map((mode: any) => {
						const result = modeConfigSchema.safeParse(mode)
						return result.success ? { ...result.data, source: "global" as const } : null
					})
					.filter(Boolean) as ModeConfig[]

				this.customModes = validStoreModes
				console.log(`[CustomModesManager] loadCustomModes from SettingsStore: loaded ${this.customModes.length} modes`)
			}

			// 2. Also try VSCode globalState as fallback for migration
			try {
				const vsCodeGlobalModes = this.context.globalState.get("customModes") as ModeConfig[] | undefined
				if (vsCodeGlobalModes && Array.isArray(vsCodeGlobalModes) && vsCodeGlobalModes.length > 0) {
					const validVsCodeModes = vsCodeGlobalModes
						.map((mode: any) => {
							const result = modeConfigSchema.safeParse(mode)
							return result.success ? { ...result.data, source: "global" as const } : null
						})
						.filter(Boolean) as ModeConfig[]

					if (validVsCodeModes.length > 0) {
						this.customModes = this.mergeCustomModes(this.customModes, validVsCodeModes)
						console.log(`[CustomModesManager] loadCustomModes: merged ${validVsCodeModes.length} VSCode globalState modes, total now: ${this.customModes.length}`)
					}
				}
			} catch (vscodeError) {
				console.warn(`[CustomModesManager] Could not read from VSCode globalState: ${vscodeError instanceof Error ? vscodeError.message : String(vscodeError)}`)
			}
		} catch (error) {
			console.error("[CustomModesManager] Failed to load custom modes:", error)
			this.customModes = []
		}
	}

	private async saveCustomModes(): Promise<void> {
		// Save to SettingsStore file (dedicated customModes field in config JSON)
		await this.store.saveCustomModes(this.customModes as unknown[])

		// Also save to VSCode globalState for backward compatibility and migration
		await this.updateCustomModesInGlobalState()

		console.log(`[CustomModesManager] saveCustomModes: saved ${this.customModes.length} custom modes`)
		this.onUpdateEmitter.fire(this.customModes)
	}

	private async updateCustomModesInGlobalState(): Promise<void> {
		try {
			await this.context.globalState.update("customModes", this.customModes)
		} catch (error) {
			console.error("Failed to update custom modes in global state:", error)
		}
	}

	private mergeCustomModes(globalModes: ModeConfig[], projectModes: ModeConfig[]): ModeConfig[] {
		const merged = [...globalModes]

		for (const projectMode of projectModes) {
			const existingIndex = merged.findIndex((m) => m.slug === projectMode.slug)
			if (existingIndex !== -1) {
				merged[existingIndex] = projectMode
			} else {
				merged.push(projectMode)
			}
		}

		return merged
	}

	async getModeBySlug(slug: string): Promise<ModeConfig | undefined> {
		const allModes = await this.getCustomModes({ includeBuiltIn: true })
		return getModeBySlug(slug, allModes)
	}

	async getCustomModesFilePath(): Promise<string> {
		const globalStoragePath = this.context.globalStorageUri.fsPath
		const settingsDir = path.join(globalStoragePath, "settings")
		const customModesPath = path.join(settingsDir, GlobalFileNames.customModes)

		await fs.mkdir(settingsDir, { recursive: true })

		if (!(await fileExistsAtPath(customModesPath))) {
			await fs.writeFile(customModesPath, "customModes: []\n", "utf-8")
		}

		return customModesPath
	}

	async checkRulesDirectoryHasContent(slug: string): Promise<boolean> {
		const workspacePath = getWorkspacePath()
		if (!workspacePath) {
			return false
		}

		const roomodesPath = path.join(workspacePath, ".roomodes")
		const settingsPath = await this.getCustomModesFilePath()

		let modeFound = false

		if (await fileExistsAtPath(roomodesPath)) {
			const content = await fs.readFile(roomodesPath, "utf-8")
			const parsed = yaml.parse(content) as any
			const modes = parsed?.customModes || []
			modeFound = modes.some((m: any) => m.slug === slug)
		} else if (await fileExistsAtPath(settingsPath)) {
			const content = await fs.readFile(settingsPath, "utf-8")
			const parsed = yaml.parse(content) as any
			const modes = parsed?.customModes || []
			modeFound = modes.some((m: any) => m.slug === slug && isCustomMode(m.slug))
		}

		if (!modeFound) {
			return false
		}

		const rulesDir = path.join(workspacePath, ".roo", `rules-${slug}`)

		try {
			const stats = await fs.stat(rulesDir)
			if (!stats.isDirectory()) {
				return false
			}
			const files = await fs.readdir(rulesDir)
			return files.length > 0
		} catch {
			return false
		}
	}

	async exportModeWithRules(
		slug: string,
		customPrompt?: PromptComponent,
	): Promise<{ success: boolean; yaml?: string; error?: string }> {
		const workspacePath = getWorkspacePath()
		if (!workspacePath) {
			return { success: false, error: "No workspace found" }
		}

		const roomodesPath = path.join(workspacePath, ".roomodes")
		const settingsPath = await this.getCustomModesFilePath()

		let modeConfig: ModeConfig | undefined
		let modeSource: "project" | "global" = "project"

		if (await fileExistsAtPath(roomodesPath)) {
			const content = await fs.readFile(roomodesPath, "utf-8")
			const parsed = yaml.parse(content) as any
			const modes = parsed?.customModes || []
			const mode = modes.find((m: any) => m.slug === slug)
			if (mode) {
				const result = modeConfigSchema.safeParse(mode)
				if (result.success) {
					modeConfig = result.data
					modeSource = "project"
				}
			}
		}

		if (!modeConfig) {
			const content = await fs.readFile(settingsPath, "utf-8")
			const parsed = yaml.parse(content) as any
			const modes = parsed?.customModes || []
			const mode = modes.find((m: any) => m.slug === slug)
			if (mode) {
				const result = modeConfigSchema.safeParse(mode)
				if (result.success) {
					modeConfig = result.data
					modeSource = "global"
				}
			}
		}

		if (!modeConfig) {
			return { success: false, error: "Mode not found" }
		}

		const rulesDir = path.join(workspacePath, ".roo", `rules-${slug}`)
		let rulesFiles: { relativePath: string; content: string }[] = []

		try {
			const stats = await fs.stat(rulesDir)
			if (stats.isDirectory()) {
				const files = await fs.readdir(rulesDir)
				for (const file of files) {
					const filePath = path.join(rulesDir, file)
					const fileStat = await fs.stat(filePath)
					if (fileStat.isFile()) {
						const content = await fs.readFile(filePath, "utf-8")
						rulesFiles.push({
							relativePath: `rules-${slug}/${file}`,
							content,
						})
					}
				}
			}
		} catch {
			// Rules directory doesn't exist, continue without rules
		}

		const exportData: any = {
			customModes: [
				{
					...modeConfig,
					rulesFiles: rulesFiles.length > 0 ? rulesFiles : undefined,
				},
			],
		}

		if (customPrompt) {
			exportData.customModePrompts = {
				[slug]: customPrompt,
			}
		}

		const yamlContent = yaml.stringify(exportData, { indent: 2, lineWidth: -1 })
		return { success: true, yaml: yamlContent }
	}

	async importModeWithRules(
		yamlContent: string,
		source: "global" | "project" = "project",
	): Promise<{ success: boolean; error?: string; slug?: string }> {
		const workspacePath = getWorkspacePath()
		if (!workspacePath) {
			return { success: false, error: "No workspace found" }
		}

		let parsed: any
		try {
			parsed = yaml.parse(yamlContent)
		} catch {
			return { success: false, error: "Invalid YAML format" }
		}

		if (!parsed || !Array.isArray(parsed.customModes) || parsed.customModes.length === 0) {
			return { success: false, error: "Invalid import format: Expected 'customModes' array in YAML" }
		}

		const validModes: ModeConfig[] = []
		for (const mode of parsed.customModes) {
			const result = modeConfigSchema.safeParse(mode)
			if (!result.success) {
				return { success: false, error: `Invalid mode configuration: ${result.error}` }
			}
			validModes.push(result.data)
		}

		if (source === "project") {
			const roomodesPath = path.join(workspacePath, ".roomodes")
			let existingModes: any[] = []

			if (await fileExistsAtPath(roomodesPath)) {
				const content = await fs.readFile(roomodesPath, "utf-8")
				existingModes = (yaml.parse(content) as any)?.customModes || []
			}

			const existingSlugs = new Set(existingModes.map((m: any) => m.slug))
			const newModes = validModes.filter((m) => !existingSlugs.has(m.slug))
			const mergedModes = [...existingModes, ...newModes]

			const rulesBaseDir = path.join(workspacePath, ".roo")

			for (const mode of validModes) {
				const modeWithRules = mode as any
				if (modeWithRules.rulesFiles && Array.isArray(modeWithRules.rulesFiles)) {
					const rulesDir = path.join(rulesBaseDir, `rules-${mode.slug}`)

					try {
						await fs.rm(rulesDir, { recursive: true, force: true })
					} catch {
						// Directory might not exist
					}

					await fs.mkdir(rulesDir, { recursive: true })

					for (const ruleFile of modeWithRules.rulesFiles) {
						const rulePath = path.join(rulesDir, ruleFile.relativePath)
						const normalizedPath = path.normalize(rulePath)
						const normalizedBaseDir = path.normalize(rulesDir)

						if (!normalizedPath.startsWith(normalizedBaseDir)) {
							continue
						}

						await fs.mkdir(path.dirname(rulePath), { recursive: true })
						await fs.writeFile(rulePath, ruleFile.content, "utf-8")
					}
				} else {
					const rulesDir = path.join(rulesBaseDir, `rules-${mode.slug}`)
					try {
						await fs.rm(rulesDir, { recursive: true, force: true })
					} catch {
						// Directory might not exist
					}
				}
			}

			await fs.writeFile(roomodesPath, yaml.stringify({ customModes: mergedModes }, { indent: 2, lineWidth: -1 }), "utf-8")
		} else {
			const settingsPath = await this.getCustomModesFilePath()
			let existingModes: any[] = []

			if (await fileExistsAtPath(settingsPath)) {
				const content = await fs.readFile(settingsPath, "utf-8")
				existingModes = (yaml.parse(content) as any)?.customModes || []
			}

			const existingSlugs = new Set(existingModes.map((m: any) => m.slug))
			const newModes = validModes.filter((m) => !existingSlugs.has(m.slug))
			const mergedModes = [...existingModes, ...newModes]

			await fs.writeFile(settingsPath, yaml.stringify({ customModes: mergedModes }, { indent: 2, lineWidth: -1 }), "utf-8")
			await this.loadCustomModes()
		}

		if (this.onUpdateCallback) {
			const allModes = await this.getCustomModes()
			this.onUpdateCallback(allModes)
		}

		return { success: true, slug: validModes[0].slug }
	}

	async dispose(): Promise<void> {
		this.onUpdateEmitter.dispose()
	}
}