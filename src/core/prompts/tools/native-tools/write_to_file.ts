import type OpenAI from "openai"

const WRITE_TO_FILE_DESCRIPTION = `Write content to a file. Used for creating new files or intentionally overwriting existing ones. Overwrites if exists, creates if not. Automatically creates required directories.

Prefer other editing tools for modifying existing files—write_to_file is slower and cannot handle large files. Use primarily for new file creation.
Write content directly—no need to display it beforehand. Must provide COMPLETE file content (partial updates or placeholders are forbidden).
When creating a new project, place all files in a dedicated project directory unless specified, and structure according to best practices.
Example:
{ "path": "frontend-config.json", "content": "{\\n  \\"apiEndpoint\\": \\"https://api.example.com\\",\\n  \\"theme\\": {\\n    \\"primaryColor\\": \\"#007bff\\"\\n  }\\n}" }`

const PATH_PARAMETER_DESCRIPTION = `The path of the file to write to (relative to the current workspace directory)`

const CONTENT_PARAMETER_DESCRIPTION = `The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified. Do NOT include line numbers in the content.`

export default {
	type: "function",
	function: {
		name: "write_to_file",
		description: WRITE_TO_FILE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				content: {
					type: "string",
					description: CONTENT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
