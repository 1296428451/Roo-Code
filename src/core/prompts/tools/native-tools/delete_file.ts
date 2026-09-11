import type OpenAI from "openai"

const DELETE_FILE_DESCRIPTION = `Delete exactly one file from the workspace. The user must approve the operation. Do not use this tool for directories; use a file path only.

USAGE:

Delete a single file by providing its path. You can use either a relative path in the workspace or an absolute path.

REQUIREMENTS:

1. PATH FORMAT: Provide a file path relative to the workspace or an absolute path

2. FILE ONLY: This tool only works for files, not directories

3. USER APPROVAL: The deletion requires user confirmation

EXAMPLES:
1.
{
  "path": "src/components/OldComponent.tsx"
}
2.
{
  "path": "/home/user/project/src/utils/helper.ts"
}

IMPORTANT:
- Double-check the file path before calling this tool
- Ensure you really want to delete the file (operation is destructive)
- Do not use this for bulk deletions (one file at a time only)`

/** Native tool definition for safely deleting one workspace file. */
const deleteFile = {
	type: "function",
	function: {
		name: "delete_file",
		description: DELETE_FILE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Path to the file to delete, relative to the workspace or absolute path. If an absolute path is provided, it will be preserved as is.",
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

export default deleteFile
