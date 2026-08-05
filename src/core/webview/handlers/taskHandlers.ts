import * as vscode from "vscode"
import type { ClineMessage } from "@roo-code/types"
import { saveTaskMessages } from "../../task-persistence"
import type { ApiMessage } from "../../task-persistence/apiMessages"
import { ClineProvider } from "../ClineProvider"
import { handleCheckpointRestoreOperation } from "../checkpointRestoreHandler"
import { resolveImageMentions } from "../../mentions/resolveImageMentions"

export interface HandlerContext {
	provider: ClineProvider
	getGlobalState: <K extends keyof import("@roo-code/types").GlobalState>(key: K) => import("@roo-code/types").GlobalState[K]
	updateGlobalState: <K extends keyof import("@roo-code/types").GlobalState>(key: K, value: import("@roo-code/types").GlobalState[K]) => Promise<void>
	getCurrentCwd: () => string | undefined
	getCurrentMode: () => Promise<string>
}

export type MessageHandler = (ctx: HandlerContext, message: any) => Promise<void>

async function resolveIncomingImages(
	ctx: HandlerContext,
	payload: { text?: string; images?: string[] },
) {
	const { provider, getCurrentCwd } = ctx
	const text = payload.text ?? ""
	const images = payload.images
	const currentTask = provider.getCurrentTask()
	const state = await provider.getState()
	const resolved = await resolveImageMentions({
		text,
		images,
		cwd: getCurrentCwd() ?? provider.cwd,
		rooIgnoreController: currentTask?.rooIgnoreController,
		maxImageFileSize: state.maxImageFileSize,
		maxTotalImageSize: state.maxTotalImageSize,
	})
	return resolved
}

