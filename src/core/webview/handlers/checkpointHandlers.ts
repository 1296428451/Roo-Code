import type { WebviewMessage } from "@roo-code/types"
import type { HandlerContext } from "./context"
import { checkpointDiff } from "../../checkpoints"

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

				// File snapshot system: commitHash is actually a snapshotId
				const snapshots = currentTask.getFileSnapshots()
				const snapshot = snapshots.find(s => s.id === commitHash || s.meta.timestamp === ts)

				if (snapshot) {
					// 1. Restore file contents from snapshot
					await currentTask.restoreFileSnapshot(snapshot.id)
					// 2. Rewind message history + cancel task (same as legacy checkpoint restore)
					await currentTask.checkpointRestore({ ts, commitHash, mode })
				} else {
					// Legacy git checkpoint fallback (disabled, will no-op)
					await currentTask.checkpointRestore({ ts, commitHash, mode })
				}
			}
			break
		}

		case "checkpointDiff": {
			const currentTask = provider.getCurrentTask()
			if (currentTask && message.payload) {
				const { ts, previousCommitHash, commitHash, mode } = message.payload as {
					ts: number
					previousCommitHash?: string
					commitHash: string
					mode: "from-init" | "checkpoint" | "to-current" | "full"
				}

				// File snapshot diff: compute changes between snapshot states
				await checkpointDiff(currentTask, { ts, previousCommitHash, commitHash, mode })
			}
			break
		}
	}
}
