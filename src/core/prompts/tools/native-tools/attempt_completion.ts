import type OpenAI from "openai"

const ATTEMPT_COMPLETION_DESCRIPTION = `Tool for submitting the final response to the user. Must be called at the end of every conversation turn, regardless of dialogue type, to deliver the response.

Parameter result: The complete content of this turn's response.`

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
