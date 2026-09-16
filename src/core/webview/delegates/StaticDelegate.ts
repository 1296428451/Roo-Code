import type { CodeActionId, CodeActionName, TerminalActionId, TerminalActionPromptType } from "@roo-code/types"
import type { ClineProvider } from "../ClineProvider"

export class StaticDelegate {
	constructor(private readonly provider: ClineProvider) {}

	static getVisibleInstance(): ClineProvider | undefined {
		const { ClineProvider: Ctor } = require("../ClineProvider")
		for (const instance of Ctor.activeInstances) {
			if (instance.isViewLaunched && !instance._disposed) {
				return instance
			}
		}
		return undefined
	}

	static getInstance(): ClineProvider | undefined {
		const { ClineProvider: Ctor } = require("../ClineProvider")
		for (const instance of Ctor.activeInstances) {
			if (!instance._disposed) {
				return instance
			}
		}
		return undefined
	}

	static isActiveTask(taskId: string): boolean {
		const { ClineProvider: Ctor } = require("../ClineProvider")
		for (const instance of Ctor.activeInstances) {
			if (!instance._disposed && instance.clineStack.some((c: any) => c.taskId === taskId)) {
				return true
			}
		}
		return false
	}

	static async handleCodeAction(
		action: CodeActionId | CodeActionName,
		promptType?: string,
		context?: any, // eslint-disable-line @typescript-eslint/no-explicit-any
	): Promise<void> {
		const instance = StaticDelegate.getVisibleInstance()
		if (!instance) return

		await instance.postMessageToWebview({
			type: "codeAction",
			codeAction: { action, promptType, ...(context ?? {}) },
		})
	}

	static async handleTerminalAction(
		action: TerminalActionId,
		promptType?: TerminalActionPromptType,
		context?: any, // eslint-disable-line @typescript-eslint/no-explicit-any
	): Promise<void> {
		const instance = StaticDelegate.getVisibleInstance()
		if (!instance) return

		await instance.postMessageToWebview({
			type: "terminalAction",
			terminalAction: { action, promptType, ...(context ?? {}) },
		})
	}
}