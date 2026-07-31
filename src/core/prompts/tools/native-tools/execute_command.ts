import type OpenAI from "openai"

const EXECUTE_COMMAND_DESCRIPTION = `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to complete any step in the user's task. Tailor the command to the user's system. Use appropriate chaining syntax for the user's shell. Prefer complex CLI commands over scripts. Prefer relative paths for terminal consistency.

Parameters:
- command: (required) The CLI command to execute. Must be valid for the current OS, properly formatted, and contain no harmful instructions.
- cwd: (optional) The working directory to execute the command in.
- timeout: (optional) Timeout in seconds. After timeout, the command continues running in the background and you receive the output so far. Use this for commands that may run indefinitely (e.g., dev servers) to avoid waiting for them to exit.

Examples:
{ "command": "npm run dev", "cwd": null, "timeout": null }
{ "command": "ls -la", "cwd": "/home/user/projects", "timeout": null }
{ "command": "npm run build", "cwd": null, "timeout": 30 }`

const COMMAND_PARAMETER_DESCRIPTION = `Shell command to execute`

const CWD_PARAMETER_DESCRIPTION = `Optional working directory for the command, relative or absolute`

const TIMEOUT_PARAMETER_DESCRIPTION = `Timeout in seconds. When exceeded, the command continues running in the background and output collected so far is returned. Use this for long-running processes like dev servers, file watchers, or any command that may not exit on its own`

export default {
	type: "function",
	function: {
		name: "execute_command",
		description: EXECUTE_COMMAND_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: COMMAND_PARAMETER_DESCRIPTION,
				},
				cwd: {
					type: ["string", "null"],
					description: CWD_PARAMETER_DESCRIPTION,
				},
				timeout: {
					type: ["number", "null"],
					description: TIMEOUT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["command", "cwd", "timeout"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
