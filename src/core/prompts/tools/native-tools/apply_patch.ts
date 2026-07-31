import type OpenAI from "openai"

const apply_patch_DESCRIPTION = `Apply patches to files using a file-oriented diff format. Supports creating, deleting, and updating files.

Format:
*** Begin Patch
[ one or more file sections ]
*** End Patch

File section headers:
- *** Add File: <path> - Create new file; subsequent lines start with + (initial contents)
- *** Delete File: <path> - Remove existing file; nothing follows
- *** Update File: <path> - Patch existing file in place

Update File options:
- May be followed by *** Move to: <new path> to rename
- Then one or more hunks, each introduced by @@ (optionally with class/function name)
- Within each hunk, lines start with:
  - ' ' (space) for context (unchanged)
  - '-' for lines to remove
  - '+' for lines to add

Context rules:
- Show 3 lines of context above and below each change
- Use @@ with class/function name if 3 lines are insufficient to uniquely identify the location
- Multiple @@ statements for deeply nested code

Example:
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch`

const apply_patch = {
	type: "function",
	function: {
		name: "apply_patch",
		description: apply_patch_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				patch: {
					type: "string",
					description:
						"The complete patch text in the apply_patch format, starting with '*** Begin Patch' and ending with '*** End Patch'.",
				},
			},
			required: ["patch"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

export default apply_patch
