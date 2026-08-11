import type { HistoryItem, CreateTaskOptions } from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"
import { Task } from "../../task/Task"
import type { ClineProvider } from "../ClineProvider"

export class TaskStackDelegate {
	constructor(private readonly provider: ClineProvider) {}

	public async addClineToStack(cline: Task): Promise<void> {
		this.provider.clineStack.push(cline)

		const eventListeners: Array<() => void> = []

		const onTaskCompleted = (taskId: string, _tokenUsage: any, _toolUsage: any) => {
			if (taskId === cline.taskId) {
				this.removeClineFromStack()
			}
		}

		const onTaskAborted = () => {
			this.removeClineFromStack()
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

	public async removeClineFromStack(options?: { skipDelegationRepair?: boolean }): Promise<void> {
		const cline = this.provider.clineStack.pop()
		if (cline) {
			const listeners = this.provider.taskEventListeners.get(cline)
			if (listeners) {
				for (const remove of listeners) {
					remove()
				}
				this.provider.taskEventListeners.delete(cline)
			}

			try {
				await cline.dispose()
			} catch (error) {
				this.provider.log(`Error disposing task: ${error}`)
			}
		}

		await this.provider.postStateToWebview()
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

	public async createTask(
		message?: string,
		images?: string[],
		parent?: Task,
		options?: CreateTaskOptions,
	): Promise<Task> {
		const state = await this.provider.getState()
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

	public async createTaskWithHistoryItem(historyItem: HistoryItem, options?: { startTask?: boolean }): Promise<Task> {
		const state = await this.provider.getState()
		const task = new Task({
			provider: this.provider,
			apiConfiguration: state.apiConfiguration,
			historyItem,
			...options,
		})

		await this.addClineToStack(task)

		return task
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
		await this.removeClineFromStack()
	}

	public async resumeTask(taskId: string): Promise<void> {
		await this.provider.showTaskWithId(taskId)
	}
}