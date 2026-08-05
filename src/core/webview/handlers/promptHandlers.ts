import * as vscode from "vscode"
import { ClineProvider } from "../ClineProvider"
import { MessageEnhancer, type MessageEnhancerOptions } from "../messageEnhancer"
import { generateSystemPrompt } from "../generateSystemPrompt"
import { t } from "../../../i18n"

export interface HandlerContext {
	provider: ClineProvider
	getGlobalState: <K extends keyof import("@roo-code/types").GlobalState>(key: K) => import("@roo-code/types").GlobalState[K]
	updateGlobalState: <K extends keyof import("@roo-code/types").GlobalState>(key: K, value: import("@roo-code/types").GlobalState[K]) => Promise<void>
	getCurrentCwd: () => string | undefined
	getCurrentMode: () => Promise<string>
}

export const handlePromptOperations = async (ctx: HandlerContext, message: any): Promise<void> => {
	const { provider, getGlobalState, updateGlobalState } = ctx

	switch (message.type) {
		case "updatePrompt": {
			try {
				const existingPrompts =
					(getGlobalState("customModePrompts") as Record<string, any>) || {}
				const promptMode = message.promptMode
				const customPrompt = message.customPrompt

				existingPrompts[promptMode] = customPrompt
				await updateGlobalState("customModePrompts", existingPrompts)
				await provider.context.globalState.update("customModePrompts", existingPrompts)
				await provider.postStateToWebview()
			} catch (error) {
				provider.log(`Error updating prompt: ${error}`)
			}
			break
		}

		case "enhancePrompt": {
			try {
				const state = await provider.getState()
				const currentTask = provider.getCurrentTask()
				const options: MessageEnhancerOptions = {
					text: message.text || "",
					apiConfiguration: state.apiConfiguration,
					customSupportPrompts: state.customSupportPrompts,
					listApiConfigMeta: state.listApiConfigMeta ?? [],
					enhancementApiConfigId: state.enhancementApiConfigId,
					includeTaskHistoryInEnhance: state.includeTaskHistoryInEnhance,
					currentClineMessages: currentTask?.clineMessages,
					providerSettingsManager: provider.providerSettingsManager,
				}
				const result = await MessageEnhancer.enhanceMessage(options)
				await provider.postMessageToWebview({ type: "enhancedPrompt", text: result.enhancedText })
			} catch (error) {
				provider.log(`Error enhancing prompt: ${error}`)
				vscode.window.showErrorMessage(t("common:errors.enhance_prompt"))
				await provider.postMessageToWebview({ type: "enhancedPrompt" })
			}
			break
		}

		case "getSystemPrompt": {
			try {
				const systemPrompt = await generateSystemPrompt(provider, message)
				await provider.postMessageToWebview({
					type: "systemPrompt",
					text: systemPrompt,
					mode: message.mode,
				})
			} catch (error) {
				provider.log(`Error getting system prompt: ${error}`)
				vscode.window.showErrorMessage(t("common:errors.get_system_prompt"))
			}
			break
		}

		case "copySystemPrompt": {
			try {
				const systemPrompt = await generateSystemPrompt(provider, message)
				await vscode.env.clipboard.writeText(systemPrompt)
				await vscode.window.showInformationMessage(t("common:info.clipboard_copy"))
			} catch (error) {
				provider.log(`Error getting system prompt: ${error}`)
				vscode.window.showErrorMessage(t("common:errors.get_system_prompt"))
			}
			break
		}
	}
}