import * as vscode from "vscode"

import type { ClineApiReqInfo } from "@roo-code/types"

import { Task } from "../task/Task"

import { t } from "../../i18n"

import { getApiMetrics } from "../../shared/getApiMetrics"

import { DIFF_VIEW_URI_SCHEME } from "../../integrations/editor/DiffViewProvider"

import type { DiffChange } from "../../services/checkpoints"

// File snapshot system replaces git-based shadow checkpoints.
// The legacy git checkpoint service (RepoPerTaskCheckpointService / ShadowCheckpointService)
// is no longer initialized. File snapshots are managed by FileSnapshotService.

export async function getCheckpointService(task: Task, _opts?: { interval?: number }) {
	// Always return undefined — git checkpoints are disabled.
	// File snapshots are handled by Task.saveFileSnapshot / Task.restoreFileSnapshot.
	task.enableCheckpoints = false
	return undefined
}

export async function checkpointSave(task: Task, _force = false, _suppressMessage = false) {
	// File snapshot mode: checkpoints are created by write tools via saveFileSnapshot.
	// This function is kept for API compatibility but does nothing.
	return
}

export type CheckpointRestoreOptions = {
	ts: number
	commitHash: string
	mode: "preview" | "restore"
	operation?: "delete" | "edit"
}

export async function checkpointRestore(
	task: Task,
	{ ts, commitHash, mode, operation = "delete" }: CheckpointRestoreOptions,
) {
	// In file snapshot mode, file content restore is handled by restoreFileSnapshot.
	// This function handles the message history rewind and task cancellation.
	const index = task.clineMessages.findIndex((m) => m.ts === ts)

	if (index === -1) {
		vscode.window.showErrorMessage(t("common:errors.checkpoint_message_not_found"))
		return
	}

	const provider = task.providerRef.deref()

	try {
		await provider?.postMessageToWebview({ type: "currentCheckpointUpdated", text: commitHash })

		if (mode === "restore") {
			// Calculate metrics from messages that will be deleted (must be done before rewind)
			const deletedMessages = task.clineMessages.slice(index + 1)

			const { totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost } = getApiMetrics(
				task.combineMessages(deletedMessages),
			)

			// Use MessageManager to properly handle context-management events
			await task.messageManager.rewindToTimestamp(ts, {
				includeTargetMessage: operation === "edit",
			})

			// Report the deleted API request metrics
			await task.say(
				"api_req_deleted",
				JSON.stringify({
					tokensIn: totalTokensIn,
					tokensOut: totalTokensOut,
					cacheWrites: totalCacheWrites,
					cacheReads: totalCacheReads,
					cost: totalCost,
				} satisfies ClineApiReqInfo),
			)
		}

		// Cancel and re-init the task to get updated messages.
		provider?.cancelTask()
	} catch (err) {
		provider?.log("[checkpointRestore] error during restore")
		task.enableCheckpoints = false
		vscode.window.showErrorMessage(t("common:errors.checkpoint_failed"))
	}
}

export type CheckpointDiffOptions = {
	ts?: number
	previousCommitHash?: string
	commitHash: string
	/**
	 * from-init: Compare from the first checkpoint to the selected checkpoint.
	 * checkpoint: Compare the selected checkpoint to the next checkpoint.
	 * to-current: Compare the selected checkpoint to the current workspace.
	 * full: Compare from the first checkpoint to the current workspace.
	 */
	mode: "from-init" | "checkpoint" | "to-current" | "full"
}

export async function checkpointDiff(task: Task, { ts, previousCommitHash, commitHash, mode }: CheckpointDiffOptions) {
	const snapshots = task.getFileSnapshots()

	if (snapshots.length === 0) {
		vscode.window.showInformationMessage(t("common:errors.checkpoint_no_first"))
		return
	}

	// Map checkpoint hash (= snapshot ID) to snapshot index
	const snapshotIds = snapshots.map(s => s.id)

	// For "from-init" and "full", we need at least one snapshot
	if (["from-init", "full"].includes(mode) && snapshots.length < 1) {
		vscode.window.showInformationMessage(t("common:errors.checkpoint_no_first"))
		return
	}

	let fromId: string | undefined
	let toId: string | undefined
	let title: string

	const idx = snapshotIds.indexOf(commitHash)

	switch (mode) {
		case "checkpoint":
			// Diff between this checkpoint and the next one
			fromId = commitHash
			toId = idx !== -1 && idx < snapshotIds.length - 1 ? snapshotIds[idx + 1] : undefined
			title = t("common:errors.checkpoint_diff_with_next")
			break
		case "from-init":
			// Diff from first checkpoint to this checkpoint
			fromId = snapshots[0]?.id
			toId = commitHash
			title = t("common:errors.checkpoint_diff_since_first")
			break
		case "to-current":
			// Diff from this checkpoint to current workspace state
			fromId = commitHash
			toId = undefined  // undefined = current workspace
			title = t("common:errors.checkpoint_diff_to_current")
			break
		case "full":
			// Diff from first checkpoint to current workspace state
			fromId = snapshots[0]?.id
			toId = undefined
			title = t("common:errors.checkpoint_diff_since_first")
			break
	}

	if (!fromId) {
		vscode.window.showInformationMessage(t("common:errors.checkpoint_no_previous"))
		return
	}

	try {
		// Get diff from FileSnapshotService
		const changes = await task.getSnapshotDiff(fromId, toId)

		if (!changes?.length) {
			vscode.window.showInformationMessage(t("common:errors.checkpoint_no_changes"))
			return
		}

		// Show diff in VS Code's changes view
		await vscode.commands.executeCommand(
			"vscode.changes",
			title,
			changes.map((change: DiffChange) => [
				vscode.Uri.file(change.paths.absolute),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
					query: Buffer.from(change.before ?? "").toString("base64"),
				}),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
					query: Buffer.from(change.after ?? "").toString("base64"),
				}),
			]),
		)
	} catch (err) {
		const provider = task.providerRef.deref()
		provider?.log(`[checkpointDiff] error: ${err instanceof Error ? err.message : String(err)}`)
		vscode.window.showErrorMessage(
			`Failed to compute diff: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
}
