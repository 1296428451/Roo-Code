import EventEmitter from "events"

import * as vscode from "vscode"

import type { TaskProviderEvents, ClineMessage } from "@roo-code/types"

import { Task } from "../task/Task"
import { ContextProxy } from "../config/ContextProxy"
import { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import { CustomModesManager } from "../config/CustomModesManager"
import { TaskHistoryStore } from "../task-persistence"
import { getWorkspacePath } from "../../utils/path"

import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"
import { McpHub } from "../../services/mcp/McpHub"
import { CodeIndexManager } from "../../services/code-index/manager"
import { SkillsManager } from "../../services/skills/SkillsManager"

import { EMBEDDING_MODEL_PROFILES } from "../../shared/embeddingModels"

import { PendingEditDelegate } from "./delegates/PendingEditDelegate"
import { ProviderStateDelegate } from "./delegates/ProviderStateDelegate"
import { ProviderProfileDelegate } from "./delegates/ProviderProfileDelegate"
import { TaskHistoryDelegate } from "./delegates/TaskHistoryDelegate"
import { WebviewLifecycleDelegate } from "./delegates/WebviewLifecycleDelegate"
import { TaskStackDelegate } from "./delegates/TaskStackDelegate"
import { DisposeDelegate } from "./delegates/DisposeDelegate"
import { McpDelegate } from "./delegates/McpDelegate"
import { BackgroundTaskDelegate } from "./delegates/BackgroundTaskDelegate"

import type { ClineProvider } from "./ClineProvider"

export type ClineProviderEvents = {
	clineCreated: [cline: Task]
}

/**
 * Holds the shared state and lifecycle of a `ClineProvider` (field declarations,
 * the constructor, logging and the core getters/wrappers the constructor relies
 * on). `ClineProvider` extends this so the bulk of the public façade methods can
 * live in a separate, shorter file.
 */
export class ClineProviderBase extends EventEmitter<TaskProviderEvents> {
	// Shared state exposed for delegate access
	public disposables: vscode.Disposable[] = []
	public webviewDisposables: vscode.Disposable[] = []
	public view?: vscode.WebviewView | vscode.WebviewPanel
	public clineStack: Task[] = []
	/** Background tasks managed by BackgroundTaskDelegate while the user works elsewhere. */
	public backgroundTaskDelegate!: BackgroundTaskDelegate
	public codeIndexStatusSubscription?: vscode.Disposable
	public codeIndexManager?: CodeIndexManager
	public _workspaceTracker?: WorkspaceTracker
	public mcpHub?: McpHub
	public skillsManager?: SkillsManager
	public taskCreationCallback: (task: Task) => void
	public taskEventListeners: Map<Task, Array<() => void>> = new Map()
	public currentWorkspacePath: string | undefined
	public _disposed = false

	public recentTasksCache?: string[]
	public taskHistoryStore: TaskHistoryStore
	public taskHistoryStoreInitialized = false
	public globalStateWriteThroughTimer: ReturnType<typeof setTimeout> | null = null

	public clineMessagesSeq = 0

	public isViewLaunched = false
	public mcpHubInitializationPromise: Promise<void>
	public settingsImportedAt?: number
	public readonly latestAnnouncementId = "may-2026-final-roo-code-release"
	public providerSettingsManager: ProviderSettingsManager
	public customModesManager: CustomModesManager

	// Delegates — protected so the ClineProvider subclass can forward to them
	protected readonly pendingEditDelegate: PendingEditDelegate
	protected readonly stateDelegate: ProviderStateDelegate
	protected readonly profileDelegate: ProviderProfileDelegate
	protected readonly taskHistoryDelegate: TaskHistoryDelegate
	protected readonly webviewLifecycleDelegate: WebviewLifecycleDelegate
	protected readonly taskStackDelegate: TaskStackDelegate
	protected readonly disposeDelegate: DisposeDelegate
	protected readonly mcpDelegate: McpDelegate

	constructor(
		readonly context: vscode.ExtensionContext,
		readonly outputChannel: vscode.OutputChannel,
		public readonly renderContext: "sidebar" | "editor" = "sidebar",
		public readonly contextProxy: ContextProxy,
	) {
		super()
		this.currentWorkspacePath = getWorkspacePath()

		this.pendingEditDelegate = new PendingEditDelegate(this as unknown as ClineProvider)
		this.stateDelegate = new ProviderStateDelegate(this as unknown as ClineProvider)
		this.profileDelegate = new ProviderProfileDelegate(this as unknown as ClineProvider)
		this.taskHistoryDelegate = new TaskHistoryDelegate(this as unknown as ClineProvider)
		this.webviewLifecycleDelegate = new WebviewLifecycleDelegate(this as unknown as ClineProvider)
		this.taskStackDelegate = new TaskStackDelegate(this as unknown as ClineProvider)
		this.disposeDelegate = new DisposeDelegate(this as unknown as ClineProvider)
		this.mcpDelegate = new McpDelegate(this as unknown as ClineProvider)
		this.backgroundTaskDelegate = new BackgroundTaskDelegate(this as unknown as ClineProvider)

		this.settingsImportedAt = context.globalState.get<number>("settingsImportedAt")

		if (!this.settingsImportedAt) {
			this.ensureSettingsImportedAtFromConfig()
				.then(async (updated) => {
					if (updated) {
						await this.hydrateProviderProfileFromConfig()
						void this.postStateToWebview()
					}
				})
				.catch((error) => {
					this.log(`Failed to check config file: ${error}`)
				})
		}

		// `activeInstances` is a static on the concrete ClineProvider subclass; reach
		// it through the runtime constructor to avoid a circular value import.
		const ctor = this.constructor as unknown as { activeInstances: Set<ClineProvider> }
		ctor.activeInstances.add(this as unknown as ClineProvider)

		this.updateGlobalState("codebaseIndexModels", EMBEDDING_MODEL_PROFILES)

		this.taskHistoryStore = new TaskHistoryStore(context.globalStorageUri.fsPath)
		this.initializeTaskHistoryStore()

		this.providerSettingsManager = new ProviderSettingsManager(this.context)
		this.customModesManager = new CustomModesManager(this.context)

		this.skillsManager = new SkillsManager(this as unknown as ClineProvider)
		this.skillsManager.initialize().catch((error) => {
			this.log(`Failed to initialize skills manager: ${error}`)
		})

		this.mcpHubInitializationPromise = this.mcpDelegate.initializeMcpHub()

		this.taskCreationCallback = (task: Task) => {
			;(this as unknown as EventEmitter<ClineProviderEvents>).emit("clineCreated", task)
		}
	}

	public log(message: string) {
		console.log(`[ClineProvider] ${message}`)
		this.outputChannel.appendLine(`[ClineProvider] ${message}`)
	}

	public getCurrentTask(): Task | undefined {
		return this.taskStackDelegate.getCurrentTask()
	}

	// =============================================================================
	// Core getters
	// =============================================================================

	get workspaceTracker(): WorkspaceTracker | undefined {
		return this._workspaceTracker
	}

	get viewLaunched(): boolean {
		return this.isViewLaunched && !this._disposed
	}

	get messages(): ClineMessage[] {
		return this.getCurrentTask()?.clineMessages || []
	}

	get cwd(): string {
		return this.currentWorkspacePath || getWorkspacePath()
	}

	getSkillsManager(): SkillsManager | undefined {
		return this.skillsManager
	}

	/**
	 * Gets the CodeIndexManager for the current active workspace.
	 *
	 * Resolves the per-workspace singleton instead of returning a cached field:
	 * `CodeIndexManager` instances are keyed by workspace folder path, so this
	 * keeps the reference correct when the active folder changes in a
	 * multi-root workspace.
	 */
	getCurrentWorkspaceCodeIndexManager(): CodeIndexManager | undefined {
		return CodeIndexManager.getInstance(this.context)
	}

	/**
	 * Updates the code index status subscription so it follows the manager of the
	 * current workspace.
	 *
	 * Also forwards the manager's progress events to the webview, which is the
	 * only path through which indexing progress, `workspaceEnabled` and
	 * `indexWorkspacePath` reach the code index popover. Must be called once the
	 * webview view exists and again whenever the active workspace may have
	 * changed.
	 */
	public updateCodeIndexStatusSubscription(): void {
		const currentManager = this.getCurrentWorkspaceCodeIndexManager()

		// If the manager hasn't changed, no need to update the subscription.
		if (currentManager === this.codeIndexManager) {
			return
		}

		// Dispose the old subscription if it exists.
		if (this.codeIndexStatusSubscription) {
			this.codeIndexStatusSubscription.dispose()
			this.codeIndexStatusSubscription = undefined
		}

		// Update the current workspace manager reference.
		this.codeIndexManager = currentManager

		if (!currentManager) {
			return
		}

		// Subscribe to the new manager's progress updates.
		this.codeIndexStatusSubscription = currentManager.onProgressUpdate(() => {
			// Only send updates if this manager is still the current one.
			if (currentManager === this.getCurrentWorkspaceCodeIndexManager()) {
				void this.webviewLifecycleDelegate.postMessageToWebview({
					type: "indexingStatusUpdate",
					values: currentManager.getCurrentStatus(),
				})
			}
		})

		if (this.view) {
			this.webviewDisposables.push(this.codeIndexStatusSubscription)
		}

		// Send the initial status for the current workspace.
		void this.webviewLifecycleDelegate.postMessageToWebview({
			type: "indexingStatusUpdate",
			values: currentManager.getCurrentStatus(),
		})
	}

	// =============================================================================
	// Wrappers the constructor depends on (delegated)
	// =============================================================================

	public async ensureSettingsImportedAtFromConfig(): Promise<boolean> {
		return this.profileDelegate.ensureSettingsImportedAtFromConfig()
	}

	public async hydrateProviderProfileFromConfig(): Promise<boolean> {
		return this.profileDelegate.hydrateProviderProfileFromConfig()
	}

	public async postStateToWebview() {
		await this.stateDelegate.postStateToWebview()
	}

	public async updateGlobalState(key: any, value: any): Promise<void> {
		await this.contextProxy.setValue(key, value)
	}

	public async initializeTaskHistoryStore(): Promise<void> {
		return this.taskHistoryDelegate.initializeTaskHistoryStore()
	}
}
