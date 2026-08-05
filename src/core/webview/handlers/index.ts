import { handleTaskOperations, handleChatOperations } from "./taskHandlers"
import { handleApiConfigOperations } from "./apiConfigHandlers"
import { handleModeOperations } from "./modeHandlers"
import { handleCodeIndexOperations } from "./codeIndexHandlers"
import { handleCommandOperations } from "./commandHandlers"
import { handleMiscOperations } from "./miscHandlers"
import { handlePromptOperations } from "./promptHandlers"
import { handleSearchOperations } from "./searchHandlers"
import { handleWorktreeOperations } from "./worktreeHandlers"
import { handleMcpOperations } from "./mcpHandlers"

export type { HandlerContext } from "./taskHandlers"

export {
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
}