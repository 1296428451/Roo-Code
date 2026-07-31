import type OpenAI from "openai"

const LIST_FILES_DESCRIPTION = `Request to list files and directories in the specified directory. If recursive is true, list all recursively; if false or not provided, list only top-level contents. Do not use this tool to confirm existence of files you created; the user will inform you.

Parameters:
- path: (required) Directory path (relative to current workspace)
- recursive: (required) true for recursive listing, false for top-level only

Examples:
{ "path": ".", "recursive": false }
{ "path": "src", "recursive": true }`

const PATH_PARAMETER_DESCRIPTION = `Directory path to inspect, relative to the workspace`

const RECURSIVE_PARAMETER_DESCRIPTION = `Set true to list contents recursively; false to show only the top level`

export default {
	type: "function",
	function: {
		name: "list_files",
		description: LIST_FILES_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				recursive: {
					type: "boolean",
					description: RECURSIVE_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path", "recursive"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
