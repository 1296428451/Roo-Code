import path from "path"
import * as fs from "fs/promises"

import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { getReadablePath } from "../../utils/path"
import { formatResponse } from "../prompts/responses"

interface DeleteFileParams {
	path: string
}

export class DeleteFileTool extends BaseTool<"delete_file"> {
	readonly name = "delete_file" as const

	async execute(params: DeleteFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const relativePath = typeof params.path === "string" ? params.path.trim() : ""
		if (!relativePath) {
			task.consecutiveMistakeCount++
			task.recordToolError("delete_file")
			pushToolResult(`Error: ${await task.sayAndCreateMissingParamError("delete_file", "path")}`)
			return
		}

		if (!task.rooIgnoreController?.validateAccess(relativePath)) {
			await task.say("rooignore_error", relativePath)
			pushToolResult(`Error: ${formatResponse.rooIgnoreError(relativePath)}`)
			return
		}

		const absolutePath = path.resolve(task.cwd, relativePath)
		if (isPathOutsideWorkspace(absolutePath)) {
			pushToolResult(`Error: Cannot delete '${relativePath}' because it is outside the workspace.`)
			return
		}

		try {
			const stats = await fs.stat(absolutePath)
			if (stats.isDirectory()) {
				pushToolResult(`Error: Cannot delete '${relativePath}' because it is a directory.`)
				return
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				pushToolResult(`Error: File '${relativePath}' does not exist.`)
				return
			}
			await handleError("deleting file", error as Error)
			return
		}

		const approved = await askApproval(
			"tool",
			JSON.stringify({
				tool: "deleteFile",
				path: getReadablePath(task.cwd, relativePath),
				isOutsideWorkspace: false,
			}),
		)
		if (!approved) {
			pushToolResult("File deletion was rejected by the user.")
			return
		}

		try {
			const movedToTrash = await task.moveDeletedFileToTrash(relativePath)
			if (!movedToTrash) {
				pushToolResult(`Error: Failed to delete '${relativePath}'.`)
				return
			}
			pushToolResult(`Deleted '${relativePath}'. The file was moved to task trash and can be restored.`)
		} catch (error) {
			await handleError("deleting file", error as Error)
		}
	}
}

export const deleteFileTool = new DeleteFileTool()
