import * as vscode from "vscode"

import {
	type GlobalState,
	type ClineMessage,
	type ModelRecord,
	type WebviewMessage,
} from "@roo-code/types"

import { type ApiMessage } from "../task-persistence/apiMessages"
import { saveTaskMessages } from "../task-persistence"

import { ClineProvider } from "./ClineProvider"
import { handleCheckpointRestoreOperation } from "./checkpointRestoreHandler"
import {
	handleRequestSkills,
	handleCreateSkill,
	handleDeleteSkill,
	handleMoveSkill,
	handleUpdateSkillModes,
	handleOpenSkillFile,
} from "./skillsMessageHandler"
import { t } from "../../i18n"
import { resolveImageMentions } from "../mentions/resolveImageMentions"
import { defaultModeSlug } from "../../shared/modes"
import { setPendingTodoList } from "../tools/UpdateTodoListTool"
import { type RouterName, toRouterName, type GetModelsOptions } from "../../shared/api"
import { getModels, flushModels } from "../../api/providers/fetchers/modelCache"
import { getOpenAiModels } from "../../api/providers/openai"
import { getVsCodeLmModels } from "../../api/providers/vscode-lm"
import {
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
} from "./handlers"

export interface HandlerContext {
	provider: ClineProvider
	getGlobalState: <K extends keyof GlobalState>(key: K) => GlobalState[K]
	updateGlobalState: <K extends keyof GlobalState>(key: K, value: GlobalState[K]) => Promise<void>
	getCurrentCwd: () => string | undefined
	getCurrentMode: () => Promise<string>
}

