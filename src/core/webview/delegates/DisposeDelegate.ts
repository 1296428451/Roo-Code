import { ClineProvider } from "../ClineProvider"

export class DisposeDelegate {
	constructor(private readonly provider: ClineProvider) {}

	dispose() {
		this.provider._disposed = true
		;(this.provider.constructor as typeof ClineProvider).activeInstances.delete(this.provider)

		this.provider.clearAllPendingEditOperations()

		// Dispose of all task event listeners
		for (const [task, listeners] of this.provider.taskEventListeners) {
			for (const remove of listeners) {
				remove()
			}
		}
		this.provider.taskEventListeners = new Map()

		// Dispose of all tasks in the stack
		for (const cline of this.provider.clineStack) {
			try {
				cline.dispose()
			} catch (error) {
				this.provider.log(`Error disposing task: ${error}`)
			}
		}
		this.provider.clineStack = []

		this.provider.clearWebviewResources()

		// Dispose of all registered disposables
		for (const disposable of this.provider.disposables) {
			disposable.dispose()
		}
		this.provider.disposables = []

		// Dispose of code index status subscription
		if (this.provider.codeIndexStatusSubscription) {
			this.provider.codeIndexStatusSubscription.dispose()
			this.provider.codeIndexStatusSubscription = undefined
		}

		// Dispose of workspace tracker
		if (this.provider._workspaceTracker) {
			this.provider._workspaceTracker.dispose()
			this.provider._workspaceTracker = undefined
		}

		// Dispose of MCP Hub
		if (this.provider.mcpHub) {
			this.provider.mcpHub.dispose()
			this.provider.mcpHub = undefined
		}

		// Dispose of Skills Manager
		if (this.provider.skillsManager) {
			this.provider.skillsManager.dispose()
			this.provider.skillsManager = undefined
		}

		// Clear the global state write-through timer
		if (this.provider.globalStateWriteThroughTimer) {
			clearTimeout(this.provider.globalStateWriteThroughTimer)
			this.provider.globalStateWriteThroughTimer = null
		}

		// Remove all event listeners
		this.provider.removeAllListeners()
	}
}