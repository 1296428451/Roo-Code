import type { WebviewMessage } from "@roo-code/types"
import type { HandlerContext } from "./context"

export async function handleCheckpointOperations(ctx: HandlerContext, message: WebviewMessage): Promise<void> {
	const { provider } = ctx

	switch (message.type) {
		case "checkpointRestore": {
			const currentTask = provider.getCurrentTask()
			if (currentTask && message.payload) {
				const { ts, commitHash, mode } = message.payload as {
					ts: number
					commitHash: string
					mode: "preview" | "restore"
				}
				await currentTask.checkpointRestore({ ts, commitHash, mode })
			}
			break
		}

		case "checkpointDiff": {
			const currentTask = provider.getCurrentTask()
			if (currentTask && message.payload) {
				const { ts, previousCommitHash, commitHash, mode } = message.payload as {
					ts?: number
					previousCommitHash?: string
					commitHash: string
					mode: "from-init" | "checkpoint" | "to-current" | "full"
				}
				await currentTask.checkpointDiff({ ts, previousCommitHash, commitHash, mode })
			}
			break
		}
	}
}