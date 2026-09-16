import type { HistoryItem, CreateTaskOptions } from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"
import { Task } from "../../task/Task"
import type { ClineProvider } from "../ClineProvider"

export class TaskStackDelegate {
	constructor(private readonly provider: ClineProvider) {}

	public async addClineToStack(cline: Task): Promise<void> {
		this.provider.clineStack.push(cline)

		const eventListeners: Array<() => void> = []

		const onTaskCompleted = (taskId: string) => {
			if (taskId === cline.taskId) {
				void this.closeTaskAndRefreshUi()
			}
		}

		// TaskAborted carries no payload; the closure identifies the task that ended.
		const onTaskAborted = () => {
			void this.closeTaskAndRefreshUi()
		}

		cline.on(RooCodeEventName.TaskCompleted, onTaskCompleted)
		cline.on(RooCodeEventName.TaskAborted, onTaskAborted)

		eventListeners.push(() => {
			cline.off(RooCodeEventName.TaskCompleted, onTaskCompleted)
			cline.off(RooCodeEventName.TaskAborted, onTaskAborted)
		})

		this.provider.taskEventListeners.set(cline, eventListeners)

		const state = await this.provider.getState()
		if (state.apiConfiguration) {
			cline.updateApiConfiguration(state.apiConfiguration)
		}

		this.provider.taskCreationCallback(cline)

		await this.provider.postStateToWebviewWithoutClineMessages()
	}

	/**
	 * Close the current (top-most) task only.
	 *
	 * The task is aborted rather than merely disposed: `abortTask()` cancels the
	 * in-flight request, marks the task abandoned so its recursion stops, flushes
	 * its messages/metadata to disk and emits `TaskAborted` — all of which the
	 * API/bridge/CLI subscribers and the token-usage accounting rely on. Disposing
	 * alone leaves them without a final update.
	 *
	 * When the closed task was a delegated child, the parent's metadata is repaired
	 * from "delegated" back to "active" so the parent is not left orphaned
	 * (unresumable) in the task history.
	 *
	 * Refreshing the webview is the caller's responsibility: every call site
	 * already posts the new state right after this (see `clearAllTasks()` for the
	 * batch case and `closeTaskAndRefreshUi()` for the event-driven case).
	 */
	public async removeClineFromStack(options?: { skipDelegationRepair?: boolean }): Promise<void> {
		const task = this.provider.clineStack.pop()

		if (!task) {
			return
		}

		await this.teardownTask(task)

		if (!options?.skipDelegationRepair) {
			await this.repairParentMetadata(task)
		}
	}

	/**
	 * Close every task currently on the stack and return to the main (welcome) view.
	 *
	 * "New Task" must exit directly to the main UI. Closing only the top-most task
	 * made the UI unwind one task per click whenever more than one task was open
	 * (e.g. main task + sub task), so the view fell back to the sub task first and
	 * only reached the main UI on a second click.
	 */
	public async clearAllTasks(options?: { skipDelegationRepair?: boolean }): Promise<void> {
		// Pop each task before awaiting its teardown so the draining loop cannot be
		// re-entered by a slow dispose, and post the state only once at the end to
		// avoid flickering through the intermediate tasks.
		while (this.provider.clineStack.length > 0) {
			await this.removeClineFromStack(options)
		}

		await this.provider.postStateToWebview()
	}

	/**
	 * Abort a task and detach the event listeners this delegate registered for it.
	 */
	private async teardownTask(task: Task): Promise<void> {
		// Detach our listeners BEFORE aborting. `abortTask()` emits `TaskAborted`,
		// and the listener registered in `addClineToStack()` reacts by calling back
		// into `removeClineFromStack()`, which pops the *top* of the stack and would
		// therefore tear down an unrelated task (e.g. a parent that was just
		// reopened). Detaching first keeps teardown free of side effects.
		const listeners = this.provider.taskEventListeners.get(task)
		if (listeners) {
			for (const remove of listeners) {
				remove()
			}
			this.provider.taskEventListeners.delete(task)
		}

		try {
			task.emit(RooCodeEventName.TaskUnfocused)
		} catch (error) {
			this.provider.log(`Error emitting TaskUnfocused for task ${task.taskId}: ${error}`)
		}

		try {
			await task.abortTask(true)
		} catch (error) {
			this.provider.log(`abortTask() failed for task ${task.taskId}: ${error}`)
			// Fall back to dispose() so the instance still releases its resources.
			try {
				await task.dispose()
			} catch (disposeError) {
				this.provider.log(`Error disposing task ${task.taskId}: ${disposeError}`)
			}
		}
	}

