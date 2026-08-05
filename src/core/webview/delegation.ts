import * as vscode from "vscode"

import type { ClineMessage, TodoItem } from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"

import { readApiMessages, saveApiMessages, saveTaskMessages } from "../task-persistence"
import { readTaskMessages } from "../task-persistence/taskMessages"
import { validateAndFixToolResultIds } from "../task/validateToolResultIds"
import type { Task } from "../task/Task"
import type { ClineProvider } from "./ClineProvider"

/**
 * Delegate parent task and open child task.
 *
 * - Enforce single-open invariant
 * - Persist parent delegation metadata
 * - Emit TaskDelegated (task-level; API forwards to provider/bridge)
 * - Create child as sole active and switch mode to child's mode
 */
export async function delegateParentAndOpenChild(
	provider: ClineProvider,
	params: {
		parentTaskId: string
		message: string
		initialTodos: TodoItem[]
		mode: string
	},
): Promise<Task> {
	const { parentTaskId, message, initialTodos, mode } = params

	// 1) Get parent (must be current task)
	const parent = provider.getCurrentTask()
	if (!parent) {
		throw new Error("[delegateParentAndOpenChild] No current task")
	}
	if (parent.taskId !== parentTaskId) {
		throw new Error(
			`[delegateParentAndOpenChild] Parent mismatch: expected ${parentTaskId}, current ${parent.taskId}`,
		)
	}

	// 2) Flush pending tool results to API history BEFORE disposing the parent.
	try {
		const flushSuccess = await parent.flushPendingToolResultsToHistory()

		if (!flushSuccess) {
			console.warn(`[delegateParentAndOpenChild] Flush failed for parent ${parentTaskId}, retrying...`)
			const retrySuccess = await parent.retrySaveApiConversationHistory()

			if (!retrySuccess) {
				console.error(
					`[delegateParentAndOpenChild] CRITICAL: Parent ${parentTaskId} API history not persisted to disk. Child return may produce stale state.`,
				)
				vscode.window.showWarningMessage(
					"Warning: Parent task state could not be saved. The parent task may lose recent context when resumed.",
				)
			}
		}
	} catch (error) {
		provider.log(
			`[delegateParentAndOpenChild] Error flushing pending tool results (non-fatal): ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}

	// 3) Enforce single-open invariant by closing/disposing the parent first
	try {
		await provider.removeClineFromStack({ skipDelegationRepair: true })
	} catch (error) {
		provider.log(
			`[delegateParentAndOpenChild] Error during parent disposal (non-fatal): ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}

	// 4) Switch provider mode to child's requested mode BEFORE creating the child task
	try {
		await provider.handleModeSwitch(mode as any)
	} catch (e) {
		provider.log(
			`[delegateParentAndOpenChild] handleModeSwitch failed for mode '${mode}': ${
				(e as Error)?.message ?? String(e)
			}`,
		)
	}

	// 5) Create child as sole active
	const child = await provider.createTask(message, undefined, parent as any, {
		initialTodos,
		initialStatus: "active",
		startTask: false,
	})

	// 6) Persist parent delegation metadata BEFORE the child starts writing.
	try {
		const { historyItem } = await provider.getTaskWithId(parentTaskId)
		const childIds = Array.from(new Set([...(historyItem.childIds ?? []), child.taskId]))
		const updatedHistory: typeof historyItem = {
			...historyItem,
			status: "delegated",
			delegatedToId: child.taskId,
			awaitingChildId: child.taskId,
			childIds,
		}
		await provider.updateTaskHistory(updatedHistory)
	} catch (err) {
		provider.log(
			`[delegateParentAndOpenChild] Failed to persist parent metadata for ${parentTaskId} -> ${child.taskId}: ${
				(err as Error)?.message ?? String(err)
			}`,
		)
	}

	// 7) Start the child task now that parent metadata is safely persisted.
	child.start()

	// 8) Emit TaskDelegated (provider-level)
	try {
		provider.emit(RooCodeEventName.TaskDelegated, parentTaskId, child.taskId)
	} catch {
		// non-fatal
	}

	return child
}

/**
 * Reopen parent task from delegation with write-back and events.
 */
export async function reopenParentFromDelegation(
	provider: ClineProvider,
	params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	},
): Promise<void> {
	const { parentTaskId, childTaskId, completionResultSummary } = params
	const globalStoragePath = provider.contextProxy.globalStorageUri.fsPath

	// 1) Load parent from history and current persisted messages
	const { historyItem } = await provider.getTaskWithId(parentTaskId)

	let parentClineMessages: ClineMessage[] = []
	try {
		parentClineMessages = await readTaskMessages({
			taskId: parentTaskId,
			globalStoragePath,
		})
	} catch {
		parentClineMessages = []
	}

	let parentApiMessages: any[] = []
	try {
		parentApiMessages = (await readApiMessages({
			taskId: parentTaskId,
			globalStoragePath,
		})) as any[]
	} catch {
		parentApiMessages = []
	}

	// 2) Inject synthetic records: UI subtask_result and update API tool_result
	const ts = Date.now()

	// Defensive: ensure arrays
	if (!Array.isArray(parentClineMessages)) parentClineMessages = []
	if (!Array.isArray(parentApiMessages)) parentApiMessages = []

	const subtaskUiMessage: ClineMessage = {
		type: "say",
		say: "subtask_result",
		text: completionResultSummary,
		ts,
	}
	parentClineMessages.push(subtaskUiMessage)
	await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })

	// Find the tool_use_id from the last assistant message's new_task tool_use
	let toolUseId: string | undefined
	for (let i = parentApiMessages.length - 1; i >= 0; i--) {
		const msg = parentApiMessages[i]
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use" && block.name === "new_task") {
					toolUseId = block.id
					break
				}
			}
			if (toolUseId) break
		}
	}

	// Preferred: if the parent history contains the native tool_use for new_task,
	// inject a matching tool_result for the Anthropic message contract
	if (toolUseId) {
		// Check if the last message is already a user message with a tool_result for this tool_use_id
		const lastMsg = parentApiMessages[parentApiMessages.length - 1]
		let alreadyHasToolResult = false
		if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
			for (const block of lastMsg.content) {
				if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
					// Update the existing tool_result content
					block.content = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
					alreadyHasToolResult = true
					break
				}
			}
		}

		// If no existing tool_result found, create a NEW user message with the tool_result
		if (!alreadyHasToolResult) {
			parentApiMessages.push({
				role: "user",
				content: [
					{
						type: "tool_result" as const,
						tool_use_id: toolUseId,
						content: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
					},
				],
				ts,
			})
		}

		// Validate the newly injected tool_result against the preceding assistant message.
		const lastMessage = parentApiMessages[parentApiMessages.length - 1]
		if (lastMessage?.role === "user") {
			const validatedMessage = validateAndFixToolResultIds(lastMessage, parentApiMessages.slice(0, -1))
			parentApiMessages[parentApiMessages.length - 1] = validatedMessage
		}
	} else {
		// If there is no corresponding tool_use in the parent API history, we cannot emit a
		// tool_result. Fall back to a plain user text note so the parent can still resume.
		parentApiMessages.push({
			role: "user",
			content: [
				{
					type: "text" as const,
					text: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
				},
			],
			ts,
		})
	}

	await saveApiMessages({ messages: parentApiMessages as any, taskId: parentTaskId, globalStoragePath })

	// 3) Close child instance if still open (single-open-task invariant).
	const current = provider.getCurrentTask()
	if (current?.taskId === childTaskId) {
		await provider.removeClineFromStack()
	}

	// 4) Update child metadata to "completed" status.
	try {
		const { historyItem: childHistory } = await provider.getTaskWithId(childTaskId)
		await provider.updateTaskHistory({
			...childHistory,
			status: "completed",
		})
	} catch (err) {
		provider.log(
			`[reopenParentFromDelegation] Failed to persist child completed status for ${childTaskId}: ${
				(err as Error)?.message ?? String(err)
			}`,
		)
	}

	// 5) Update parent metadata and persist BEFORE emitting completion event
	const childIds = Array.from(new Set([...(historyItem.childIds ?? []), childTaskId]))
	const updatedHistory: typeof historyItem = {
		...historyItem,
		status: "active",
		completedByChildId: childTaskId,
		completionResultSummary,
		awaitingChildId: undefined,
		childIds,
	}
	await provider.updateTaskHistory(updatedHistory)

	// 6) Emit TaskDelegationCompleted (provider-level)
	try {
		provider.emit(RooCodeEventName.TaskDelegationCompleted, parentTaskId, childTaskId, completionResultSummary)
	} catch {
		// non-fatal
	}

	// 7) Reopen the parent from history as the sole active task (restores saved mode)
	const parentInstance = await provider.createTaskWithHistoryItem(updatedHistory, { startTask: false })

	// 8) Inject restored histories into the in-memory instance before resuming
	if (parentInstance) {
		try {
			await parentInstance.overwriteClineMessages(parentClineMessages)
		} catch {
			// non-fatal
		}
		try {
			await parentInstance.overwriteApiConversationHistory(parentApiMessages as any)
		} catch {
			// non-fatal
		}

		// Auto-resume parent without ask("resume_task")
		await parentInstance.resumeAfterDelegation()
	}

	// 9) Emit TaskDelegationResumed (provider-level)
	try {
		provider.emit(RooCodeEventName.TaskDelegationResumed, parentTaskId, childTaskId)
	} catch {
		// non-fatal
	}
}