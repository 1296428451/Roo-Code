import * as vscode from "vscode"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { ClineProvider } from "../ClineProvider"
import { t } from "../../../i18n"
import { openFile } from "../../../integrations/misc/open-file"
import { getCommand, getCommands } from "../../../services/command/commands"
import type { WebviewMessage } from "@roo-code/types"

export const handleCommandOperations = async (ctx: import("../webviewMessageHandler").HandlerContext, message: WebviewMessage): Promise<void> => {
	const { provider } = ctx
	const { getCurrentCwd } = ctx

	switch (message.type) {
		case "requestCommands": {
			try {
				const commands = await getCommands(getCurrentCwd() || "")
				const commandList = commands.map((command) => ({
					name: command.name,
					source: command.source,
					filePath: command.filePath,
					description: command.description,
					argumentHint: command.argumentHint,
				}))
				await provider.postMessageToWebview({ type: "commands", commands: commandList })
			} catch (error) {
				provider.log(`Error fetching commands: ${error}`)
				await provider.postMessageToWebview({ type: "commands", commands: [] })
			}
			break
		}

		case "openCommandFile": {
			try {
				if (message.text) {
					const commandName = message.text
					const command = await getCommand(getCurrentCwd() || "", commandName)

					if (command && command.filePath) {
						openFile(command.filePath)
					} else {
						vscode.window.showErrorMessage(t("common:errors.command_not_found", { name: commandName }))
					}
				}
			} catch (error) {
				provider.log(`Error opening command file: ${error}`)
				vscode.window.showErrorMessage(t("common:errors.open_command_file"))
			}
			break
		}

		case "deleteCommand": {
			try {
				if (message.text && message.values?.source) {
					const commandName = message.text
					const command = await getCommand(getCurrentCwd() || "", commandName)

					if (command && command.filePath) {
						await fs.unlink(command.filePath)
						provider.log(`Deleted command file: ${command.filePath}`)
					} else {
						vscode.window.showErrorMessage(t("common:errors.command_not_found", { name: commandName }))
					}
				}
			} catch (error) {
				provider.log(`Error deleting command: ${error}`)
				vscode.window.showErrorMessage(t("common:errors.delete_command"))
			}
			break
		}

		case "createCommand": {
			try {
				const source = message.values?.source as "global" | "project"
				const fileName = message.text

				if (!source) {
					provider.log("Missing source for createCommand")
					break
				}

				let commandsDir: string
				if (source === "global") {
					const globalConfigDir = path.join(os.homedir(), ".roo")
					commandsDir = path.join(globalConfigDir, "commands")
				} else {
					if (!vscode.workspace.workspaceFolders?.length) {
						vscode.window.showErrorMessage(t("common:errors.no_workspace"))
						return
					}
					const workspaceRoot = getCurrentCwd()
					if (!workspaceRoot) {
						vscode.window.showErrorMessage(t("common:errors.no_workspace_for_project_command"))
						break
					}
					commandsDir = path.join(workspaceRoot, ".roo", "commands")
				}

				await fs.mkdir(commandsDir, { recursive: true })

				let commandName: string
				if (fileName && fileName.trim()) {
					let cleanFileName = fileName.trim()
					if (cleanFileName.startsWith("/")) {
						cleanFileName = cleanFileName.substring(1)
					}
					if (cleanFileName.toLowerCase().endsWith(".md")) {
						cleanFileName = cleanFileName.slice(0, -3)
					}
					commandName = cleanFileName
						.toLowerCase()
						.replace(/\s+/g, "-")
						.replace(/[^a-z0-9-]/g, "")
						.replace(/-+/g, "-")
						.replace(/^-|-$/g, "")

					if (!commandName || commandName.length === 0) {
						commandName = "new-command"
					}
				} else {
					commandName = "new-command"
					let counter = 1
					let filePath = path.join(commandsDir, `${commandName}.md`)

					while (
						await fs
							.access(filePath)
							.then(() => true)
							.catch(() => false)
					) {
						commandName = `new-command-${counter}`
						filePath = path.join(commandsDir, `${commandName}.md`)
						counter++
					}
				}

				const filePath = path.join(commandsDir, `${commandName}.md`)

				if (
					await fs
						.access(filePath)
						.then(() => true)
						.catch(() => false)
				) {
					vscode.window.showErrorMessage(t("common:errors.command_already_exists", { commandName }))
					break
				}

				const templateContent = t("common:errors.command_template_content")
				await fs.writeFile(filePath, templateContent, "utf8")
				provider.log(`Created new command file: ${filePath}`)

				openFile(filePath)

				const commands = await getCommands(getCurrentCwd() || "")
				const commandList = commands.map((command) => ({
					name: command.name,
					source: command.source,
					filePath: command.filePath,
					description: command.description,
					argumentHint: command.argumentHint,
				}))
				await provider.postMessageToWebview({
					type: "commands",
					commands: commandList,
				})
			} catch (error) {
				provider.log(`Error creating command: ${error}`)
				vscode.window.showErrorMessage(t("common:errors.create_command_failed"))
			}
			break
		}
	}
}