	/**
	 * If the closed task was a delegated child, restore the parent from "delegated"
	 * to "active" so it becomes resumable again instead of staying orphaned.
	 *
	 * Skipped by `delegateParentAndOpenChild()` during nested A→B→C transitions,
	 * where the caller intentionally replaces the active child and updates the
	 * parent itself (see `skipDelegationRepair`).
	 */
	private async repairParentMetadata(child: Task): Promise<void> {
		const parentTaskId = child.parentTaskId

		if (!parentTaskId) {
			return
		}

		try {
			const { historyItem } = await this.provider.getTaskWithId(parentTaskId)

			if (historyItem.status === "delegated" && historyItem.awaitingChildId === child.taskId) {
				await this.provider.updateTaskHistory({
					...historyItem,
					status: "active",
					awaitingChildId: undefined,
				})
				this.provider.log(
					`Repaired parent ${parentTaskId} metadata: delegated → active (child ${child.taskId} closed)`,
				)
			}
		} catch (error) {
			// Non-fatal: the task is already off the stack, so never block teardown.
			this.provider.log(
				`Failed to repair parent metadata for ${parentTaskId} (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	/**
	 * Close the task that just finished/aborted and push the resulting state to the
	 * webview so the UI returns to the main view.
	 */
	private async closeTaskAndRefreshUi(): Promise<void> {
		try {
			await this.removeClineFromStack()
			await this.provider.postStateToWebview()
		} catch (error) {
			this.provider.log(`Error closing finished task: ${error}`)
		}
	}

	public getTaskStackSize(): number {
		return this.provider.clineStack.length
	}

	public getCurrentTaskStack(): string[] {
		return this.provider.clineStack.map((cline) => cline.taskId)
	}

	public getCurrentTask(): Task | undefined {
		return this.provider.clineStack.length > 0 ? this.provider.clineStack[this.provider.clineStack.length - 1] : undefined
	}

	/**
	 * Single-open-task invariant, part 1 of 2.
	 *
	 * A user-initiated top-level task *replaces* whatever is on the stack instead
	 * of being pushed on top of it. Skipping this turned every "open a task" into
	 * a push, so the stack grew by one per navigation (open a sub task, jump back
	 * to the main task, …) and "New Task" needed one click per open task before
	 * the main UI came back — each click only popped the top-most task.
	 *
	 * Delegated sub tasks (`parent` set) are the one exception and are deliberately
	 * left alone: the parent → child handover is already performed by
	 * `delegateParentAndOpenChild()`, which pops the parent *before* calling here.
	 * Closing a second time would tear down the task that was just closed, or —
	 * if the stack has moved on — whatever else happens to be on top.
	 */
	public async createTask(
		message?: string,
		images?: string[],
		parent?: Task,
		options?: CreateTaskOptions,
	): Promise<Task> {
		const state = await this.provider.getState()

		if (!parent) {
			await this.closeCurrentTaskQuietly("createTask")
		}

		const task = new Task({
			provider: this.provider,
			apiConfiguration: state.apiConfiguration,
			task: message,
			images,
			parentTask: parent,
			...options,
		})

		await this.addClineToStack(task)

		return task
	}

	/**
	 * Single-open-task invariant, part 2 of 2.
	 *
	 * Rehydrating the task that is *already* open (checkpoint restore, cancel and
	 * reload) must not close it first: going through `removeClineFromStack()` would
	 * pop it, post a task-less state to the webview and only then rebuild it in
	 * place — the UI flicker this path exists to avoid. Same id → swap the instance
	 * in place; different id or empty stack → close first, then open.
	 *
	 * Note this does not post state itself in either branch: `addClineToStack()`
	 * refreshes for the opened-instead case, and the callers of the in-place case
	 * already drive the UI (see `ClineProvider.flicker-free-cancel.spec.ts`).
	 */
	public async createTaskWithHistoryItem(historyItem: HistoryItem, options?: { startTask?: boolean }): Promise<Task> {
		const currentTask = this.getCurrentTask()
		const isRehydratingCurrentTask = currentTask !== undefined && currentTask.taskId === historyItem.id

		if (!isRehydratingCurrentTask) {
			await this.closeCurrentTaskQuietly("createTaskWithHistoryItem")
		}

		const state = await this.provider.getState()
		const task = new Task({
			provider: this.provider,
			apiConfiguration: state.apiConfiguration,
			historyItem,
			...options,
		})

		if (isRehydratingCurrentTask && currentTask) {
			await this.replaceCurrentTaskInPlace(currentTask, task)
		} else {
			await this.addClineToStack(task)
		}

		return task
	}

	/**
	 * Swap the top of the stack for a freshly hydrated instance of the same task,
	 * without popping in between so the webview never sees a task-less state.
	 */
	private async replaceCurrentTaskInPlace(previous: Task, next: Task): Promise<void> {
		// Detach our listeners BEFORE aborting. `abortTask()` emits `TaskAborted`,
		// and the listener registered in `addClineToStack()` reacts by calling
		// `removeClineFromStack()`, which pops the top of the stack. That would pop
		// the very task we are about to replace, leaving the stack shorter than the
		// index we are about to write to. Detaching first keeps the swap atomic.
		const listeners = this.provider.taskEventListeners.get(previous)
		if (listeners) {
			for (const remove of listeners) {
				remove()
			}
			this.provider.taskEventListeners.delete(previous)
		}

		try {
			await previous.abortTask(true)
		} catch (error) {
			this.provider.log(
				`[createTaskWithHistoryItem] abortTask() failed for replaced task ${previous.taskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		const stackIndex = this.provider.clineStack.indexOf(previous)

		if (stackIndex === -1) {
			// The task left the stack while we were tearing it down (e.g. a racing
			// completion event). Fall back to a plain push so the newly hydrated
			// task is still reachable instead of being lost.
			await this.addClineToStack(next)
			return
		}

		this.provider.clineStack[stackIndex] = next

		try {
			next.emit(RooCodeEventName.TaskFocused)
		} catch (error) {
			this.provider.log(`Error emitting TaskFocused for task ${next.taskId}: ${error}`)
		}

		// `addClineToStack()` is what normally announces a new instance to the
		// provider (`taskCreationCallback`) and runs the per-provider preparation
		// (LM Studio model loading). This branch deliberately skips that method to
		// stay flicker-free, so both steps are repeated here — otherwise a
		// rehydrated instance would be invisible to whoever tracks task instances.
		this.provider.taskCreationCallback(next)

		await this.performPreparationTasks(next)

		this.provider.log(`[createTaskWithHistoryItem] rehydrated task ${next.taskId} in-place (flicker-free)`)
	}

	/**
	 * Close the top-most task, letting a failure through as a log line instead of
	 * an exception: opening the task the caller asked for matters more than the
	 * cleanup of the one it replaces.
	 */
	private async closeCurrentTaskQuietly(context: string): Promise<void> {
		try {
			await this.removeClineFromStack()
		} catch (error) {
			this.provider.log(
				`[${context}] Failed to close the current task (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	public async performPreparationTasks(_cline: Task): Promise<void> {
		// Task handles preparation internally during construction/start
		// No additional preparation needed here
	}

	public async cancelTask(): Promise<void> {
		const task = this.getCurrentTask()
		if (task) {
			await task.abortTask()
		}
	}

	public async clearTask(): Promise<void> {
		// "New Task" semantics: leave the task stack empty so the webview shows the
		// main UI instead of the previous task.
		await this.clearAllTasks()
	}

	public async resumeTask(taskId: string): Promise<void> {
		await this.provider.showTaskWithId(taskId)
	}
}