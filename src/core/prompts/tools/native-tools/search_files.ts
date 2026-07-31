import type OpenAI from "openai"

const SEARCH_FILES_DESCRIPTION = `Perform a regex search across files in a specified directory, returning matches with surrounding context.

Parameters:
- path: (required) Directory to search (relative to workspace), recursively
- regex: (required) Regex pattern (Rust syntax)
- file_pattern: (optional) Glob filter (e.g., '*.ts'), defaults to all (*)

Guidelines:
- Craft regex carefully to balance specificity and flexibility
- Use for code patterns, TODO comments, function definitions, etc.
- Analyze surrounding context to interpret matches; combine with other tools

Examples:
{ "path": ".", "regex": ".*", "file_pattern": "*.ts" }
{ "path": "src", "regex": "function\\s+\\w+", "file_pattern": "*.js" }`

const PATH_PARAMETER_DESCRIPTION = `Directory to search recursively, relative to the workspace`

const REGEX_PARAMETER_DESCRIPTION = `Rust-compatible regular expression pattern to match`

const FILE_PATTERN_PARAMETER_DESCRIPTION = `Optional glob to limit which files are searched (e.g., *.ts)`

export default {
	type: "function",
	function: {
		name: "search_files",
		description: SEARCH_FILES_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				regex: {
					type: "string",
					description: REGEX_PARAMETER_DESCRIPTION,
				},
				file_pattern: {
					type: ["string", "null"],
					description: FILE_PATTERN_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path", "regex", "file_pattern"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
