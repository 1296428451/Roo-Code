import type { WebviewMessage } from "@roo-code/types"

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
			await handleProviderOperations(ctx, message)
			break

		case "newTask":
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
			await handleTaskOperations(ctx, message)
			break

		case "submit":
		case "deleteMessage":
		case "editMessage":
		case "deleteMessageConfirm":
		case "editMessageConfirm":
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

		default:
			break
	}
}