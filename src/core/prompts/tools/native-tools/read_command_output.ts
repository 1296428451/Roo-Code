import type OpenAI from "openai"

/**
 * Native tool definition for read_command_output.
 *
 * This tool allows the LLM to retrieve full command output that was truncated
 * during execute_command. When command output exceeds the preview threshold,
 * the full output is persisted to disk and an artifact_id is provided. The
 * LLM can then use this tool to read the full content or search within it.
 */

const READ_COMMAND_OUTPUT_DESCRIPTION = `Retrieve the full output from a command that was truncated in execute_command. Use when:
- Output shows truncation and is saved to an artifact
- Need more output beyond the preview
- Need to search for specific content in large output

Two modes:
- Read: Read output starting from a byte offset with optional limit
- Search: Filter lines matching regex or literal pattern (like grep), case-insensitive

Parameters:
- artifact_id: (required) The artifact filename
- search: (optional) Pattern to filter lines. **Omit entirely if not needed - do not pass null or empty string.**
- offset: (optional) Byte offset to start reading from. Default: 0. For pagination.
- limit: (optional) Maximum bytes to return. Default: 40KB.

Examples:
{ "artifact_id": "cmd-1706119234567.txt" }
{ "artifact_id": "cmd-1706119234567.txt", "offset": 40960 }
{ "artifact_id": "cmd-1706119234567.txt", "search": "error|failed|Error" }
{ "artifact_id": "cmd-1706119234567.txt", "search": "FAIL" }`

const ARTIFACT_ID_DESCRIPTION = `The artifact filename from the truncated command output (e.g., "cmd-1706119234567.txt")`

const SEARCH_DESCRIPTION = `Optional regex or literal pattern to filter lines (case-insensitive, like grep). Omit this parameter if not searching - do not pass null or empty string.`

const OFFSET_DESCRIPTION = `Byte offset to start reading from (default: 0, for pagination)`

const LIMIT_DESCRIPTION = `Maximum bytes to return (default: 40KB)`

export default {
	type: "function",
	function: {
		name: "read_command_output",
		description: READ_COMMAND_OUTPUT_DESCRIPTION,
		// Note: strict mode is intentionally disabled for this tool.
		// With strict: true, OpenAI requires ALL properties to be in the 'required' array,
		// which forces the LLM to always provide explicit values (even null) for optional params.
		// This creates verbose tool calls and poor UX. By disabling strict mode, the LLM can
		// omit optional parameters entirely, making the tool easier to use.
		parameters: {
			type: "object",
			properties: {
				artifact_id: {
					type: "string",
					description: ARTIFACT_ID_DESCRIPTION,
				},
				search: {
					type: "string",
					description: SEARCH_DESCRIPTION,
				},
				offset: {
					type: "number",
					description: OFFSET_DESCRIPTION,
				},
				limit: {
					type: "number",
					description: LIMIT_DESCRIPTION,
				},
			},
			required: ["artifact_id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
