import * as vscode from "vscode"
import * as path from "path"
import fs from "fs/promises"
import { Anthropic } from "@anthropic-ai/sdk"

import {
	type HistoryItem,
	type ExtensionState,
	type GlobalState,
	type RooCodeSettings,
} from "@roo-code/types"
import { aggregateTaskCostsRecursive, type AggregatedCosts } from "../aggregateTaskCosts"
import { GlobalFileNames } from "../../../shared/globalFileNames"
import { fileExistsAtPath } from "../../../utils/fs"
import { downloadTask, getTaskFileName } from "../../../integrations/misc/export-markdown"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../../utils/export"
import { ShadowCheckpointService } from "../../../services/checkpoints/ShadowCheckpointService"
import { getWorkspacePath } from "../../../utils/path"
import type { ClineProvider } from "../ClineProvider"
import type { Task } from "../../task/Task"

export class TaskHistoryDelegate {
	constructor(private readonly provider: ClineProvider) {}

	get contextProxy() {
		return this.provider.contextProxy
	}

	get taskHistoryStore() {
		return this.provider.taskHistoryStore
	}

	get cwd() {
		return this.provider.cwd
	}

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const historyItem =
			this.taskHistoryStore.get(id) ?? (this.provider.getGlobalState("taskHistory") ?? []).find((item) => item.id === id)

		if (!historyItem) {
			throw new Error("Task not found")
		}

		const { getTaskDirectoryPath } = await import("../../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		const taskDirPath = await getTaskDirectoryPath(globalStoragePath, id)
		const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
		const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
		const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)

		let apiConversationHistory: Anthropic.MessageParam[] = []

