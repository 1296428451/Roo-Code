import type { QueuedMessage } from "./message.js"
import type { CheckpointDiffPayload, CheckpointRestorePayload } from "./checkpoint.js"

export interface UpdateTodoListPayload {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	todos: any[]
}

export type EditQueuedMessagePayload = Pick<QueuedMessage, "id" | "text" | "images">

export interface IndexingStatusPayload {
	state: "Standby" | "Indexing" | "Indexed" | "Error" | "Stopping"
	message: string
}

export interface IndexClearedPayload {
	success: boolean
	error?: string
}

export type WebViewMessagePayload =
	| CheckpointDiffPayload
	| CheckpointRestorePayload
	| IndexingStatusPayload
	| IndexClearedPayload
	| UpdateTodoListPayload
	| EditQueuedMessagePayload

export interface IndexingStatus {
	systemStatus: string
	message?: string
	processedItems: number
	totalItems: number
	currentItemUnit?: string
	workspacePath?: string
	workspaceEnabled?: boolean
	autoEnableDefault?: boolean
	indexWorkspacePath?: string
}

export interface IndexingStatusUpdateMessage {
	type: "indexingStatusUpdate"
	values: IndexingStatus
}
