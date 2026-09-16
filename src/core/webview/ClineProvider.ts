import * as vscode from "vscode"

import { Anthropic } from "@anthropic-ai/sdk"

import {
	type TaskProviderLike,
	type ProviderSettings,
	type ProviderSettingsEntry,
	type CreateTaskOptions,
	type CodeActionId,
	type CodeActionName,
	type TerminalActionId,
	type TerminalActionPromptType,
	type HistoryItem,
	type ExtensionMessage,
	type ExtensionState,
} from "@roo-code/types"

import { type AggregatedCosts } from "./aggregateTaskCosts"

import { Package } from "../../shared/package"
import { Mode } from "../../shared/modes"
import { McpHub } from "../../services/mcp/McpHub"

import { Task } from "../task/Task"

import { delegateParentAndOpenChild, reopenParentFromDelegation } from "./delegation"
import { StaticDelegate } from "./delegates/StaticDelegate"
import { ClineProviderBase } from "./ClineProviderBase"

export class ClineProvider extends ClineProviderBase implements vscode.WebviewViewProvider, TaskProviderLike {
	public static readonly sideBarId = `${Package.name}.SidebarProvider`
	public static readonly tabPanelId = `${Package.name}.TabPanelProvider`
	public static activeInstances: Set<ClineProvider> = new Set()

	// =============================================================================
	// Profile & Provider (delegated to ProviderProfileDelegate)
	// =============================================================================

	public async updateTaskApiHandlerIfNeeded(
		providerSettings: ProviderSettings,
		options: { forceRebuild?: boolean } = {},
	): Promise<void> {
		this.profileDelegate.updateTaskApiHandlerIfNeeded(providerSettings, options)
	}

