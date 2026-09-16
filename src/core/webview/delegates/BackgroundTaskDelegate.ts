import { RooCodeEventName } from "@roo-code/types"
import type { BackgroundTaskItem } from "@roo-code/types"

import type { Task } from "../../task/Task"
import type { ClineProvider } from "../ClineProvider"

interface BackgroundTaskEntry {
	task: Task
	status: BackgroundTaskItem["status"]
	listeners: Array<() => void>
}

/**
 * Owns every task that keeps running in the background while the user works in a
 * different session (multi-agent parallel execution). `ClineProvider` delegates
 * all background/multi-agent logic here so it stays a thin façade whose public
 * surface is unchanged.
 */
export class BackgroundTaskDelegate {
	/** Tasks that continue running while the user has navigated away to a different session. */
	private readonly backgroundTasks: Map<string, BackgroundTaskEntry> = new Map()

	constructor(private readonly provider: ClineProvider) {}

	/**
	 * Wrap the provider in a proxy that drops every view-updating post so a
	 * backgrounded task can keep running (its loop, tools, disk writes all still
	 * work) without corrupting the active session's webview state.
	 */
	private createSilentProvider(): ClineProvider {
		const silent = new Set([
			"postMessageToWebview",
			"postStateToWebview",
			"postStateToWebviewWithoutTaskHistory",
			"postStateToWebviewWithoutClineMessages",
		])
		const handler: ProxyHandler<ClineProvider> = {
			get: (target, prop) => {
				if (typeof prop === "string" && silent.has(prop)) {
					return () => {}
				}
				const value = (target as any)[prop]
				if (typeof value === "function") {
					return value.bind(target)
				}
				return value
			},
		}
		return new Proxy(this.provider, handler) as ClineProvider
	}

	/**
	 * Move the currently active (foreground) task into the background. It keeps
	 * running autonomously; the webview returns to the home screen so a new
	 * session can be started independently.
	 */
	public async backgroundActiveTask(): Promise<void> {
		const task = this.provider.getCurrentTask()
		if (!task) {
			return
		}

		// Detach the default TaskStackDelegate completion listeners so they don't
		// pop an unrelated task from the stack when this one finishes.
		const listeners = this.provider.taskEventListeners.get(task)
		if (listeners) {
			for (const remove of listeners) {
				remove()
			}
			this.provider.taskEventListeners.delete(task)
		}

		// Remove from the foreground stack WITHOUT tearing the task down.
		const idx = this.provider.clineStack.indexOf(task)
		if (idx !== -1) {
			this.provider.clineStack.splice(idx, 1)
		}

		// Silence its view posts and register background lifecycle listeners.
		task.providerRef = new WeakRef(this.createSilentProvider())

		// A backgrounded task that blocks on a user decision (tool/command/MCP
		// approval, resume, retry, etc.) should surface as "needsConfirmation"
		// rather than keep spinning as "running" — the user must come back and
		// click approve/deny. Only the final completion acceptance is treated as
		// "completed"; everything else that waits on the user is a pending
		// confirmation. When the ask is resolved the task emits TaskActive and we
		// move it back to "running".
		const onCompleted = () => this.setBackgroundTaskStatus(task.taskId, "completed")
		const onAborted = () => this.setBackgroundTaskStatus(task.taskId, "aborted")
		const onInteractive = () => this.setBackgroundTaskStatus(task.taskId, "needsConfirmation")
		const onResumable = () => this.setBackgroundTaskStatus(task.taskId, "needsConfirmation")
		const onIdle = () => {
			const ask = task.idleAsk?.ask
			this.setBackgroundTaskStatus(task.taskId, ask === "completion_result" ? "completed" : "needsConfirmation")
		}
		const onActive = () => {
			// A resumed ask flips the row back to running. Guard against flipping an
			// already-finished task (e.g. when completion_result is accepted, the
			// idle handler has already marked it completed and TaskCompleted follows).
			const current = this.backgroundTasks.get(task.taskId)?.status
			if (current === "needsConfirmation" || current === "running") {
				this.setBackgroundTaskStatus(task.taskId, "running")
			}
		}
		task.on(RooCodeEventName.TaskCompleted, onCompleted)
		task.on(RooCodeEventName.TaskAborted, onAborted)
		task.on(RooCodeEventName.TaskInteractive, onInteractive)
		task.on(RooCodeEventName.TaskResumable, onResumable)
		task.on(RooCodeEventName.TaskIdle, onIdle)
		task.on(RooCodeEventName.TaskActive, onActive)

		// Decide the starting status from the task's *real* state, not just whether
		// it has been aborted. `isTaskAlive` stays true for a finished task because
		// completion does not set `abort`, so naively mapping it to "running" left an
		// already-completed task (or one parked at the completion-result prompt) spinning
		// in the background list forever. Now:
		//   - aborted / abandoned            -> "completed"
		//   - actively streaming             -> "running"
		//   - at completion_result prompt     -> "completed"  (user can only click 任务完成)
		//   - parked at another prompt       -> "needsConfirmation"
		//   - otherwise (alive, no prompt)   -> "running"  (still working, e.g. between turns)
		const initialStatus: BackgroundTaskItem["status"] = !this.isTaskAlive(task)
			? "completed"
			: task.isStreaming
				? "running"
				: task.idleAsk?.ask === "completion_result"
					? "completed"
					: task.idleAsk || task.interactiveAsk || task.resumableAsk
						? "needsConfirmation"
						: "running"

		this.backgroundTasks.set(task.taskId, {
			task,
			status: initialStatus,
			listeners: [
				() => task.off(RooCodeEventName.TaskCompleted, onCompleted),
				() => task.off(RooCodeEventName.TaskAborted, onAborted),
				() => task.off(RooCodeEventName.TaskInteractive, onInteractive),
				() => task.off(RooCodeEventName.TaskResumable, onResumable),
				() => task.off(RooCodeEventName.TaskIdle, onIdle),
				() => task.off(RooCodeEventName.TaskActive, onActive),
			],
		})

		this.provider.log(`Backgrounded active task ${task.taskId} (${this.backgroundTasks.size} running in background)`)
		await this.provider.postStateToWebview()
	}

