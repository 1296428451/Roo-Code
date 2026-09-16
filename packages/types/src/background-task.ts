import type { HistoryItem } from "./history.js"

/**
 * A task that is still running (or has finished) in the background while the
 * user has navigated away to a different session. `status` reflects whether the
 * agent loop is still active.
 */
export interface BackgroundTaskItem {
	taskId: string
	task?: HistoryItem
	status: "running" | "needsConfirmation" | "completed" | "aborted"
}
