import type OpenAI from "openai"

const UPDATE_TODO_LIST_DESCRIPTION = `Replace the entire TODO list with an updated checklist reflecting the current state. Always provide the full list; the system will overwrite the previous one.

Checklist Format:
- Single-level markdown checklist (no nesting), in execution order
- Status: [ ] pending, [x] completed, [-] in progress

Rules:
- Confirm completed items before updating
- Support multiple status updates at once
- Dynamically add new todos as discovered
- Only mark [x] when fully accomplished
- Keep unfinished tasks unless explicitly told to remove

Examples:
{ "todos": "[x] Analyze requirements\\n[x] Design architecture\\n[-] Implement core logic\\n[ ] Write tests\\n[ ] Update documentation" }
{ "todos": "[x] Analyze requirements\\n[x] Design architecture\\n[x] Implement core logic\\n[-] Write tests\\n[ ] Update documentation\\n[ ] Add performance benchmarks" }

Use when: multi-step tasks, batch status updates, new todos discovered during execution, complex tasks requiring stepwise tracking.
Do NOT use when: single or two-step simple tasks, purely conversational or informational requests.`

const TODOS_PARAMETER_DESCRIPTION = `Full markdown checklist in execution order, using [ ] for pending, [x] for completed, and [-] for in progress`

export default {
	type: "function",
	function: {
		name: "update_todo_list",
		description: UPDATE_TODO_LIST_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				todos: {
					type: "string",
					description: TODOS_PARAMETER_DESCRIPTION,
				},
			},
			required: ["todos"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
