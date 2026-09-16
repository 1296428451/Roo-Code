import type { RooCodeSettings } from "./global-settings.js"
import type { ProviderSettings, ProviderSettingsEntry } from "./provider-settings.js"
import type { HistoryItem } from "./history.js"
import type { ModeConfig, PromptComponent } from "./mode.js"
import type { ClineMessage, QueuedMessage } from "./message.js"
import type { OrganizationAllowList } from "./organization.js"
import type { SerializedCustomToolDefinition } from "./custom-tool.js"
import type { GitCommit } from "./git.js"
import type { McpServer } from "./mcp.js"
import type { ModelRecord, RouterModels } from "./model.js"
import type { OpenAiCodexRateLimitInfo } from "./providers/openai-codex-rate-limits.js"
import type { SkillMetadata } from "./skills.js"
import type { WorktreeIncludeStatus } from "./worktree.js"
import type { CodeActionId, CodeActionName, TerminalActionId, TerminalActionPromptType } from "./vscode.js"

import type { ExtensionState } from "./extension-state.js"
import type { WebViewMessagePayload } from "./indexing.js"

/**
 * ExtensionMessage
 * Extension -> Webview | CLI
 */
export interface ExtensionMessage {
	type:
		| "action"
		| "state"
		| "taskHistoryUpdated"
		| "taskHistoryItemUpdated"
		| "selectedImages"
		| "theme"
		| "workspaceUpdated"
		| "invoke"
		| "messageUpdated"
		| "mcpServers"
		| "enhancedPrompt"
		| "commitSearchResults"
		| "listApiConfig"
		| "routerModels"
		| "openAiModels"
		| "ollamaModels"
		| "lmStudioModels"
		| "vsCodeLmModels"
		| "vsCodeLmApiAvailable"
		| "updatePrompt"
		| "systemPrompt"
		| "autoApprovalEnabled"
		| "updateCustomMode"
		| "deleteCustomMode"
		| "exportModeResult"
		| "importModeResult"
		| "checkRulesDirectoryResult"
		| "deleteCustomModeCheck"
		| "currentCheckpointUpdated"
		| "checkpointInitWarning"
		| "ttsStart"
		| "ttsStop"
		| "fileSearchResults"
		| "toggleApiConfigPin"
		| "acceptInput"
		| "setHistoryPreviewCollapsed"
		| "commandExecutionStatus"
		| "mcpExecutionStatus"
		| "vsCodeSetting"
		| "authenticatedUser"
		| "condenseTaskContextStarted"
		| "condenseTaskContextResponse"
		| "singleRouterModelFetchResponse"
		| "rooCreditBalance"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "codebaseIndexConfig"
		| "codeIndexSettingsSaved"
		| "codeIndexSecretStatus"
		| "showDeleteMessageDialog"
		| "showEditMessageDialog"
		| "commands"
		| "insertTextIntoTextarea"
		| "dismissedUpsells"
		| "interactionRequired"
		| "customToolsResult"
		| "modes"
		| "taskWithAggregatedCosts"
		| "openAiCodexRateLimits"
		// Worktree response types
		| "worktreeList"
		| "worktreeResult"
		| "worktreeCopyProgress"
		| "branchList"
		| "worktreeDefaults"
		| "worktreeIncludeStatus"
		| "branchWorktreeIncludeResult"
		| "folderSelected"
		| "skills"
		| "fileContent"
		| "deletedFilesUpdated"
		| "fileRestoreResult"
		| "codeAction"
		| "terminalAction"
	suppressMessage?: boolean
	text?: string
	/** For fileContent: { path, content, error? } */
	fileContent?: { path: string; content: string | null; error?: string }
	/** For deletedFilesUpdated: list of files currently held in the task trash */
	deletedFiles?: { relativePath: string; trashedAt: number; size: number }[]
	/** For fileRestoreResult: result of a per-file restore (deleted or modified). */
	fileRestoreResult?: {
		kind: "deleted" | "modified"
		relativePath: string
		success: boolean
		error?: string
	}
	/**
	 * Custom feature: a code/terminal action triggered from a VS Code command
	 * (e.g. an editor code lens) is forwarded to the visible webview so it can
	 * perform the action in the UI. The payload is nested under `codeAction` /
	 * `terminalAction` to avoid colliding with the top-level `action` field.
	 */
	codeAction?: {
		action: CodeActionId | CodeActionName
		promptType?: string
		[key: string]: unknown
	}
	terminalAction?: {
		action: TerminalActionId
		promptType?: TerminalActionPromptType
		[key: string]: unknown
	}
	payload?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	checkpointWarning?: {
		type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"
		timeout: number
	}
	action?:
		| "chatButtonClicked"
		| "settingsButtonClicked"
		| "historyButtonClicked"
		| "didBecomeVisible"
		| "focusInput"
		| "switchTab"
		| "toggleAutoApprove"
	invoke?: "newChat" | "sendMessage" | "primaryButtonClick" | "secondaryButtonClick" | "setChatBoxMessage"
	/**
	 * Partial state updates are allowed to reduce message size (e.g. omit large fields like taskHistory).
	 * The webview is responsible for merging.
	 */
	state?: Partial<ExtensionState>
	images?: string[]
	filePaths?: string[]
	openedTabs?: Array<{
		label: string
		isActive: boolean
		path?: string
	}>
	clineMessage?: ClineMessage
	routerModels?: RouterModels
	openAiModels?: string[]
	ollamaModels?: ModelRecord
	lmStudioModels?: ModelRecord
	vsCodeLmModels?: { vendor?: string; family?: string; version?: string; id?: string }[]
	mcpServers?: McpServer[]
	commits?: GitCommit[]
	listApiConfig?: ProviderSettingsEntry[]
	mode?: string
	customMode?: ModeConfig
	slug?: string
	success?: boolean
	/** Generic payload for extension messages that use `values` */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	values?: Record<string, any>
	requestId?: string
	promptText?: string
	results?:
		| { path: string; type: "file" | "folder"; label?: string }[]
		| { name: string; description?: string; argumentHint?: string; source: "global" | "project" | "built-in" }[]
	error?: string
	setting?: string
	value?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	hasContent?: boolean
	organizationAllowList?: OrganizationAllowList
	tab?: string
	errors?: string[]
	rulesFolderPath?: string
	settings?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	messageTs?: number
	hasCheckpoint?: boolean
	context?: string
	commands?: Command[]
	queuedMessages?: QueuedMessage[]
	list?: string[] // For dismissedUpsells
	tools?: SerializedCustomToolDefinition[] // For customToolsResult
	skills?: SkillMetadata[] // For skills response
	modes?: { slug: string; name: string }[] // For modes response
	aggregatedCosts?: {
		// For taskWithAggregatedCosts response
		totalCost: number
		ownCost: number
		childrenCost: number
	}
	historyItem?: HistoryItem
	taskHistory?: HistoryItem[] // For taskHistoryUpdated: full sorted task history
	/** For taskHistoryItemUpdated: single updated/added history item */
	taskHistoryItem?: HistoryItem
	// Worktree response properties
	worktrees?: Array<{
		path: string
		branch: string
		commitHash: string
		isCurrent: boolean
		isBare: boolean
		isDetached: boolean
		isLocked: boolean
		lockReason?: string
	}>
	isGitRepo?: boolean
	isMultiRoot?: boolean
	isSubfolder?: boolean
	gitRootPath?: string
	worktreeResult?: {
		success: boolean
		message: string
		worktree?: {
			path: string
			branch: string
			commitHash: string
			isCurrent: boolean
			isBare: boolean
			isDetached: boolean
			isLocked: boolean
			lockReason?: string
		}
	}
	localBranches?: string[]
	remoteBranches?: string[]
	currentBranch?: string
	suggestedBranch?: string
	suggestedPath?: string
	worktreeIncludeExists?: boolean
	worktreeIncludeStatus?: WorktreeIncludeStatus
	hasGitignore?: boolean
	gitignoreContent?: string
	// branchWorktreeIncludeResult
	branch?: string
	hasWorktreeInclude?: boolean
	// worktreeCopyProgress (size-based)
	copyProgressBytesCopied?: number
	copyProgressTotalBytes?: number
	copyProgressItemName?: string
	// folderSelected
	path?: string
}

