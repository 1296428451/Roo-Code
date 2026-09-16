import type { WebviewMessage } from "@roo-code/types"
import * as vscode from "vscode"

import { ClineProvider } from "./ClineProvider"
import {
	handleRequestSkills,
	handleCreateSkill,
	handleDeleteSkill,
	handleMoveSkill,
	handleUpdateSkillModes,
	handleOpenSkillFile,
} from "./skillsMessageHandler"
import {
	createHandlerContext,
	handleTaskOperations,
	handleChatOperations,
	handleApiConfigOperations,
	handleModeOperations,
	handleCodeIndexOperations,
	handleCommandOperations,
	handleMiscOperations,
	handlePromptOperations,
	handleSearchOperations,
	handleWorktreeOperations,
	handleMcpOperations,
	handleProviderOperations,
	handleModelOperations,
	handleCheckpointOperations,
} from "./handlers"

export type { HandlerContext } from "./handlers/context"

export const webviewMessageHandler = async (provider: ClineProvider, message: WebviewMessage) => {
	const ctx = createHandlerContext(provider)

	switch (message.type) {
		case "webviewDidLaunch":
		case "askResponse":
		case "mode":
		case "updateSettings":
		case "autoApprovalEnabled":
		case "resetState":
		case "getVSCodeSetting":
		case "customInstructions":
		case "didShowAnnouncement":
		case "hasOpenedModeSelector":
		case "lockApiConfigAcrossModes":
		case "toggleApiConfigPin":
		case "enhancementApiConfigId":
		case "playTts":
		case "stopTts":
			await handleProviderOperations(ctx, message)
			break

		case "newTask":
		case "clearTask":
		case "deleteTask":
		case "deleteTaskWithId":
		case "deleteMultipleTasksWithIds":
		case "pauseTask":
		case "resumeTask":
		case "abortTask":
		case "focusTask":
		case "switchToTask":
		case "cancelTask":
		case "resetTask":
		case "showTaskWithId":
		case "exportCurrentTask":
		case "exportTaskWithId":
		case "condenseTaskContextRequest":
		case "cancelAutoApproval":
		case "terminalOperation":
		case "getTaskWithAggregatedCosts":
		case "backgroundActiveTask":
		case "foregroundBackgroundTask":
		case "stopBackgroundTask":
			await handleTaskOperations(ctx, message)
			break

		case "submit":
		case "deleteMessage":
		case "editMessage":
		case "deleteMessageConfirm":
		case "editMessageConfirm":
		case "submitEditedMessage":
		case "queueMessage":
		case "removeQueuedMessage":
		case "editQueuedMessage":
		case "searchCommits":
			await handleChatOperations(ctx, message)
			break

		case "saveApiConfiguration":
		case "upsertApiConfiguration":
		case "renameApiConfiguration":
		case "loadApiConfiguration":
		case "loadApiConfigurationById":
		case "deleteApiConfiguration":
		case "getListApiConfiguration":
			await handleApiConfigOperations(ctx, message)
			break

		case "updateCustomMode":
		case "deleteCustomMode":
		case "exportMode":
		case "importMode":
		case "checkRulesDirectory":
			await handleModeOperations(ctx, message)
			break

		case "saveCodeIndexSettingsAtomic":
		case "requestIndexingStatus":
		case "requestCodeIndexSecretStatus":
		case "startIndexing":
		case "stopIndexing":
		case "toggleWorkspaceIndexing":
		case "setAutoEnableDefault":
		case "setIndexWorkspacePath":
		case "clearIndexData":
			await handleCodeIndexOperations(ctx, message)
			break

		case "requestCommands":
		case "openCommandFile":
		case "deleteCommand":
		case "createCommand":
			await handleCommandOperations(ctx, message)
			break

		case "focusPanelRequest":
		case "switchTab":
		case "requestModes":
		case "insertTextIntoTextarea":
		case "dismissUpsell":
		case "getDismissedUpsells":
		case "openMarkdownPreview":
		case "debugSetting":
		case "openAiCodexSignIn":
		case "openAiCodexSignOut":
		case "requestOpenAiCodexRateLimits":
		case "openDebugApiHistory":
		case "openDebugUiHistory":
		case "downloadErrorDiagnostics":
		case "openCustomModesSettings":
		case "openFile":
		case "importSettings":
		case "exportSettings":
		case "openExternal":
		case "openMention":
		case "openKeyboardShortcuts":
		case "updateVSCodeSetting":
		case "readFileContent":
		case "draggedImages":
			await handleMiscOperations(ctx, message)
			break

		case "updatePrompt":
		case "enhancePrompt":
		case "getSystemPrompt":
		case "copySystemPrompt":
			await handlePromptOperations(ctx, message)
			break

		case "searchFiles":
		case "refreshCustomTools":
			await handleSearchOperations(ctx, message)
			break

		case "toggleMcpServer":
		case "updateMcpTimeout":
		case "deleteMcpServer":
		case "restartMcpServer":
		case "refreshAllMcpServers":
		case "openMcpSettings":
		case "openProjectMcpSettings":
		case "toggleToolAlwaysAllow":
		case "toggleToolEnabledForPrompt":
			await handleMcpOperations(ctx, message)
			break

		case "browseForWorktreePath":
		case "listWorktrees":
		case "createWorktree":
		case "deleteWorktree":
		case "switchWorktree":
		case "getAvailableBranches":
		case "getWorktreeDefaults":
		case "getWorktreeIncludeStatus":
		case "checkBranchWorktreeInclude":
		case "createWorktreeInclude":
		case "checkoutBranch":
			await handleWorktreeOperations(ctx, message)
			break

		case "requestSkills":
			await handleRequestSkills(provider)
			break

		case "createSkill":
			await handleCreateSkill(provider, message)
			break

		case "deleteSkill":
			await handleDeleteSkill(provider, message)
			break

		case "moveSkill":
			await handleMoveSkill(provider, message)
			break

		case "updateSkillModes":
			await handleUpdateSkillModes(provider, message)
			break

		case "openSkillFile":
			await handleOpenSkillFile(provider, message)
			break

		case "flushRouterModels":
		case "requestRouterModels":
		case "requestOllamaModels":
		case "requestLmStudioModels":
		case "requestOpenAiModels":
		case "requestVsCodeLmModels":
			await handleModelOperations(ctx, message)
			break

		case "checkpointRestore":
		case "checkpointDiff":
			await handleCheckpointOperations(ctx, message)
			break

		case "restoreDeletedFile": {
			const task = provider.getCurrentTask()
			const relativePath = message.text
			const overwrite = message.values?.overwrite === true
			if (!task || !relativePath) {
				break
			}

			// If the target file already exists AND the user has not yet
			// confirmed overwrite, ask via a native modal first.
			if (!overwrite) {
				const cwd = task.cwd
				const targetPath = cwd
					? require("path").resolve(cwd, relativePath)
					: relativePath
				const fs = require("fs") as typeof import("fs")
				if (fs.existsSync(targetPath)) {
					const choice = await vscode.window.showWarningMessage(
						`A file already exists at "${relativePath}". Overwrite it with the trashed version?`,
						{ modal: true },
						"Overwrite",
						"Cancel",
					)
					if (choice !== "Overwrite") {
						// User cancelled — surface that as a non-error result so the
						// UI drops its loading state.
						provider.postMessageToWebview({
							type: "fileRestoreResult",
							fileRestoreResult: {
								kind: "deleted",
								relativePath,
								success: false,
								error: "Cancelled by user",
							},
						})
						break
					}
				}
			}

			try {
				await task.restoreDeletedFile(relativePath, { overwrite })
				// Broadcast the new (now-shorter) trash list so all open webviews
				// refresh their FileChangesPanel immediately.
				provider.postMessageToWebview({
					type: "deletedFilesUpdated",
					deletedFiles: task.getDeletedFiles(),
				})
				provider.postMessageToWebview({
					type: "fileRestoreResult",
					fileRestoreResult: {
						kind: "deleted",
						relativePath,
						success: true,
					},
				})
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err)
				provider.log(
					`[webviewMessageHandler] Failed to restore deleted file ${relativePath}: ${error}`,
				)
				provider.postMessageToWebview({
					type: "fileRestoreResult",
					fileRestoreResult: {
						kind: "deleted",
						relativePath,
						success: false,
						error,
					},
				})
			}
			break
		}

		case "restoreFileToOriginal": {
			const task = provider.getCurrentTask()
			const relativePath = message.text
			if (!task || !relativePath) {
				break
			}
			try {
				await task.restoreFileToOriginal(relativePath)
				provider.postMessageToWebview({
					type: "fileRestoreResult",
					fileRestoreResult: {
						kind: "modified",
						relativePath,
						success: true,
					},
				})
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err)
				provider.log(
					`[webviewMessageHandler] Failed to restore file ${relativePath} to original: ${error}`,
				)
				provider.postMessageToWebview({
					type: "fileRestoreResult",
					fileRestoreResult: {
						kind: "modified",
						relativePath,
						success: false,
						error,
					},
				})
			}
			break
		}

		default:
			break
	}
}