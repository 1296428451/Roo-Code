import type { GlobalState } from "@roo-code/types"
import type { ClineProvider } from "../ClineProvider"
import { defaultModeSlug } from "../../../shared/modes"

export interface HandlerContext {
	provider: ClineProvider
	getGlobalState: <K extends keyof GlobalState>(key: K) => GlobalState[K]
	updateGlobalState: <K extends keyof GlobalState>(key: K, value: GlobalState[K]) => Promise<void>
	getCurrentCwd: () => string | undefined
	getCurrentMode: () => Promise<string>
}

export function createHandlerContext(provider: ClineProvider): HandlerContext {
	const getGlobalState = <K extends keyof GlobalState>(key: K) => provider.contextProxy.getValue(key)
	const updateGlobalState = async <K extends keyof GlobalState>(key: K, value: GlobalState[K]) =>
		await provider.contextProxy.setValue(key, value)

	const getCurrentCwd = () => {
		return provider.getCurrentTask()?.cwd || provider.cwd
	}

	const getCurrentMode = async (): Promise<string> => {
		const currentTask = provider.getCurrentTask()

		if (currentTask) {
			try {
				return await currentTask.getTaskMode()
			} catch (error) {
				provider.log(`Error resolving current task mode for command discovery: ${error}`)
			}
		}

		try {
			const state = await provider.getState()
			if (typeof state.mode === "string" && state.mode.length > 0) {
				return state.mode
			}
		} catch (error) {
			provider.log(`Error resolving global mode for command discovery: ${error}`)
		}

		return defaultModeSlug
	}

	return {
		provider,
		getGlobalState,
		updateGlobalState,
		getCurrentCwd,
		getCurrentMode,
	}
}