	getProviderProfileEntries(): ProviderSettingsEntry[] {
		return this.profileDelegate.getProviderProfileEntries()
	}

	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.profileDelegate.getProviderProfileEntry(name)
	}

	hasProviderProfileEntry(name: string): boolean {
		return this.profileDelegate.hasProviderProfileEntry(name)
	}

	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		return this.profileDelegate.upsertProviderProfile(name, providerSettings, activate)
	}

	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry) {
		return this.profileDelegate.deleteProviderProfile(profileToDelete)
	}

	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	) {
		return this.profileDelegate.activateProviderProfile(args, options)
	}

	async updateCustomInstructions(instructions?: string) {
		return this.profileDelegate.updateCustomInstructions(instructions)
	}

	async ensureMcpServersDirectoryExists(): Promise<string> {
		return this.profileDelegate.ensureMcpServersDirectoryExists()
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		return this.profileDelegate.ensureSettingsDirectoryExists()
	}

	async handleOpenRouterCallback(code: string) {
		return this.profileDelegate.handleOpenRouterCallback(code)
	}

	async handleRequestyCallback(code: string, baseUrl: string | null) {
		return this.profileDelegate.handleRequestyCallback(code, baseUrl)
	}

	async handleModeSwitch(newMode: Mode) {
		return this.profileDelegate.handleModeSwitch(newMode)
	}

	async getModes(): Promise<{ slug: string; name: string }[]> {
		return this.profileDelegate.getModes()
	}

	async getMode(): Promise<string> {
		return this.profileDelegate.getMode()
	}

	async setMode(mode: string): Promise<void> {
		await this.profileDelegate.setMode(mode)
	}

	async getProviderProfiles(): Promise<ProviderSettingsEntry[]> {
		return this.profileDelegate.getProviderProfiles()
	}

	async getProviderProfile(): Promise<string>
	async getProviderProfile(name: string): Promise<ProviderSettings>
	async getProviderProfile(name?: string): Promise<ProviderSettings | string> {
		if (name === undefined) {
			const state = await this.getState()
			return state.apiConfiguration?.apiProvider ?? "default"
		}
		return this.profileDelegate.getProviderProfile(name)
	}

	async setProviderProfile(name: string): Promise<void>
	async setProviderProfile(name: string, settings: ProviderSettings): Promise<void>
	async setProviderProfile(name: string, settings?: ProviderSettings): Promise<void> {
		if (settings) {
			await this.profileDelegate.setProviderProfile(name, settings)
		} else {
			await this.activateProviderProfile({ name })
		}
	}

	// =============================================================================
	// State Management (delegated to ProviderStateDelegate)
	// =============================================================================

	async postStateToWebviewWithoutTaskHistory(): Promise<void> {
		await this.stateDelegate.postStateToWebviewWithoutTaskHistory()
	}

	async postStateToWebviewWithoutClineMessages(): Promise<void> {
		await this.stateDelegate.postStateToWebviewWithoutClineMessages()
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		return this.stateDelegate.getStateToPostToWebview()
	}

	async getState() {
		return this.stateDelegate.getState()
	}

	async refreshWorkspace(): Promise<void> {
		await this.stateDelegate.refreshWorkspace()
	}

	// =============================================================================
	// Task History (delegated to TaskHistoryDelegate)
	// =============================================================================

	async updateTaskHistory(item: HistoryItem, options: { broadcast?: boolean } = {}): Promise<HistoryItem[]> {
		return this.taskHistoryDelegate.updateTaskHistory(item, options)
	}

	private scheduleGlobalStateWriteThrough(): void {
		this.taskHistoryDelegate.scheduleGlobalStateWriteThrough()
	}

	private async flushGlobalStateWriteThrough(): Promise<void> {
		return this.taskHistoryDelegate.flushGlobalStateWriteThrough()
	}

	async broadcastTaskHistoryUpdate(history?: HistoryItem[]): Promise<void> {
		return this.taskHistoryDelegate.broadcastTaskHistoryUpdate(history)
	}

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		return this.taskHistoryDelegate.getTaskWithId(id)
	}

	async getTaskWithAggregatedCosts(taskId: string): Promise<{
		historyItem: HistoryItem
		aggregatedCosts: AggregatedCosts
	}> {
		return this.taskHistoryDelegate.getTaskWithAggregatedCosts(taskId)
	}

	async showTaskWithId(id: string) {
		return this.taskHistoryDelegate.showTaskWithId(id)
	}

	async exportTaskWithId(id: string) {
		return this.taskHistoryDelegate.exportTaskWithId(id)
	}

	async condenseTaskContext(taskId: string) {
		return this.taskHistoryDelegate.condenseTaskContext(taskId)
	}

	async deleteTaskWithId(id: string, cascadeSubtasks: boolean = true) {
		return this.taskHistoryDelegate.deleteTaskWithId(id, cascadeSubtasks)
	}

	async deleteTaskFromState(id: string) {
		return this.taskHistoryDelegate.deleteTaskFromState(id)
	}

	async resetState() {
		return this.taskHistoryDelegate.resetState()
	}

	// =============================================================================
	// Pending Edit Operations (delegated to PendingEditDelegate)
	// =============================================================================

	public setPendingEditOperation(
		operationId: string,
		editData: {
			messageTs: number
			editedContent: string
			images?: string[]
			messageIndex: number
			apiConversationHistoryIndex: number
		},
	): void {
		this.pendingEditDelegate.setPendingEditOperation(operationId, editData)
	}

	public getPendingEditOperation(operationId: string) {
		return this.pendingEditDelegate.getPendingEditOperation(operationId)
	}

	public clearPendingEditOperation(operationId: string): boolean {
		return this.pendingEditDelegate.clearPendingEditOperation(operationId)
	}

	public clearAllPendingEditOperations(): void {
		this.pendingEditDelegate.clearAllPendingEditOperations()
	}

	// =============================================================================
	// Webview Lifecycle (delegated to WebviewLifecycleDelegate)
	// =============================================================================

	async resolveWebviewView(
		webviewView: vscode.WebviewView | vscode.WebviewPanel,
		_context?: vscode.WebviewViewResolveContext<unknown>,
		_token?: vscode.CancellationToken,
	): Promise<void> {
		await this.webviewLifecycleDelegate.resolveWebviewView(webviewView, _context, _token)
	}

	public async postMessageToWebview(message: ExtensionMessage): Promise<void> {
		await this.webviewLifecycleDelegate.postMessageToWebview(message)
	}

	public async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		return this.webviewLifecycleDelegate.getHMRHtmlContent(webview)
	}

	public async getHtmlContent(webview: vscode.Webview): Promise<string> {
		return this.webviewLifecycleDelegate.getHtmlContent(webview)
	}

	public clearWebviewResources() {
		this.webviewLifecycleDelegate.clearWebviewResources()
	}

	// =============================================================================
	// Task Stack (delegated to TaskStackDelegate)
	// =============================================================================

	public async addClineToStack(cline: Task): Promise<void> {
		await this.taskStackDelegate.addClineToStack(cline)
	}

	public async performPreparationTasks(cline: Task): Promise<void> {
		await this.taskStackDelegate.performPreparationTasks(cline)
	}

	public async removeClineFromStack(options?: { skipDelegationRepair?: boolean }): Promise<void> {
		await this.taskStackDelegate.removeClineFromStack(options)
	}

	public getTaskStackSize(): number {
		return this.taskStackDelegate.getTaskStackSize()
	}

	public getCurrentTaskStack(): string[] {
		return this.taskStackDelegate.getCurrentTaskStack()
	}

	public getRecentTasks(): string[] {
		return this.taskHistoryDelegate.getRecentTasks()
	}

	async createTask(
		message?: string,
		images?: string[],
		parent?: Task,
		options?: CreateTaskOptions,
	): Promise<Task> {
		return this.taskStackDelegate.createTask(message, images, parent, options)
	}

	async createTaskWithHistoryItem(historyItem: HistoryItem, options?: { startTask?: boolean }): Promise<Task> {
		return this.taskStackDelegate.createTaskWithHistoryItem(historyItem, options)
	}

	async cancelTask(): Promise<void> {
		await this.taskStackDelegate.cancelTask()
	}

	async clearTask(): Promise<void> {
		await this.taskStackDelegate.clearTask()
	}

	/**
	 * Close every open task (main task and any sub tasks) and return to the main UI.
	 */
	async clearAllTasks(): Promise<void> {
		await this.taskStackDelegate.clearAllTasks()
	}

	async resumeTask(taskId: string): Promise<void> {
		await this.taskStackDelegate.resumeTask(taskId)
	}

	// =============================================================================
	// Dispose (delegated to DisposeDelegate)
	// =============================================================================

	dispose() {
		this.disposeDelegate.dispose()
	}

	// =============================================================================
	// Static Methods (delegated to StaticDelegate)
	// =============================================================================

	public static getVisibleInstance(): ClineProvider | undefined {
		return StaticDelegate.getVisibleInstance()
	}

	public static getInstance(): ClineProvider | undefined {
		return StaticDelegate.getInstance()
	}

	public static isActiveTask(taskId: string): boolean {
		return StaticDelegate.isActiveTask(taskId)
	}

	public static async handleCodeAction(
		action: CodeActionId | CodeActionName,
		promptType?: string,
		context?: any, // eslint-disable-line @typescript-eslint/no-explicit-any
	): Promise<void> {
		await StaticDelegate.handleCodeAction(action, promptType, context)
	}

	public static async handleTerminalAction(
		action: TerminalActionId,
		promptType?: TerminalActionPromptType,
		context?: any, // eslint-disable-line @typescript-eslint/no-explicit-any
	): Promise<void> {
		await StaticDelegate.handleTerminalAction(action, promptType, context)
	}

	// =============================================================================
	// MCP Operations (delegated to McpDelegate)
	// =============================================================================

	getMcpHub(): McpHub | undefined {
		return this.mcpDelegate.getMcpHub()
	}

	getMcpServersFromGlobalConfig(): Record<string, any> {
		return this.mcpDelegate.getMcpServersFromGlobalConfig()
	}

	getMcpEnabledFromGlobalConfig(): boolean {
		return this.mcpDelegate.getMcpEnabledFromGlobalConfig()
	}

	async saveMcpServersToGlobalConfig(servers: any[]): Promise<void> {
		await this.mcpDelegate.saveMcpServersToGlobalConfig(servers)
	}

	// =============================================================================
	// Context Proxy Wrappers
	// =============================================================================

	async getGlobalState(key: any): Promise<any> {
		return this.contextProxy.getValue(key)
	}

	async setValue(key: any, value: any): Promise<void> {
		await this.contextProxy.setValue(key, value)
	}

	async getValue(key: any): Promise<any> {
		return this.contextProxy.getValue(key)
	}

	async getValues(): Promise<any> {
		return this.contextProxy.getValues()
	}

	async setValues(values: any): Promise<void> {
		await this.contextProxy.setValues(values)
	}

	// =============================================================================
	// Delegation
	// =============================================================================

	async delegateParentAndOpenChild(params: {
		parentTaskId: string
		message: string
		initialTodos: any[]
		mode: string
	}): Promise<Task> {
		return delegateParentAndOpenChild(this, params)
	}

	async reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void> {
		await reopenParentFromDelegation(this, params)
	}

	// =============================================================================
	// Utility
	// =============================================================================

	convertToWebviewUri(uri: vscode.Uri): vscode.Uri {
		if (!this.view) {
			return uri
		}
		return this.view.webview.asWebviewUri(uri)
	}
}