		if (fileExists) {
			try {
				apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
			} catch (error) {
				console.warn(
					`[getTaskWithId] api_conversation_history.json corrupted for task ${id}, returning empty history: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		} else {
			console.warn(
				`[getTaskWithId] api_conversation_history.json missing for task ${id}, returning empty history`,
			)
		}

		return {
			historyItem,
			taskDirPath,
			apiConversationHistoryFilePath,
			uiMessagesFilePath,
			apiConversationHistory,
		}
	}

	async getTaskWithAggregatedCosts(taskId: string): Promise<{
		historyItem: HistoryItem
		aggregatedCosts: AggregatedCosts
	}> {
		const { historyItem } = await this.getTaskWithId(taskId)

		const aggregatedCosts = await aggregateTaskCostsRecursive(taskId, async (id: string) => {
			const result = await this.getTaskWithId(id)
			return result.historyItem
		})

		return { historyItem, aggregatedCosts }
	}

	async showTaskWithId(id: string) {
		if (id !== this.provider.getCurrentTask()?.taskId) {
			const { historyItem } = await this.getTaskWithId(id)
			await this.provider.createTaskWithHistoryItem(historyItem)
		}

		await this.provider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	async exportTaskWithId(id: string) {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		const fileName = getTaskFileName(historyItem.ts)
		const os = await import("os")
		const defaultUri = await resolveDefaultSaveUri(this.contextProxy, "lastTaskExportPath", fileName, {
			useWorkspace: false,
			fallbackDir: path.join(os.homedir(), "Downloads"),
		})
		const saveUri = await downloadTask(historyItem.ts, apiConversationHistory, defaultUri)

		if (saveUri) {
			await saveLastExportPath(this.contextProxy, "lastTaskExportPath", saveUri)
		}
	}

	async condenseTaskContext(taskId: string) {
		let task: Task | undefined
		const clineStack = this.provider.clineStack
		for (let i = clineStack.length - 1; i >= 0; i--) {
			if (clineStack[i].taskId === taskId) {
				task = clineStack[i]
				break
			}
		}
		if (!task) {
			throw new Error(`Task with id ${taskId} not found in stack`)
		}
		await task.condenseContext()
		await this.provider.postMessageToWebview({ type: "condenseTaskContextResponse", text: taskId })
	}

	async deleteTaskWithId(id: string, cascadeSubtasks: boolean = true) {
		try {
			const { taskDirPath, historyItem } = await this.getTaskWithId(id)

			const allIdsToDelete: string[] = [id]

			if (cascadeSubtasks) {
				const collectChildIds = async (taskId: string): Promise<void> => {
					try {
						const { historyItem: item } = await this.getTaskWithId(taskId)
						if (item.childIds && item.childIds.length > 0) {
							for (const childId of item.childIds) {
								allIdsToDelete.push(childId)
								await collectChildIds(childId)
							}
						}
					} catch (error) {
						console.log(`[deleteTaskWithId] child task ${taskId} not found, skipping`)
					}
				}

				await collectChildIds(id)
			}

			for (const taskId of allIdsToDelete) {
				if (taskId === this.provider.getCurrentTask()?.taskId) {
					await this.provider.removeClineFromStack()
					break
				}
			}

			await this.taskHistoryStore.deleteMany(allIdsToDelete)
			this.provider.recentTasksCache = undefined

			const globalStorageDir = this.contextProxy.globalStorageUri.fsPath
			const workspaceDir = this.cwd
			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const globalStoragePath = this.contextProxy.globalStorageUri.fsPath

			for (const taskId of allIdsToDelete) {
				try {
					await ShadowCheckpointService.deleteTask({ taskId, globalStorageDir, workspaceDir })
				} catch (error) {
					console.error(
						`[deleteTaskWithId${taskId}] failed to delete associated shadow repository or branch: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				try {
					const dirPath = await getTaskDirectoryPath(globalStoragePath, taskId)
					await fs.rm(dirPath, { recursive: true, force: true })
					console.log(`[deleteTaskWithId${taskId}] removed task directory`)
				} catch (error) {
					console.error(
						`[deleteTaskWithId${taskId}] failed to remove task directory: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			await this.provider.postStateToWebview()
		} catch (error) {
			if (error instanceof Error && error.message === "Task not found") {
				await this.deleteTaskFromState(id)
				return
			}
			throw error
		}
	}

	async deleteTaskFromState(id: string) {
		await this.taskHistoryStore.delete(id)
		this.provider.recentTasksCache = undefined

		await this.provider.postStateToWebview()
	}

	async updateTaskHistory(item: HistoryItem, options: { broadcast?: boolean } = {}): Promise<HistoryItem[]> {
		const { broadcast = true } = options

		const history = await this.taskHistoryStore.upsert(item)
		this.provider.recentTasksCache = undefined

		if (broadcast && this.provider.isViewLaunched) {
			const updatedItem = this.taskHistoryStore.get(item.id) ?? item
			await this.provider.postMessageToWebview({ type: "taskHistoryItemUpdated", taskHistoryItem: updatedItem })
		}

		return history
	}

	getRecentTasks(): string[] {
		if (this.provider.recentTasksCache) {
			return this.provider.recentTasksCache
		}

		const history = this.taskHistoryStore.getAll()
		const workspaceTasks: HistoryItem[] = []

		for (const item of history) {
			if (!item.ts || !item.task || item.workspace !== this.cwd) {
				continue
			}

			workspaceTasks.push(item)
		}

		if (workspaceTasks.length === 0) {
			this.provider.recentTasksCache = []
			return this.provider.recentTasksCache
		}

		workspaceTasks.sort((a, b) => b.ts - a.ts)
		let recentTaskIds: string[] = []

		if (workspaceTasks.length >= 100) {
			const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

			for (const item of workspaceTasks) {
				if (item.ts < sevenDaysAgo) {
					break
				}

				recentTaskIds.push(item.id)
			}
		} else {
			recentTaskIds = workspaceTasks.slice(0, Math.min(100, workspaceTasks.length)).map((item) => item.id)
		}

		this.provider.recentTasksCache = recentTaskIds
		return this.provider.recentTasksCache
	}

	async broadcastTaskHistoryUpdate(history?: HistoryItem[]): Promise<void> {
		if (!this.provider.isViewLaunched) {
			return
		}

		const taskHistory = history ?? this.taskHistoryStore.getAll()

		const sortedHistory = taskHistory
			.filter((item: HistoryItem) => item.ts && item.task)
			.sort((a: HistoryItem, b: HistoryItem) => b.ts - a.ts)

		await this.provider.postMessageToWebview({
			type: "taskHistoryUpdated",
			taskHistory: sortedHistory,
		})
	}

	async initializeTaskHistoryStore(): Promise<void> {
		try {
			await this.taskHistoryStore.initialize()

			const migrationKey = "taskHistoryMigratedToFiles"
			const alreadyMigrated = this.provider.context.globalState.get<boolean>(migrationKey)

			let legacyHistory: HistoryItem[] = []
			const fromVscode = this.provider.context.globalState.get<HistoryItem[]>("taskHistory") ?? []
			let fromSettingsStore: HistoryItem[] = []

			try {
				const { getSettingsStore } = await import("../../../services/SettingsStore")
				const store = getSettingsStore()
				const candidate = store.getGlobalState("taskHistory" as any)
				if (Array.isArray(candidate) && candidate.length > 0) {
					fromSettingsStore = candidate as HistoryItem[]
				}
			} catch {}

			const mergedMap = new Map<string, HistoryItem>()
			for (const item of [...fromVscode, ...fromSettingsStore]) {
				if (item && item.id) {
					if (!mergedMap.has(item.id)) {
						mergedMap.set(item.id, item)
					} else {
						const existing = mergedMap.get(item.id)!
						const newTs = (item as any).ts || 0
						const oldTs = (existing as any).ts || 0
						if (newTs > oldTs) {
							mergedMap.set(item.id, item)
						}
					}
				}
			}
			legacyHistory = Array.from(mergedMap.values())

			const currentCount = this.taskHistoryStore.getAll().length
			const needsMigration = !alreadyMigrated || (currentCount === 0 && legacyHistory.length > 0)

			if (needsMigration && legacyHistory.length > 0) {
				await this.taskHistoryStore.migrateFromGlobalState(legacyHistory)
			} else if (alreadyMigrated) {
				if (legacyHistory.length > 0 && currentCount === 0) {
					await this.taskHistoryStore.migrateFromGlobalState(legacyHistory)
				}
			}

			if (!alreadyMigrated) {
				await this.provider.context.globalState.update(migrationKey, true)
			}

			this.provider.taskHistoryStoreInitialized = true
		} catch {}
	}

	scheduleGlobalStateWriteThrough(): void {
		if (this.provider.globalStateWriteThroughTimer) {
			clearTimeout(this.provider.globalStateWriteThroughTimer)
		}

		this.provider.globalStateWriteThroughTimer = setTimeout(async () => {
			this.provider.globalStateWriteThroughTimer = null
			try {
				const items = this.provider.taskHistoryStore.getAll()
				await this.provider.updateGlobalState("taskHistory", items)
			} catch (error) {
				this.provider.log(
					`[scheduleGlobalStateWriteThrough] Failed to write task history to globalState: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}, 5000)
	}

	async flushGlobalStateWriteThrough(): Promise<void> {
		if (this.provider.globalStateWriteThroughTimer) {
			clearTimeout(this.provider.globalStateWriteThroughTimer)
			this.provider.globalStateWriteThroughTimer = null
		}

		try {
			const items = this.provider.taskHistoryStore.getAll()
			await this.provider.updateGlobalState("taskHistory", items)
		} catch (error) {
			this.provider.log(
				`[flushGlobalStateWriteThrough] Failed to write task history to globalState: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	async resetState() {
		await this.provider.contextProxy.resetState()
		await this.provider.taskHistoryStore.clear()
		this.provider.recentTasksCache = undefined
		await this.provider.postStateToWebview()
	}
}