import * as vscode from "vscode"
import type { WebviewMessage } from "@roo-code/types"
import type { HandlerContext } from "./context"
import { resolveImageMentions } from "../../mentions/resolveImageMentions"

export async function handleProviderOperations(ctx: HandlerContext, message: WebviewMessage): Promise<void> {
	const { provider } = ctx

	switch (message.type) {
		case "webviewDidLaunch":
			provider.isViewLaunched = true
			await provider.ensureSettingsImportedAtFromConfig()
			await provider.hydrateProviderProfileFromConfig()
			await provider.mcpHubInitializationPromise
			await provider.postStateToWebview()
			await provider.broadcastTaskHistoryUpdate()
			break

		case "askResponse": {
			const text = message.text ?? ""
			const images = message.images
			const currentTask = provider.getCurrentTask()
			const state = await provider.getState()
			const resolved = await resolveImageMentions({
				text,
				images,
				cwd: ctx.getCurrentCwd(),
				rooIgnoreController: currentTask?.rooIgnoreController,
				maxImageFileSize: state.maxImageFileSize,
				maxTotalImageSize: state.maxTotalImageSize,
			})
			provider
				.getCurrentTask()
				?.handleWebviewAskResponse(message.askResponse!, resolved.text, resolved.images)
			break
		}

		case "mode":
			if (message.text) {
				await provider.handleModeSwitch(message.text)
			}
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
	}
}