export const handleTaskOperations = async (ctx: HandlerContext, message: any): Promise<void> => {
	const { provider, getGlobalState, updateGlobalState, getCurrentCwd } = ctx
	const { t } = await import("../../../i18n")

	switch (message.type) {
		case "newTask": {
			try {
				const resolved = await resolveIncomingImages(ctx, { text: message.text, images: message.images })
				await provider.createTask(
					resolved.text,
					resolved.images,
					undefined,
					{ taskId: message.taskId },
					message.taskConfiguration,
				)
				await provider.postMessageToWebview({ type: "invoke", invoke: "newChat" })
			} catch (error) {
				await provider.postMessageToWebview({ type: "invoke", invoke: "newChat" })
				vscode.window.showErrorMessage(t("common:errors.create_task"))
			}
			break
		}

		case "deleteTask": {
			try {
				if (message.taskId) {
					await provider.deleteTaskWithId(message.taskId)
				}
			} catch (error) {
				vscode.window.showErrorMessage(t("common:errors.delete_task"))
			}
			break
		}

		case "deleteTaskWithId": {
			try {
				if (message.text) {
					await provider.deleteTaskWithId(message.text)
				}
			} catch (error) {
				vscode.window.showErrorMessage(t("common:errors.delete_task"))
			}
			break
		}

		case "deleteMultipleTasksWithIds": {
			try {
				if (message.ids && Array.isArray(message.ids)) {
					for (const id of message.ids) {
						await provider.deleteTaskWithId(id)
					}
				}
			} catch (error) {
				vscode.window.showErrorMessage(t("common:errors.delete_task"))
			}
			break
		}

		case "pauseTask": {
			try {
				const currentTask = provider.getCurrentTask()
				if (currentTask) {
					currentTask.isPaused = true
					currentTask.cancelCurrentRequest()
				}
			} catch (error) {
				vscode.window.showErrorMessage(t("common:errors.pause_task"))
			}
			break
		}

		case "resumeTask": {
			try {
				const currentTask = provider.getCurrentTask()
				if (currentTask) {
					currentTask.isPaused = false
					provider.resumeTask(currentTask.taskId)
				}
			} catch (error) {
				vscode.window.showErrorMessage(t("common:errors.resume_task"))
			}
			break
		}

		case "abortTask": {
			try {
				const currentTask = provider.getCurrentTask()
				if (currentTask) {
					await currentTask.abortTask()
				}
			} catch (error) {
				vscode.window.showErrorMessage(t("common:errors.abort_task"))
			}
			break
		}

		case "focusTask": {
			if (message.taskId) {
				try {
					const { historyItem } = await provider.getTaskWithId(message.taskId)
					await provider.createTaskWithHistoryItem(historyItem)
				} catch (error) {
					provider.log(`Error focusing task: ${error}`)
				}
			}
			break
		}

		case "switchToTask": {
			if (message.taskId) {
				try {
					const { historyItem } = await provider.getTaskWithId(message.taskId)
					await provider.createTaskWithHistoryItem(historyItem, { startTask: false })
				} catch (error) {
					provider.log(`Error switching to task: ${error}`)
				}
			}
			break
		}

		case "cancelTask": {
			const currentTask = provider.getCurrentTask()
			if (currentTask) {
				await provider.cancelTask()
			}
			break
		}

		case "resetTask": {
			await provider.clearTask()
			break
		}

		case "showTaskWithId": {
			if (message.text) {
				try {
					await provider.showTaskWithId(message.text)
				} catch (error) {
					provider.log(`Error showing task: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.show_task"))
				}
			}
			break
		}

		case "exportCurrentTask": {
			try {
				const currentTask = provider.getCurrentTask()
				if (currentTask) {
					await provider.exportTaskWithId(currentTask.taskId)
				} else {
					vscode.window.showErrorMessage(t("common:errors.export_task"))
				}
			} catch (error) {
				provider.log(`Error exporting current task: ${error}`)
				vscode.window.showErrorMessage(t("common:errors.export_task"))
			}
			break
		}

		case "exportTaskWithId": {
			if (message.text) {
				try {
					await provider.exportTaskWithId(message.text)
				} catch (error) {
					provider.log(`Error exporting task: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.export_task"))
				}
			}
			break
		}
	}
}

export const handleChatOperations = async (ctx: HandlerContext, message: any): Promise<void> => {
	const { provider, getCurrentCwd } = ctx
	const { t } = await import("../../../i18n")
	const { searchCommits } = await import("../../../utils/git")

	const findMessageIndices = (messageTs: number, currentCline: any) => {
		const messageIndex = currentCline.clineMessages.findIndex((msg: ClineMessage) => msg.ts === messageTs)
		const allApiMatches = currentCline.apiConversationHistory
			.map((msg: ApiMessage, idx: number) => ({ msg, idx }))
			.filter(({ msg }: { msg: ApiMessage }) => msg.ts === messageTs)
		const preferred = allApiMatches.find(({ msg }: { msg: ApiMessage }) => !msg.isSummary) || allApiMatches[0]
		const apiConversationHistoryIndex = preferred?.idx ?? -1
		return { messageIndex, apiConversationHistoryIndex }
	}

	const findFirstApiIndexAtOrAfter = (ts: number, currentCline: any) => {
		if (typeof ts !== "number") return -1
		return currentCline.apiConversationHistory.findIndex(
			(msg: ApiMessage) => typeof msg?.ts === "number" && (msg.ts as number) >= ts,
		)
	}

	const handleDeleteMessageConfirm = async (messageTs: number, restoreCheckpoint?: boolean): Promise<void> => {
		const currentCline = provider.getCurrentTask()
		if (!currentCline) {
			console.error("[handleDeleteMessageConfirm] No current cline available")
			return
		}

		const { messageIndex, apiConversationHistoryIndex } = findMessageIndices(messageTs, currentCline)
		let apiIndexToUse = apiConversationHistoryIndex
		const tsThreshold = currentCline.clineMessages[messageIndex]?.ts
		if (apiIndexToUse === -1 && typeof tsThreshold === "number") {
			apiIndexToUse = findFirstApiIndexAtOrAfter(tsThreshold, currentCline)
		}

		if (messageIndex === -1) {
			await vscode.window.showErrorMessage(t("common:errors.message.message_not_found", { messageTs }))
			return
		}

		try {
			const targetMessage = currentCline.clineMessages[messageIndex]

			if (restoreCheckpoint) {
				const checkpoints = currentCline.clineMessages
					.filter((msg) => msg.say === "checkpoint_saved" && msg.ts < messageTs)
					.reverse()
				const nextCheckpoint = checkpoints[0]

				if (nextCheckpoint && nextCheckpoint.text) {
					await handleCheckpointRestoreOperation({
						provider,
						currentCline,
						messageTs: targetMessage.ts!,
						messageIndex,
						checkpoint: { hash: nextCheckpoint.text },
						operation: "delete",
					})
				} else {
					console.log("[handleDeleteMessageConfirm] No checkpoint found before message")
					vscode.window.showWarningMessage("No checkpoint found before this message")
				}
			} else {
				const preservedCheckpoints = new Map<number, any>()
				for (let i = 0; i < messageIndex; i++) {
					const msg = currentCline.clineMessages[i]
					if (msg?.checkpoint && msg.ts) {
						preservedCheckpoints.set(msg.ts, msg.checkpoint)
					}
				}

				await currentCline.messageManager.rewindToTimestamp(targetMessage.ts!, { includeTargetMessage: false })

				for (const [ts, checkpoint] of preservedCheckpoints) {
					const msgIndex = currentCline.clineMessages.findIndex((msg) => msg.ts === ts)
					if (msgIndex !== -1) {
						currentCline.clineMessages[msgIndex].checkpoint = checkpoint
					}
				}

				await saveTaskMessages({
					messages: currentCline.clineMessages,
					taskId: currentCline.taskId,
					globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
				})

				await provider.postStateToWebview()
			}
		} catch (error) {
			console.error("Error in delete message:", error)
			vscode.window.showErrorMessage(
				t("common:errors.message.error_deleting_message", {
					error: error instanceof Error ? error.message : String(error),
				}),
			)
		}
	}

	const handleEditMessageConfirm = async (
		messageTs: number,
		editedContent: string,
		restoreCheckpoint?: boolean,
		images?: string[],
	): Promise<void> => {
		const currentCline = provider.getCurrentTask()
		if (!currentCline) {
			console.error("[handleEditMessageConfirm] No current cline available")
			return
		}

		const { messageIndex, apiConversationHistoryIndex } = findMessageIndices(messageTs, currentCline)

		if (messageIndex === -1) {
			const errorMessage = t("common:errors.message.message_not_found", { messageTs })
			console.error("[handleEditMessageConfirm]", errorMessage)
			await vscode.window.showErrorMessage(errorMessage)
			return
		}

		try {
			const targetMessage = currentCline.clineMessages[messageIndex]

			if (restoreCheckpoint) {
				const checkpoints = currentCline.clineMessages
					.filter((msg) => msg.say === "checkpoint_saved" && msg.ts < messageTs)
					.reverse()
				const nextCheckpoint = checkpoints[0]

				if (nextCheckpoint && nextCheckpoint.text) {
					await handleCheckpointRestoreOperation({
						provider,
						currentCline,
						messageTs: targetMessage.ts!,
						messageIndex,
						checkpoint: { hash: nextCheckpoint.text },
						operation: "edit",
						editData: {
							editedContent,
							images,
							apiConversationHistoryIndex,
						},
					})
					return
				} else {
					console.log("[handleEditMessageConfirm] No checkpoint found before message")
					vscode.window.showWarningMessage("No checkpoint found before this message")
				}
			}

			let deleteFromMessageIndex = messageIndex
			let deleteFromApiIndex = apiConversationHistoryIndex

			for (let i = messageIndex; i >= 0; i--) {
				const m = currentCline.clineMessages[i]
				if (m?.say === "user_feedback") {
					deleteFromMessageIndex = i
					const userTs = m.ts
					if (typeof userTs === "number") {
						const apiIdx = currentCline.apiConversationHistory.findIndex(
							(am: ApiMessage) => am.ts === userTs,
						)
						if (apiIdx !== -1) {
							deleteFromApiIndex = apiIdx
						}
					}
					break
				}
			}

			if (deleteFromApiIndex === -1) {
				const tsThresholdForEdit = currentCline.clineMessages[deleteFromMessageIndex]?.ts
				if (typeof tsThresholdForEdit === "number") {
					deleteFromApiIndex = findFirstApiIndexAtOrAfter(tsThresholdForEdit, currentCline)
				}
			}

			const preservedCheckpoints = new Map<number, any>()
			for (let i = 0; i < deleteFromMessageIndex; i++) {
				const msg = currentCline.clineMessages[i]
				if (msg?.checkpoint && msg.ts) {
					preservedCheckpoints.set(msg.ts, msg.checkpoint)
				}
			}

			const rewindTs = currentCline.clineMessages[deleteFromMessageIndex]?.ts
			if (rewindTs) {
				await currentCline.messageManager.rewindToTimestamp(rewindTs, { includeTargetMessage: false })
			}

			for (const [ts, checkpoint] of preservedCheckpoints) {
				const msgIndex = currentCline.clineMessages.findIndex((msg) => msg.ts === ts)
				if (msgIndex !== -1) {
					currentCline.clineMessages[msgIndex].checkpoint = checkpoint
				}
			}

			await saveTaskMessages({
				messages: currentCline.clineMessages,
				taskId: currentCline.taskId,
				globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
			})

			await provider.postStateToWebview()

			await currentCline.submitUserMessage(editedContent, images)
		} catch (error) {
			console.error("Error in edit message:", error)
			vscode.window.showErrorMessage(
				t("common:errors.message.error_editing_message", {
					error: error instanceof Error ? error.message : String(error),
				}),
			)
		}
	}

	switch (message.type) {
		case "submit": {
			const resolved = await resolveIncomingImages(ctx, { text: message.text, images: message.images })
			provider.getCurrentTask()?.messageQueueService.addMessage(resolved.text, resolved.images)
			break
		}

		case "deleteMessage": {
			const currentTask = provider.getCurrentTask()
			const messageTs = message.value
			if (messageTs !== undefined && currentTask) {
				const hasCheckpoint = currentTask.clineMessages.some(
					(msg: any) => msg.say === "checkpoint_saved" && msg.ts < messageTs,
				)
				await provider.postMessageToWebview({
					type: "showDeleteMessageDialog",
					messageTs,
					hasCheckpoint,
				})
			}
			break
		}

		case "editMessage": {
			const currentTask = provider.getCurrentTask()
			const messageTs = message.value
			const text = message.editedMessageContent ?? message.text
			if (messageTs !== undefined && text !== undefined && currentTask) {
				const hasCheckpoint = currentTask.clineMessages.some(
					(msg: any) => msg.say === "checkpoint_saved" && msg.ts < messageTs,
				)
				await provider.postMessageToWebview({
					type: "showEditMessageDialog",
					messageTs,
					text,
					hasCheckpoint,
					images: message.images,
				})
			}
			break
		}

		case "deleteMessageConfirm":
			if (!message.messageTs) {
				await vscode.window.showErrorMessage(t("common:errors.message.cannot_delete_missing_timestamp"))
				break
			}
			if (typeof message.messageTs !== "number") {
				await vscode.window.showErrorMessage(t("common:errors.message.cannot_delete_invalid_timestamp"))
				break
			}
			await handleDeleteMessageConfirm(message.messageTs, message.restoreCheckpoint)
			break

		case "editMessageConfirm":
			if (message.messageTs && message.text) {
				const resolved = await resolveIncomingImages(ctx, { text: message.text, images: message.images })
				await handleEditMessageConfirm(
					message.messageTs,
					resolved.text,
					message.restoreCheckpoint,
					resolved.images,
				)
			}
			break

		case "queueMessage": {
			const resolved = await resolveIncomingImages(ctx, { text: message.text, images: message.images })
			provider.getCurrentTask()?.messageQueueService.addMessage(resolved.text, resolved.images)
			break
		}

		case "removeQueuedMessage": {
			provider.getCurrentTask()?.messageQueueService.removeMessage(message.text ?? "")
			break
		}

		case "editQueuedMessage": {
			if (message.payload) {
				const { id, text, images } = message.payload
				provider.getCurrentTask()?.messageQueueService.updateMessage(id, text, images)
			}
			break
		}

		case "searchCommits": {
			const cwd = getCurrentCwd()
			if (cwd) {
				try {
					const commits = await searchCommits(message.query || "", cwd)
					await provider.postMessageToWebview({ type: "commitSearchResults", commits })
				} catch (error) {
					provider.log(`Error searching commits: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.search_commits"))
				}
			}
			break
		}
	}
}