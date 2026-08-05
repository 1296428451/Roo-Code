import * as path from "path"
import { ClineProvider } from "../ClineProvider"
import { getRooDirectoriesForCwd } from "../../../services/roo-config"
import { searchWorkspaceFiles } from "../../../services/search/file-search"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { customToolRegistry } from "@roo-code/core"

export interface HandlerContext {
	provider: ClineProvider
	getGlobalState: <K extends keyof import("@roo-code/types").GlobalState>(key: K) => import("@roo-code/types").GlobalState[K]
	updateGlobalState: <K extends keyof import("@roo-code/types").GlobalState>(key: K, value: import("@roo-code/types").GlobalState[K]) => Promise<void>
	getCurrentCwd: () => string | undefined
	getCurrentMode: () => Promise<string>
}

export const handleSearchOperations = async (ctx: HandlerContext, message: any): Promise<void> => {
	const { provider, getCurrentCwd } = ctx

	switch (message.type) {
		case "searchFiles": {
			const workspacePath = getCurrentCwd()

			if (!workspacePath) {
				await provider.postMessageToWebview({
					type: "fileSearchResults",
					results: [],
					requestId: message.requestId,
					error: "No workspace path available",
				})
				break
			}

			try {
				const results = await searchWorkspaceFiles(message.query || "", workspacePath, 20)

				const currentTask = provider.getCurrentTask()
				let rooIgnoreController = currentTask?.rooIgnoreController
				let tempController: RooIgnoreController | undefined

				if (!rooIgnoreController) {
					tempController = new RooIgnoreController(workspacePath)
					await tempController.initialize()
					rooIgnoreController = tempController
				}

				const resultPaths = results.map((r) => r.path)
				const allowedPaths = new Set(rooIgnoreController!.filterPaths(resultPaths))
				const filteredResults = results.filter((result) => {
					if (!allowedPaths.has(result.path)) {
						return false
					}
					const absolutePath = path.join(workspacePath, result.path)
					if (isPathOutsideWorkspace(absolutePath)) {
						return false
					}
					return true
				})

				if (tempController) {
					await tempController.dispose()
				}

				await provider.postMessageToWebview({
					type: "fileSearchResults",
					results: filteredResults,
					requestId: message.requestId,
				})
			} catch (error) {
				provider.log(`Error searching files: ${error}`)
				await provider.postMessageToWebview({
					type: "fileSearchResults",
					results: [],
					requestId: message.requestId,
					error: String(error),
				})
			}
			break
		}

		case "refreshCustomTools": {
			try {
				const cwd = getCurrentCwd()
				if (!cwd) {
					await provider.postMessageToWebview({
						type: "customToolsResult",
						tools: [],
						error: "No workspace path available",
					})
					break
				}
				const toolDirs = getRooDirectoriesForCwd(cwd).map((dir: string) => path.join(dir, "tools"))
				await customToolRegistry.loadFromDirectories(toolDirs)

				await provider.postMessageToWebview({
					type: "customToolsResult",
					tools: customToolRegistry.getAllSerialized(),
				})
			} catch (error) {
				await provider.postMessageToWebview({
					type: "customToolsResult",
					tools: [],
					error: error instanceof Error ? error.message : String(error),
				})
			}
			break
		}
	}
}