import type OpenAI from "openai"

const ATTEMPT_COMPLETION_DESCRIPTION = `Tool for submitting the final task result to the user.
Use when: All tasks are fully completed and the result is ready for delivery.
Core purposes:
Task completion signal: After completing the task, present the final output to the user via this tool. This is the only way to deliver results.
Delegation return mechanism: After a sub-agent completes its task, return control and results to the parent agent via this tool.
Feedback iteration gateway: If satisfied, task ends. If not, feedback is returned as tool_result and the model continues improving.
Important: DO NOT use before task completion. MUST use immediately upon completion.
Parameters:
result: Required. Final outcome in definitive form. Do not end with questions.`

const RESULT_PARAMETER_DESCRIPTION = `Final result message to deliver to the user once the task is complete`

export default {
	type: "function",
	function: {
		name: "attempt_completion",
		description: ATTEMPT_COMPLETION_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				result: {
					type: "string",
					description: RESULT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["result"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
