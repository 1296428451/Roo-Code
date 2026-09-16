import type { GlobalSettings, RooCodeSettings } from "./global-settings.js"
import type { ProviderSettings } from "./provider-settings.js"
import type { HistoryItem } from "./history.js"
import type { ModeConfig, PromptComponent } from "./mode.js"
import type { Experiments } from "./experiment.js"
import type { ClineMessage, QueuedMessage } from "./message.js"
import type { TodoItem } from "./todo.js"
import type { OrganizationAllowList } from "./organization.js"
import type { SerializedCustomToolDefinition } from "./custom-tool.js"
import type { GitCommit } from "./git.js"
import type { McpServer } from "./mcp.js"
import type { ModelRecord, RouterModels } from "./model.js"
import type { OpenAiCodexRateLimitInfo } from "./providers/openai-codex-rate-limits.js"
import type { SkillMetadata } from "./skills.js"
import type { WorktreeIncludeStatus } from "./worktree.js"
import type { BackgroundTaskItem } from "./background-task.js"

export type ExtensionState = Pick<
	GlobalSettings,
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "pinnedApiConfigs"
	| "customInstructions"
	| "dismissedUpsells"
	| "autoApprovalEnabled"
	| "alwaysAllowReadOnly"
	| "alwaysAllowReadOnlyOutsideWorkspace"
	| "alwaysAllowWrite"
	| "alwaysAllowWriteOutsideWorkspace"
	| "alwaysAllowWriteProtected"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "alwaysAllowFollowupQuestions"
	| "alwaysAllowExecute"
	| "followupAutoApproveTimeoutMs"
	| "allowedCommands"
	| "deniedCommands"
	| "allowedMaxRequests"
	| "allowedMaxCost"
	| "ttsEnabled"
	| "ttsSpeed"
	| "soundEnabled"
	| "soundVolume"
	| "terminalOutputPreviewSize"
	| "terminalShellIntegrationTimeout"
	| "terminalShellIntegrationDisabled"
	| "terminalCommandDelay"
	| "terminalPowershellCounter"
	| "terminalZshClearEolMark"
	| "terminalZshOhMy"
	| "terminalZshP10k"
	| "terminalZdotdir"
	| "execaShellPath"
	| "diagnosticsEnabled"
	| "language"
	| "modeApiConfigs"
	| "customModePrompts"
	| "customSupportPrompts"
	| "enhancementApiConfigId"
	| "customCondensingPrompt"
	| "codebaseIndexConfig"
	| "codebaseIndexModels"
	| "profileThresholds"
	| "includeDiagnosticMessages"
	| "maxDiagnosticMessages"
	| "imageGenerationProvider"
	| "openRouterImageGenerationSelectedModel"
	| "includeTaskHistoryInEnhance"
	| "reasoningBlockCollapsed"
	| "enterBehavior"
	| "includeCurrentTime"
	| "includeCurrentCost"
	| "includeDirectoryDetails"
	| "maxGitStatusFiles"
	| "requestDelaySeconds"
	| "showWorktreesInHomeScreen"
	| "disabledTools"
> & {
	lockApiConfigAcrossModes?: boolean
	version: string
	clineMessages: ClineMessage[]
	currentTaskId?: string
	currentTaskItem?: HistoryItem
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	backgroundTasks?: BackgroundTaskItem[] // Tasks running in the background (multi-agent parallel sessions)
	apiConfiguration: ProviderSettings
	uriScheme?: string
	shouldShowAnnouncement: boolean

	taskHistory: HistoryItem[]

	writeDelayMs: number

	enableCheckpoints: boolean
	checkpointTimeout: number // Timeout for checkpoint initialization in seconds (default: 15)
	maxOpenTabsContext: number // Maximum number of VSCode open tabs to include in context (0-500)
	maxWorkspaceFiles: number // Maximum number of files to include in current working directory details (0-500)
	showRooIgnoredFiles: boolean // Whether to show .rooignore'd files in listings
	enableSubfolderRules: boolean // Whether to load rules from subdirectories
	maxReadFileLine?: number // Maximum line limit for read_file tool (-1 for default)
	maxImageFileSize: number // Maximum size of image files to process in MB
	maxTotalImageSize: number // Maximum total size for all images in a single read operation in MB

	experiments: Experiments // Map of experiment IDs to their enabled state

	mcpEnabled: boolean

	mode: string
	customModes: ModeConfig[]
	toolRequirements?: Record<string, boolean> // Map of tool names to their requirements (e.g. {"apply_diff": true})

	cwd?: string // Current working directory
	renderContext: "sidebar" | "editor"
	settingsImportedAt?: number
	historyPreviewCollapsed?: boolean

	organizationAllowList: OrganizationAllowList

	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	profileThresholds: Record<string, number>
	hasOpenedModeSelector: boolean
	openRouterImageApiKey?: string
	messageQueue?: QueuedMessage[]
	lastShownAnnouncementId?: string
	apiModelId?: string
	mcpServers?: McpServer[]
	openAiCodexIsAuthenticated?: boolean
	debug?: boolean

	/**
	 * Monotonically increasing sequence number for clineMessages state pushes.
	 * When present, the frontend should only apply clineMessages from a state push
	 * if its seq is greater than the last applied seq. This prevents stale state
	 * (captured during async getStateToPostToWebview) from overwriting newer messages.
	 */
	clineMessagesSeq?: number
	isPaused?: boolean
}