export interface OpenAiCodexRateLimitsMessage {
	type: "openAiCodexRateLimits"
	values?: OpenAiCodexRateLimitInfo
	error?: string
}

export interface Command {
	name: string
	source: "global" | "project" | "built-in"
	filePath?: string
	description?: string
	argumentHint?: string
}

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse" | "objectResponse"

export type AudioType = "notification" | "celebration" | "progress_loop"

/**
 * WebviewMessage
 * Webview | CLI -> Extension
 */
export interface WebviewMessage {
	type:
		| "updateTodoList"
		| "deleteMultipleTasksWithIds"
		| "currentApiConfigName"
		| "saveApiConfiguration"
		| "upsertApiConfiguration"
		| "deleteApiConfiguration"
		| "loadApiConfiguration"
		| "loadApiConfigurationById"
		| "renameApiConfiguration"
		| "getListApiConfiguration"
		| "customInstructions"
		| "webviewDidLaunch"
		| "newTask"
		| "deleteTask"
		| "askResponse"
		| "terminalOperation"
		| "clearTask"
		| "didShowAnnouncement"
		| "selectImages"
		| "exportCurrentTask"
		| "showTaskWithId"
		| "deleteTaskWithId"
		| "exportTaskWithId"
		| "importSettings"
		| "exportSettings"
		| "resetState"
		| "flushRouterModels"
		| "requestRouterModels"
		| "requestOpenAiModels"
		| "requestOllamaModels"
		| "requestLmStudioModels"
		| "requestVsCodeLmModels"
		| "openImage"
		| "saveImage"
		| "openFile"
		| "readFileContent"
		| "openMention"
		| "cancelTask"
		| "resetTask"
		| "focusTask"
		| "switchToTask"
		| "pauseTask"
		| "resumeTask"
		| "abortTask"
		| "cancelAutoApproval"
		| "updateVSCodeSetting"
		| "getVSCodeSetting"
		| "vsCodeSetting"
		| "updateCondensingPrompt"
		| "playSound"
		| "playTts"
		| "stopTts"
		| "ttsEnabled"
		| "ttsSpeed"
		| "openKeyboardShortcuts"
		| "openMcpSettings"
		| "openProjectMcpSettings"
		| "restartMcpServer"
		| "refreshAllMcpServers"
		| "toggleToolAlwaysAllow"
		| "toggleToolEnabledForPrompt"
		| "toggleMcpServer"
		| "updateMcpTimeout"
		| "enhancePrompt"
		| "enhancedPrompt"
		| "draggedImages"
		| "deleteMessage"
		| "editMessage"
		| "submit"
		| "deleteMessageConfirm"
		| "submitEditedMessage"
		| "editMessageConfirm"
		| "searchCommits"
		| "setApiConfigPassword"
		| "mode"
		| "updatePrompt"
		| "getSystemPrompt"
		| "copySystemPrompt"
		| "systemPrompt"
		| "enhancementApiConfigId"
		| "autoApprovalEnabled"
		| "updateCustomMode"
		| "deleteCustomMode"
		| "setopenAiCustomModelInfo"
		| "openCustomModesSettings"
		| "checkpointDiff"
		| "checkpointRestore"
		| "restoreDeletedFile"
		| "restoreFileToOriginal"
		| "deleteMcpServer"
		| "codebaseIndexEnabled"
		| "searchFiles"
		| "toggleApiConfigPin"
		| "hasOpenedModeSelector"
		| "lockApiConfigAcrossModes"
		| "openAiCodexSignIn"
		| "openAiCodexSignOut"
		| "condenseTaskContextRequest"
		| "requestIndexingStatus"
		| "startIndexing"
		| "stopIndexing"
		| "clearIndexData"
		| "indexingStatusUpdate"
		| "indexCleared"
		| "toggleWorkspaceIndexing"
		| "setIndexWorkspacePath"
		| "setAutoEnableDefault"
		| "focusPanelRequest"
		| "openExternal"
		| "switchTab"
		| "exportMode"
		| "exportModeResult"
		| "importMode"
		| "importModeResult"
		| "checkRulesDirectory"
		| "checkRulesDirectoryResult"
		| "saveCodeIndexSettingsAtomic"
		| "requestCodeIndexSecretStatus"
		| "requestCommands"
		| "openCommandFile"
		| "deleteCommand"
		| "createCommand"
		| "insertTextIntoTextarea"
		| "imageGenerationSettings"
		| "queueMessage"
		| "removeQueuedMessage"
		| "editQueuedMessage"
		| "dismissUpsell"
		| "getDismissedUpsells"
		| "openMarkdownPreview"
		| "updateSettings"
		| "allowedCommands"
		| "getTaskWithAggregatedCosts"
		| "deniedCommands"
		| "openDebugApiHistory"
		| "openDebugUiHistory"
		| "downloadErrorDiagnostics"
		| "requestOpenAiCodexRateLimits"
		| "refreshCustomTools"
		| "requestModes"
		| "switchMode"
		| "debugSetting"
		// Worktree messages
		| "listWorktrees"
		| "createWorktree"
		| "deleteWorktree"
		| "switchWorktree"
		| "getAvailableBranches"
		| "getWorktreeDefaults"
		| "getWorktreeIncludeStatus"
		| "checkBranchWorktreeInclude"
		| "createWorktreeInclude"
		| "checkoutBranch"
		| "browseForWorktreePath"
		// Skills messages
		| "requestSkills"
		| "createSkill"
		| "deleteSkill"
		| "moveSkill"
		| "updateSkillModes"
		| "openSkillFile"
		// Multi-agent / background task messages
		| "backgroundActiveTask"
		| "foregroundBackgroundTask"
		| "stopBackgroundTask"
		text?: string
	taskId?: string
	editedMessageContent?: string
	tab?: "settings" | "history" | "mcp" | "modes" | "chat"
	disabled?: boolean
	context?: string
	dataUri?: string
	askResponse?: ClineAskResponse
	apiConfiguration?: ProviderSettings
	/** Explicitly bind a loaded profile to the currently selected mode. */
	persistModeConfig?: boolean
	images?: string[]
	bool?: boolean
	value?: number
	stepIndex?: number
	isLaunchAction?: boolean
	forceShow?: boolean
	commands?: string[]
	audioType?: AudioType
	serverName?: string
	toolName?: string
	alwaysAllow?: boolean
	isEnabled?: boolean
	mode?: string
	promptMode?: string | "enhance"
	customPrompt?: PromptComponent
	dataUrls?: string[]
	/** Generic payload for webview messages that use `values` */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	values?: Record<string, any>
	query?: string
	setting?: string
	slug?: string
	modeConfig?: ModeConfig
	timeout?: number
	payload?: WebViewMessagePayload
	source?: "global" | "project"
	skillName?: string // For skill operations (createSkill, deleteSkill, moveSkill, openSkillFile)
	/** @deprecated Use skillModeSlugs instead */
	skillMode?: string // For skill operations (current mode restriction)
	/** @deprecated Use newSkillModeSlugs instead */
	newSkillMode?: string // For moveSkill (target mode)
	skillDescription?: string // For createSkill (skill description)
	/** Mode slugs for skill operations. undefined/empty = any mode */
	skillModeSlugs?: string[] // For skill operations (mode restrictions)
	/** Target mode slugs for updateSkillModes */
	newSkillModeSlugs?: string[] // For updateSkillModes (new mode restrictions)
	requestId?: string
	ids?: string[]
	terminalOperation?: "continue" | "abort"
	messageTs?: number
	restoreCheckpoint?: boolean
	historyPreviewCollapsed?: boolean
	filters?: { type?: string; search?: string; tags?: string[] }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	settings?: any
	url?: string // For openExternal
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	config?: Record<string, any> // Add config to the payload
	hasContent?: boolean // For checkRulesDirectoryResult
	checkOnly?: boolean // For deleteCustomMode check
	upsellId?: string // For dismissUpsell
	list?: string[] // For dismissedUpsells response
	organizationId?: string | null // For organization switching
	codeIndexSettings?: {
		// Global state settings
		codebaseIndexEnabled: boolean
		codebaseIndexQdrantUrl: string
		codebaseIndexEmbedderProvider:
			| "openai"
			| "ollama"
			| "openai-compatible"
			| "gemini"
			| "mistral"
			| "vercel-ai-gateway"
			| "bedrock"
			| "openrouter"
		codebaseIndexEmbedderBaseUrl?: string
		codebaseIndexEmbedderModelId: string
		codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
		codebaseIndexOpenAiCompatibleBaseUrl?: string
		codebaseIndexBedrockRegion?: string
		codebaseIndexBedrockProfile?: string
		codebaseIndexSearchMaxResults?: number
		codebaseIndexSearchMinScore?: number
		codebaseIndexOpenRouterSpecificProvider?: string // OpenRouter provider routing

		// Secret settings
		codeIndexOpenAiKey?: string
		codeIndexQdrantApiKey?: string
		codebaseIndexOpenAiCompatibleApiKey?: string
		codebaseIndexGeminiApiKey?: string
		codebaseIndexMistralApiKey?: string
		codebaseIndexVercelAiGatewayApiKey?: string
		codebaseIndexOpenRouterApiKey?: string
	}
	updatedSettings?: RooCodeSettings
	/** Task configuration applied via `createTask()`. */
	taskConfiguration?: RooCodeSettings
	// Worktree properties
	worktreePath?: string
	worktreeBranch?: string
	worktreeBaseBranch?: string
	worktreeCreateNewBranch?: boolean
	worktreeForce?: boolean
	worktreeNewWindow?: boolean
	worktreeIncludeContent?: string
	// Index workspace path for codebase indexing
	workspacePath?: string
}

export interface RequestOpenAiCodexRateLimitsMessage {
	type: "requestOpenAiCodexRateLimits"
}

// -----------------------------------------------------------------------------
// Re-exports: the definitions below live in their own modules to keep this file
// focused, but they remain part of the public `@roo-code/types` surface.
// -----------------------------------------------------------------------------

export type { BackgroundTaskItem } from "./background-task.js"
export type { ExtensionState } from "./extension-state.js"
export { checkoutDiffPayloadSchema, checkoutRestorePayloadSchema } from "./checkpoint.js"
export type { CheckpointDiffPayload, CheckpointRestorePayload } from "./checkpoint.js"
export type {
	IndexingStatusPayload,
	IndexClearedPayload,
	UpdateTodoListPayload,
	EditQueuedMessagePayload,
	WebViewMessagePayload,
	IndexingStatus,
	IndexingStatusUpdateMessage,
} from "./indexing.js"
export type {
	ClineSayTool,
	ClineAskUseMcpServer,
	ClineApiReqInfo,
	ClineApiReqCancelReason,
} from "./cline-tool-types.js"
