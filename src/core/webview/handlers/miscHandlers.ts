import * as vscode from "vscode"
import * as os from "os"
import * as fs from "fs/promises"
import * as path from "path"
import { ClineProvider } from "../ClineProvider"
import { t } from "../../../i18n"
import { getCommand } from "../../../utils/commands"
import { openFile } from "../../../integrations/misc/open-file"
import { Package } from "../../../shared/package"
import { generateErrorDiagnostics } from "../diagnosticsHandler"
import { GlobalFileNames } from "../../../shared/globalFileNames"
import type { WebviewMessage } from "@roo-code/types"

export const handleMiscOperations = async (ctx: import("../webviewMessageHandler").HandlerContext, message: WebviewMessage): Promise<void> => {
	const { provider, updateGlobalState } = ctx

	switch (message.type) {
		case "focusPanelRequest":
			await vscode.commands.executeCommand(getCommand("focusPanel"))
			break

		case "switchTab":
			if (message.tab) {
				await provider.postMessageToWebview({
					type: "action",
					action: "switchTab",
					tab: message.tab,
					values: message.values,
				})
			}
			break

		case "requestModes": {
			try {
				const modes = await provider.getModes()
				await provider.postMessageToWebview({ type: "modes", modes })
			} catch (error) {
				provider.log(`Error fetching modes: ${error}`)
				await provider.postMessageToWebview({ type: "modes", modes: [] })
			}
			break
		}

		case "insertTextIntoTextarea": {
			const text = message.text
			if (text) {
				await provider.postMessageToWebview({
					type: "insertTextIntoTextarea",
					text: text,
				})
			}
			break
		}

		case "dismissUpsell": {
			if (message.upsellId) {
				try {
					const dismissedUpsells = ctx.getGlobalState("dismissedUpsells") || []
					let updatedList = dismissedUpsells
					if (!dismissedUpsells.includes(message.upsellId)) {
						updatedList = [...dismissedUpsells, message.upsellId]
						await updateGlobalState("dismissedUpsells", updatedList)
					}
					await provider.postMessageToWebview({
						type: "dismissedUpsells",
						list: updatedList,
					})
				} catch (error) {
					provider.log(`Failed to dismiss upsell: ${error}`)
				}
			}
			break
		}

		case "getDismissedUpsells": {
			const dismissedUpsells = ctx.getGlobalState("dismissedUpsells") || []
			await provider.postMessageToWebview({
				type: "dismissedUpsells",
				list: dismissedUpsells,
			})
			break
		}

		case "openMarkdownPreview": {
			if (message.text) {
				try {
					const tmpDir = os.tmpdir()
					const timestamp = Date.now()
					const tempFileName = `roo-preview-${timestamp}.md`
					const tempFilePath = path.join(tmpDir, tempFileName)

					await fs.writeFile(tempFilePath, message.text, "utf8")
					const doc = await vscode.workspace.openTextDocument(tempFilePath)
					await vscode.commands.executeCommand("markdown.showPreview", doc.uri)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					provider.log(`Error opening markdown preview: ${errorMessage}`)
					vscode.window.showErrorMessage(`Failed to open markdown preview: ${errorMessage}`)
				}
			}
			break
		}

		case "debugSetting": {
			await vscode.workspace
				.getConfiguration(Package.name)
				.update("debug", message.bool ?? false, vscode.ConfigurationTarget.Global)
			await provider.postStateToWebview()
			break
		}

		case "openAiCodexSignIn": {
			try {
				const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
				const authUrl = openAiCodexOAuthManager.startAuthorizationFlow()
				await vscode.env.openExternal(vscode.Uri.parse(authUrl))

				openAiCodexOAuthManager
					.waitForCallback()
					.then(async () => {
						vscode.window.showInformationMessage("Successfully signed in to OpenAI Codex")
						await provider.postStateToWebview()
					})
					.catch((error: unknown) => {
						provider.log(`OpenAI Codex OAuth callback failed: ${error}`)
						const errorMessage = error instanceof Error ? error.message : String(error)
						if (!errorMessage.includes("timed out")) {
							vscode.window.showErrorMessage(`OpenAI Codex sign in failed: ${errorMessage}`)
						}
					})
			} catch (error) {
				provider.log(`OpenAI Codex OAuth failed: ${error}`)
				vscode.window.showErrorMessage("OpenAI Codex sign in failed.")
			}
			break
		}

		case "openAiCodexSignOut": {
			try {
				const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
				await openAiCodexOAuthManager.clearCredentials()
				vscode.window.showInformationMessage("Signed out from OpenAI Codex")
				await provider.postStateToWebview()
			} catch (error) {
				provider.log(`OpenAI Codex sign out failed: ${error}`)
				vscode.window.showErrorMessage("OpenAI Codex sign out failed.")
			}
			break
		}

		case "requestOpenAiCodexRateLimits": {
			try {
				const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
				const accessToken = await openAiCodexOAuthManager.getAccessToken()

				if (!accessToken) {
					provider.postMessageToWebview({
						type: "openAiCodexRateLimits",
						error: "Not authenticated with OpenAI Codex",
					})
					break
				}

				const accountId = await openAiCodexOAuthManager.getAccountId()
				const { fetchOpenAiCodexRateLimitInfo } = await import("../../../integrations/openai-codex/rate-limits")
				const rateLimits = await fetchOpenAiCodexRateLimitInfo(accessToken, { accountId })

				provider.postMessageToWebview({
					type: "openAiCodexRateLimits",
					values: rateLimits,
				})
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error fetching OpenAI Codex rate limits: ${errorMessage}`)
				provider.postMessageToWebview({
					type: "openAiCodexRateLimits",
					error: errorMessage,
				})
			}
			break
		}

		case "openDebugApiHistory":
		case "openDebugUiHistory": {
			const currentTask = provider.getCurrentTask()
			if (!currentTask) {
				vscode.window.showErrorMessage("No active task to view history for")
				break
			}

			try {
				const { getTaskDirectoryPath } = await import("../../../utils/storage")
				const globalStoragePath = provider.contextProxy.globalStorageUri.fsPath
				const taskDirPath = await getTaskDirectoryPath(globalStoragePath, currentTask.taskId)

				const fileName =
					message.type === "openDebugApiHistory" ? "api_conversation_history.json" : "ui_messages.json"
				const sourceFilePath = path.join(taskDirPath, fileName)

				if (!(await import("../../../utils/fs").then(m => m.fileExistsAtPath(sourceFilePath)))) {
					vscode.window.showErrorMessage(`File not found: ${fileName}`)
					break
				}

				const content = await fs.readFile(sourceFilePath, "utf8")
				let jsonContent: unknown

				try {
					jsonContent = JSON.parse(content)
				} catch {
					vscode.window.showErrorMessage(`Failed to parse ${fileName}`)
					break
				}

				const prettifiedContent = JSON.stringify(jsonContent, null, 2)
				const tmpDir = os.tmpdir()
				const timestamp = Date.now()
				const tempFileName = `roo-debug-${message.type === "openDebugApiHistory" ? "api" : "ui"}-${currentTask.taskId.slice(0, 8)}-${timestamp}.json`
				const tempFilePath = path.join(tmpDir, tempFileName)

				await fs.writeFile(tempFilePath, prettifiedContent, "utf8")
				const doc = await vscode.workspace.openTextDocument(tempFilePath)
				await vscode.window.showTextDocument(doc, { preview: true })
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error opening debug history: ${errorMessage}`)
				vscode.window.showErrorMessage(`Failed to open debug history: ${errorMessage}`)
			}
			break
		}

		case "downloadErrorDiagnostics": {
			const currentTask = provider.getCurrentTask()
			if (!currentTask) {
				vscode.window.showErrorMessage("No active task to generate diagnostics for")
				break
			}

			await generateErrorDiagnostics({
				taskId: currentTask.taskId,
				globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
				values: message.values,
				log: (message: string) => provider.log(message),
			})
			break
		}

		case "openCustomModesSettings": {
			try {
				const settingsDir = path.join(provider.contextProxy.globalStorageUri.fsPath, "settings")
				await fs.mkdir(settingsDir, { recursive: true })
				const customModesPath = path.join(settingsDir, GlobalFileNames.customModes)

				if (!(await fs.stat(customModesPath).catch(() => null))) {
					await fs.writeFile(customModesPath, "customModes: []\n", "utf-8")
				}

				await openFile(customModesPath)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error opening custom modes settings: ${errorMessage}`)
				vscode.window.showErrorMessage(`Failed to open custom modes settings: ${errorMessage}`)
			}
			break
		}

		case "openFile": {
			try {
				const filePath = message.text
				const options = message.values as { create?: boolean; content?: string } | undefined
				if (filePath) {
					await openFile(filePath, options)
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error opening file: ${errorMessage}`)
				vscode.window.showErrorMessage(`Failed to open file: ${errorMessage}`)
			}
			break
		}

		case "importSettings": {
			try {
				const { importSettingsWithFeedback } = await import("../../../core/config/importExport")
				await importSettingsWithFeedback(
					{
						providerSettingsManager: provider.providerSettingsManager,
						contextProxy: provider.contextProxy,
						customModesManager: provider.customModesManager,
						provider: provider,
					},
					message.text,
				)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error importing settings: ${errorMessage}`)
				vscode.window.showErrorMessage(`Failed to import settings: ${errorMessage}`)
			}
			break
		}

		case "exportSettings": {
			try {
				const { exportSettings } = await import("../../../core/config/importExport")
				await exportSettings({
					providerSettingsManager: provider.providerSettingsManager,
					contextProxy: provider.contextProxy,
				})
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error exporting settings: ${errorMessage}`)
				vscode.window.showErrorMessage(`Failed to export settings: ${errorMessage}`)
			}
			break
		}
	}
}