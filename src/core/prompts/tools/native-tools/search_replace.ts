import type OpenAI from "openai"

const SEARCH_REPLACE_DESCRIPTION = `Perform a search and replace operation on an existing file, replacing ONE occurrence of old_string with new_string.

Requirements:
- Uniqueness: old_string must uniquely identify the target instance. Include at least 3-5 lines of context before and after the change point, preserving all whitespace, indentation, and surrounding code exactly as in the file.
- Single instance: One change per call. For multiple instances, make separate calls with sufficient context to uniquely identify each.
- Verification: Before use, ensure each instance can be uniquely identified and plan separate calls accordingly.`

const search_replace = {
	type: "function",
	function: {
		name: "search_replace",
		description: SEARCH_REPLACE_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				file_path: {
					type: "string",
					description:
						"The path to the file you want to search and replace in. You can use either a relative path in the workspace or an absolute path. If an absolute path is provided, it will be preserved as is.",
				},
				old_string: {
					type: "string",
					description:
						"The text to replace (must be unique within the file, and must match the file contents exactly, including all whitespace and indentation)",
				},
				new_string: {
					type: "string",
					description: "The edited text to replace the old_string (must be different from the old_string)",
				},
			},
			required: ["file_path", "old_string", "new_string"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

export default search_replace
