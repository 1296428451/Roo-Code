import * as vscode from "vscode"
import { ClineProvider } from "../ClineProvider"
import { MessageEnhancer } from "../messageEnhancer"
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
	const { provider } = ctx

	switch (message.type) {
		case "enhancePrompt": {
			try {
				const messageEnhancer = new MessageEnhancer(provider)
				const enhancedText = await messageEnhancer.enhancePrompt(message.text || "", message.images || [])
				await provider.postMessageToWebview({ type: "enhancedPrompt", text: enhancedText })
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