import * as vscode from "vscode"
import * as os from "os"
import * as fs from "fs/promises"
import * as path from "path"
import { ClineProvider } from "../ClineProvider"
import { t } from "../../../i18n"
import { defaultModeSlug } from "../../../shared/modes"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../../utils/export"
import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"

export const handleModeOperations = async (ctx: import("../webviewMessageHandler").HandlerContext, message: any): Promise<void> => {
	const { provider, updateGlobalState } = ctx

	switch (message.type) {
		case "updateCustomMode":
			if (message.modeConfig) {
				try {
					const existingModes = await provider.customModesManager.getCustomModes()
					const isNewMode = !existingModes.some((mode) => mode.slug === message.modeConfig?.slug)
					await provider.customModesManager.updateCustomMode(message.modeConfig.slug, message.modeConfig)
					const customModes = await provider.customModesManager.getCustomModes()
					await updateGlobalState("customModes", customModes)
					await updateGlobalState("mode", message.modeConfig.slug)
					await provider.postStateToWebview()
				} catch (error) {
					// Error already shown to user by updateCustomMode
				}
			}
			break

		case "deleteCustomMode":
			if (message.slug) {
				const customModes = await provider.customModesManager.getCustomModes()
				const modeToDelete = customModes.find((mode) => mode.slug === message.slug)

				if (!modeToDelete) {
					break
				}

				const scope = modeToDelete.source || "global"
				let rulesFolderPath: string

				if (scope === "project") {
					const workspacePath = getWorkspacePath()
					rulesFolderPath = workspacePath
						? path.join(workspacePath, ".roo", `rules-${message.slug}`)
						: path.join(".roo", `rules-${message.slug}`)
				} else {
					const homeDir = os.homedir()
					rulesFolderPath = path.join(homeDir, ".roo", `rules-${message.slug}`)
				}

				const rulesFolderExists = await fileExistsAtPath(rulesFolderPath)

				if (message.checkOnly) {
					await provider.postMessageToWebview({
						type: "deleteCustomModeCheck",
						slug: message.slug,
						rulesFolderPath: rulesFolderExists ? rulesFolderPath : undefined,
					})
					break
				}

				await provider.customModesManager.deleteCustomMode(message.slug)

				if (rulesFolderExists) {
					try {
						await fs.rm(rulesFolderPath, { recursive: true, force: true })
						provider.log(`Deleted rules folder for mode ${message.slug}: ${rulesFolderPath}`)
					} catch (error) {
						vscode.window.showErrorMessage(
							t("common:errors.delete_rules_folder_failed", {
								rulesFolderPath,
								error: error instanceof Error ? error.message : String(error),
							}),
						)
					}
				}

				await updateGlobalState("mode", defaultModeSlug)
				await provider.postStateToWebview()
			}
			break

		case "exportMode":
			if (message.slug) {
				try {
					const customModePrompts = ctx.getGlobalState("customModePrompts") || {}
					const customPrompt = customModePrompts[message.slug]
					const result = await provider.customModesManager.exportModeWithRules(message.slug, customPrompt)

					if (result.success && result.yaml) {
						const defaultUri = await resolveDefaultSaveUri(
							provider.contextProxy,
							"lastModeExportPath",
							`${message.slug}-export.yaml`,
							{ useWorkspace: true, fallbackDir: path.join(os.homedir(), "Downloads") },
						)

						const saveUri = await vscode.window.showSaveDialog({
							defaultUri,
							filters: { "YAML files": ["yaml", "yml"] },
							title: "Save mode export",
						})

						if (saveUri && result.yaml) {
							await saveLastExportPath(provider.contextProxy, "lastModeExportPath", saveUri)
							await fs.writeFile(saveUri.fsPath, result.yaml, "utf-8")
							provider.postMessageToWebview({ type: "exportModeResult", success: true, slug: message.slug })
							vscode.window.showInformationMessage(t("common:info.mode_exported", { mode: message.slug }))
						} else {
							provider.postMessageToWebview({ type: "exportModeResult", success: false, error: "Export cancelled", slug: message.slug })
						}
					} else {
						provider.postMessageToWebview({ type: "exportModeResult", success: false, error: result.error, slug: message.slug })
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					provider.log(`Failed to export mode ${message.slug}: ${errorMessage}`)
					provider.postMessageToWebview({ type: "exportModeResult", success: false, error: errorMessage, slug: message.slug })
				}
			}
			break

		case "importMode":
			try {
				const lastImportPath = ctx.getGlobalState("lastModeImportPath")
				let defaultUri: vscode.Uri | undefined

				if (lastImportPath) {
					defaultUri = vscode.Uri.file(path.dirname(lastImportPath))
				} else {
					const workspaceFolders = vscode.workspace.workspaceFolders
					if (workspaceFolders && workspaceFolders.length > 0) {
						defaultUri = vscode.Uri.file(workspaceFolders[0].uri.fsPath)
					}
				}

				const fileUri = await vscode.window.showOpenDialog({
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					defaultUri,
					filters: { "YAML files": ["yaml", "yml"] },
					title: "Select mode export file to import",
				})

				if (fileUri && fileUri[0]) {
					await updateGlobalState("lastModeImportPath", fileUri[0].fsPath)
					const yamlContent = await fs.readFile(fileUri[0].fsPath, "utf-8")
					const result = await provider.customModesManager.importModeWithRules(
						yamlContent,
						message.source || "project",
					)

					if (result.success) {
						const customModes = await provider.customModesManager.getCustomModes()
						await updateGlobalState("customModes", customModes)
						await provider.postStateToWebview()
						provider.postMessageToWebview({ type: "importModeResult", success: true, slug: result.slug })
						vscode.window.showInformationMessage(t("common:info.mode_imported"))
					} else {
						provider.postMessageToWebview({ type: "importModeResult", success: false, error: result.error })
						vscode.window.showErrorMessage(t("common:errors.mode_import_failed", { error: result.error }))
					}
				} else {
					provider.postMessageToWebview({ type: "importModeResult", success: false, error: "cancelled" })
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Failed to import mode: ${errorMessage}`)
				provider.postMessageToWebview({ type: "importModeResult", success: false, error: errorMessage })
				vscode.window.showErrorMessage(t("common:errors.mode_import_failed", { error: errorMessage }))
			}
			break

		case "checkRulesDirectory":
			if (message.slug) {
				const hasContent = await provider.customModesManager.checkRulesDirectoryHasContent(message.slug)
				provider.postMessageToWebview({ type: "checkRulesDirectoryResult", slug: message.slug, hasContent })
			}
			break
	}
}