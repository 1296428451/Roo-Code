import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { ClineProvider } from "../ClineProvider"
import { t } from "../../../i18n"
import { openFile } from "../../../integrations/misc/open-file"
import { GlobalFileNames } from "../../../shared/globalFileNames"

export const handleMcpOperations = async (ctx: import("../webviewMessageHandler").HandlerContext, message: any): Promise<void> => {
	const { provider } = ctx

	switch (message.type) {
		case "toggleMcpServer": {
			if (message.serverName && message.disabled !== undefined) {
				try {
					await provider.getMcpHub()?.toggleServerDisabled(
						message.serverName,
						message.disabled,
						message.source as "global" | "project",
					)
					await provider.postStateToWebview()
				} catch (error) {
					provider.log(`Failed to toggle MCP server ${message.serverName}: ${error}`)
					vscode.window.showErrorMessage(`Failed to toggle MCP server: ${message.serverName}`)
				}
			}
			break
		}

		case "deleteMcpServer": {
			if (message.serverName) {
				try {
					await provider.getMcpHub()?.deleteServer(
						message.serverName,
						message.source as "global" | "project",
					)
					await provider.postStateToWebview()
				} catch (error) {
					provider.log(`Failed to delete MCP server ${message.serverName}: ${error}`)
					vscode.window.showErrorMessage(`Failed to delete MCP server: ${message.serverName}`)
				}
			}
			break
		}

		case "restartMcpServer": {
			if (message.text) {
				try {
					await provider.getMcpHub()?.restartConnection(
						message.text,
						message.source as "global" | "project",
					)
					await provider.postStateToWebview()
				} catch (error) {
					provider.log(`Failed to restart MCP server ${message.text}: ${error}`)
					vscode.window.showErrorMessage(`Failed to restart MCP server: ${message.text}`)
				}
			}
			break
		}

		case "refreshAllMcpServers": {
			try {
				await provider.getMcpHub()?.refreshAllConnections()
				await provider.postStateToWebview()
			} catch (error) {
				provider.log(`Failed to refresh MCP servers: ${error}`)
				vscode.window.showErrorMessage("Failed to refresh MCP servers")
			}
			break
		}

		case "updateMcpTimeout": {
			if (message.serverName && typeof message.timeout === "number") {
				try {
					await provider.getMcpHub()?.updateServerTimeout(
						message.serverName,
						message.timeout,
						message.source as "global" | "project",
					)
				} catch (error) {
					provider.log(`Failed to update timeout for ${message.serverName}: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.update_server_timeout"))
				}
			}
			break
		}

		case "toggleToolAlwaysAllow": {
		if (message.serverName && message.toolName && message.alwaysAllow !== undefined) {
			try {
				await provider.getMcpHub()?.toggleToolAlwaysAllow(
					message.serverName,
					message.source as "global" | "project",
					message.toolName,
					message.alwaysAllow,
				)
				await provider.postStateToWebview()
			} catch (error) {
				provider.log(`Failed to toggle always allow for tool ${message.toolName}: ${error}`)
				vscode.window.showErrorMessage(`Failed to toggle always allow for tool: ${message.toolName}`)
			}
		}
		break
	}

	case "toggleToolEnabledForPrompt": {
		if (message.serverName && message.toolName && message.isEnabled !== undefined) {
			try {
				await provider.getMcpHub()?.toggleToolEnabledForPrompt(
					message.serverName,
					message.source as "global" | "project",
					message.toolName,
					message.isEnabled,
				)
				await provider.postStateToWebview()
			} catch (error) {
				provider.log(`Failed to toggle tool enabled for prompt ${message.toolName}: ${error}`)
				vscode.window.showErrorMessage(`Failed to toggle tool enabled state: ${message.toolName}`)
			}
		}
		break
	}

	case "openMcpSettings": {
			try {
				const settingsDir = await provider.ensureSettingsDirectoryExists()
				const mcpSettingsPath = path.join(settingsDir, GlobalFileNames.mcpSettings)
				const fileExists = await fs.stat(mcpSettingsPath).catch(() => null)
				if (!fileExists) {
					await fs.writeFile(
						mcpSettingsPath,
						`{\n  "mcpServers": {\n\n  }\n}`,
						"utf-8",
					)
				}
				await openFile(mcpSettingsPath)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error opening MCP settings: ${errorMessage}`)
				vscode.window.showErrorMessage(`Failed to open MCP settings: ${errorMessage}`)
			}
			break
		}

		case "openProjectMcpSettings": {
			await openFile("./.roo/mcp.json", {
				create: true,
				content: JSON.stringify({ mcpServers: {} }, null, 2),
			})
			break
		}
	}
}