export const webviewMessageHandler = async (provider: ClineProvider, message: WebviewMessage) => {
	const getGlobalState = <K extends keyof GlobalState>(key: K) => provider.contextProxy.getValue(key)
	const updateGlobalState = async <K extends keyof GlobalState>(key: K, value: GlobalState[K]) =>
		await provider.contextProxy.setValue(key, value)

	const getCurrentCwd = () => {
		return provider.getCurrentTask()?.cwd || provider.cwd
	}

	const getCurrentMode = async (): Promise<string> => {
		const currentTask = provider.getCurrentTask()

		if (currentTask) {
			try {
				return await currentTask.getTaskMode()
			} catch (error) {
				provider.log(`Error resolving current task mode for command discovery: ${error}`)
			}
		}

		try {
			const state = await provider.getState()
			if (typeof state.mode === "string" && state.mode.length > 0) {
				return state.mode
			}
		} catch (error) {
			provider.log(`Error resolving global mode for command discovery: ${error}`)
		}

		return defaultModeSlug
	}

	const ctx: HandlerContext = {
		provider,
		getGlobalState,
		updateGlobalState,
		getCurrentCwd,
		getCurrentMode,
	}

	const resolveIncomingImages = async (payload: { text?: string; images?: string[] }) => {
		const text = payload.text ?? ""
		const images = payload.images
		const currentTask = provider.getCurrentTask()
		const state = await provider.getState()
		const resolved = await resolveImageMentions({
			text,
			images,
			cwd: getCurrentCwd(),
			rooIgnoreController: currentTask?.rooIgnoreController,
			maxImageFileSize: state.maxImageFileSize,
			maxTotalImageSize: state.maxTotalImageSize,
		})
		return resolved
	}

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
		case "askResponse": {
			// Frontend posts this when user clicks Approve/Deny on a tool or follow-up ask.
			// Resolve any image mentions before forwarding to the active task so embedded
			// image references (e.g. file mentions) are loaded into context. Without this
			// case, all approval clicks become no-ops and the Task.pWaitFor never resolves.
			const resolved = await resolveIncomingImages({ text: message.text, images: message.images })
			provider
				.getCurrentTask()
				?.handleWebviewAskResponse(message.askResponse!, resolved.text, resolved.images)
			break
		}

		case "webviewDidLaunch":
			provider.isViewLaunched = true
			await provider.ensureSettingsImportedAtFromConfig()
			await provider.hydrateProviderProfileFromConfig()
			await provider.mcpHubInitializationPromise
			await provider.postStateToWebview()
			await provider.broadcastTaskHistoryUpdate()
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

		case "mode":
			if (message.text) {
				await provider.handleModeSwitch(message.text)
			}
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

		case "updateSettings": {
			if (message.updatedSettings) {
				await provider.contextProxy.setValues(message.updatedSettings)
				const mcpHub = provider.getMcpHub()
				if (message.updatedSettings.mcpEnabled !== undefined && mcpHub) {
					await mcpHub.handleMcpEnabledChange(message.updatedSettings.mcpEnabled)
				}
				await provider.postStateToWebview()
			}
			break
		}

		case "autoApprovalEnabled": {
			await provider.contextProxy.setValue("autoApprovalEnabled", message.bool ?? false)
			await provider.postStateToWebview()
			break
		}

		case "resetState":
			await provider.resetState()
			break

		case "getVSCodeSetting": {
			if (message.setting) {
				const config = vscode.workspace.getConfiguration()
				const value = config.get(message.setting)
				await provider.postMessageToWebview({ type: "vsCodeSetting", setting: message.setting, value })
			}
			break
		}

		case "flushRouterModels": {
			const routerNameFlush: RouterName = toRouterName(message.text)
			// Note: flushRouterModels is a generic flush without credentials
			// For providers that need credentials, use their specific handlers
			await flushModels({ provider: routerNameFlush } as GetModelsOptions, true)
			break
		}

		case "requestRouterModels": {
			const { apiConfiguration } = await provider.getState()

			// Optional single provider filter from webview
			const requestedProvider = message?.values?.provider
			const providerFilter = requestedProvider ? toRouterName(requestedProvider) : undefined

			// Optional refresh flag to flush cache before fetching (useful for providers requiring credentials)
			const shouldRefresh = message?.values?.refresh === true

			const routerModels: Record<RouterName, ModelRecord> = providerFilter
				? ({} as Record<RouterName, ModelRecord>)
				: {
						openrouter: {},
						"vercel-ai-gateway": {},
						litellm: {},
						requesty: {},
						unbound: {},
						ollama: {},
						lmstudio: {},
						poe: {},
					}

			const safeGetModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
				try {
					return await getModels(options)
				} catch (error) {
					console.error(
						`Failed to fetch models in webviewMessageHandler requestRouterModels for ${options.provider}:`,
						error,
					)

					throw error // Re-throw to be caught by Promise.allSettled.
				}
			}

			// Base candidates (only those handled by this aggregate fetcher)
			const candidates: { key: RouterName; options: GetModelsOptions }[] = [
				{ key: "openrouter", options: { provider: "openrouter" } },
				{
					key: "requesty",
					options: {
						provider: "requesty",
						apiKey: apiConfiguration.requestyApiKey,
						baseUrl: apiConfiguration.requestyBaseUrl,
					},
				},
				{
					key: "unbound",
					options: {
						provider: "unbound",
						apiKey: apiConfiguration.unboundApiKey,
					},
				},
				{ key: "vercel-ai-gateway", options: { provider: "vercel-ai-gateway" } },
			]

			// LiteLLM is conditional on baseUrl+apiKey
			const litellmApiKey = apiConfiguration.litellmApiKey || message?.values?.litellmApiKey
			const litellmBaseUrl = apiConfiguration.litellmBaseUrl || message?.values?.litellmBaseUrl

			if (litellmApiKey && litellmBaseUrl) {
				// If explicit credentials are provided in message.values (from Refresh Models button),
				// flush the cache first to ensure we fetch fresh data with the new credentials
				if (message?.values?.litellmApiKey || message?.values?.litellmBaseUrl) {
					await flushModels({ provider: "litellm", apiKey: litellmApiKey, baseUrl: litellmBaseUrl }, true)
				}

				candidates.push({
					key: "litellm",
					options: { provider: "litellm", apiKey: litellmApiKey, baseUrl: litellmBaseUrl },
				})
			}

			// Poe is conditional on apiKey
			const poeApiKey = apiConfiguration.poeApiKey || message?.values?.poeApiKey
			const poeBaseUrl = apiConfiguration.poeBaseUrl || message?.values?.poeBaseUrl

			if (poeApiKey) {
				if (message?.values?.poeApiKey || message?.values?.poeBaseUrl) {
					await flushModels({ provider: "poe", apiKey: poeApiKey, baseUrl: poeBaseUrl }, true)
				}

				candidates.push({
					key: "poe",
					options: { provider: "poe", apiKey: poeApiKey, baseUrl: poeBaseUrl },
				})
			}

			// Apply single provider filter if specified
			const modelFetchPromises = providerFilter
				? candidates.filter(({ key }) => key === providerFilter)
				: candidates

			// If refresh flag is set and we have a specific provider, flush its cache first
			if (shouldRefresh && providerFilter && modelFetchPromises.length > 0) {
				const targetCandidate = modelFetchPromises[0]
				await flushModels(targetCandidate.options, true)
			}

			const results = await Promise.allSettled(
				modelFetchPromises.map(async ({ key, options }) => {
					const models = await safeGetModels(options)
					return { key, models } // The key is `ProviderName` here.
				}),
			)

			results.forEach((result, index) => {
				const routerName = modelFetchPromises[index].key

				if (result.status === "fulfilled") {
					routerModels[routerName] = result.value.models

					// Ollama and LM Studio settings pages still need these events. They are not fetched here.
				} else {
					// Handle rejection: Post a specific error message for this provider.
					const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason)
					console.error(`Error fetching models for ${routerName}:`, result.reason)

					routerModels[routerName] = {} // Ensure it's an empty object in the main routerModels message.

					provider.postMessageToWebview({
						type: "singleRouterModelFetchResponse",
						success: false,
						error: errorMessage,
						values: { provider: routerName },
					})
				}
			})

			provider.postMessageToWebview({
				type: "routerModels",
				routerModels,
				values: providerFilter ? { provider: requestedProvider } : undefined,
			})
			break
		}

		case "requestOllamaModels": {
			// Specific handler for Ollama models only.
			const { apiConfiguration: ollamaApiConfig } = await provider.getState()
			try {
				const ollamaOptions = {
					provider: "ollama" as const,
					baseUrl: ollamaApiConfig.ollamaBaseUrl,
					apiKey: ollamaApiConfig.ollamaApiKey,
				}
				// Flush cache and refresh to ensure fresh models.
				await flushModels(ollamaOptions, true)

				const ollamaModels = await getModels(ollamaOptions)

				if (Object.keys(ollamaModels).length > 0) {
					provider.postMessageToWebview({ type: "ollamaModels", ollamaModels: ollamaModels })
				}
			} catch (error) {
				// Silently fail - user hasn't configured Ollama yet
				console.debug("Ollama models fetch failed:", error)
			}
			break
		}

		case "requestLmStudioModels": {
			// Specific handler for LM Studio models only.
			const { apiConfiguration: lmStudioApiConfig } = await provider.getState()
			try {
				const lmStudioOptions = {
					provider: "lmstudio" as const,
					baseUrl: lmStudioApiConfig.lmStudioBaseUrl,
				}
				// Flush cache and refresh to ensure fresh models.
				await flushModels(lmStudioOptions, true)

				const lmStudioModels = await getModels(lmStudioOptions)

				if (Object.keys(lmStudioModels).length > 0) {
					provider.postMessageToWebview({
						type: "lmStudioModels",
						lmStudioModels: lmStudioModels,
					})
				}
			} catch (error) {
				// Silently fail - user hasn't configured LM Studio yet.
				console.debug("LM Studio models fetch failed:", error)
			}
			break
		}

		case "requestOpenAiModels":
			if (message?.values?.baseUrl && message?.values?.apiKey) {
				const openAiModels = await getOpenAiModels(
					message?.values?.baseUrl,
					message?.values?.apiKey,
					message?.values?.openAiHeaders,
				)

				provider.postMessageToWebview({ type: "openAiModels", openAiModels })
			}

			break
		case "requestVsCodeLmModels": {
			const vsCodeLmModels = await getVsCodeLmModels()
			// TODO: Cache like we do for OpenRouter, etc?
			provider.postMessageToWebview({ type: "vsCodeLmModels", vsCodeLmModels })
			break
		}

		default:
			break
	}
}