	/**
	 * Bring a background task back to the foreground. The previously active task
	 * (if any) is itself pushed to the background so exactly one session is shown.
	 */
	public async foregroundBackgroundTask(taskId: string): Promise<void> {
		const entry = this.backgroundTasks.get(taskId)
		if (!entry) {
			return
		}

		// Background whatever is currently active, unless it's the one we want.
		const active = this.provider.getCurrentTask()
		if (active && active.taskId !== taskId) {
			await this.backgroundActiveTask()
		}

		const target = this.backgroundTasks.get(taskId)
		if (!target) {
			return
		}
		for (const remove of target.listeners) {
			remove()
		}
		this.backgroundTasks.delete(taskId)

		// Restore the real provider so the task can post to the view again.
		target.task.providerRef = new WeakRef(this.provider)

		// Re-enter the foreground stack with the default completion handling.
		await this.provider.addClineToStack(target.task)

		// `addClineToStack()` deliberately posts the state *without* clineMessages,
		// which would leave the view with the empty message list it had while this
		// task was in the background — the chat would stay on the home screen even
		// though the task is now current. Re-post the full state so the messages
		// come back with it.
		await this.provider.postStateToWebview()
	}

	/**
	 * Stop a background task and remove it from the background list.
	 */
	public async stopBackgroundTask(taskId: string): Promise<void> {
		const entry = this.backgroundTasks.get(taskId)
		if (!entry) {
			return
		}
		for (const remove of entry.listeners) {
			remove()
		}
		this.backgroundTasks.delete(taskId)

		// Restore the real provider so abortTask can post its final updates.
		entry.task.providerRef = new WeakRef(this.provider)

		// Stop the underlying task for real when it is still alive — either actively
		// running or parked at a user prompt. A task that already aborted itself
		// only needs to be dropped from the list; aborting again would emit a
		// spurious second TaskAborted.
		if (this.isTaskAlive(entry.task)) {
			try {
				await entry.task.abortTask(true)
			} catch (error) {
				this.provider.log(`Error aborting background task ${taskId}: ${error}`)
			}
		}

		await this.provider.postStateToWebview()
	}

	/**
	 * A task is still doing autonomous work (or parked at a prompt) as long as it
	 * has not been abandoned/aborted. A torn-down task must not be shown as still
	 * running in the background list.
	 */
	public isTaskAlive(task: Task): boolean {
		return !task.abandoned && !task.abort
	}

	private setBackgroundTaskStatus(taskId: string, status: BackgroundTaskItem["status"]): void {
		const entry = this.backgroundTasks.get(taskId)
		if (entry) {
			entry.status = status
		}
		void this.provider.postStateToWebview()
	}

	/**
	 * Snapshot of the background tasks for the webview.
	 */
	public getBackgroundTaskItems(): BackgroundTaskItem[] {
		const items: BackgroundTaskItem[] = []
		for (const [taskId, entry] of this.backgroundTasks) {
			const historyItem = this.provider.taskHistoryStore.get(taskId)
			items.push({ taskId, task: historyItem, status: entry.status })
		}
		return items
	}
}
