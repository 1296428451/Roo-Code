import { memo, useState } from "react"
import { ArrowUpToLine, Square, Loader2, ChevronDown, ChevronRight } from "lucide-react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { StandardTooltip } from "@src/components/ui"
import { LucideIconButton } from "./LucideIconButton"
import type { BackgroundTaskItem } from "@roo-code/types"

/**
 * Compact list of the sessions currently running (or kept) in the background.
 * The action that sends the active session to the background lives next to the
 * "New Task" button; this panel is only for switching back and stopping them.
 * The whole panel can be collapsed so it stays out of the way.
 */
const BackgroundSessions = memo(() => {
	const { t } = useAppTranslation()
	const { backgroundTasks = [] } = useExtensionState()
	const [collapsed, setCollapsed] = useState(false)

	if (backgroundTasks.length === 0) {
		return null
	}

	const statusMeta: Record<BackgroundTaskItem["status"], { label: string; dot: string }> = {
		running: {
			label: t("chat:background.running"),
			dot: "bg-vscode-charts-green animate-pulse",
		},
		needsConfirmation: {
			label: t("chat:background.needsConfirmation"),
			dot: "bg-vscode-charts-yellow",
		},
		completed: {
			label: t("chat:background.completed"),
			dot: "bg-vscode-descriptionForeground",
		},
		aborted: {
			label: t("chat:background.aborted"),
			dot: "bg-vscode-descriptionForeground",
		},
	}

	// A task counts as "active" (still doing something or waiting on us) when it
	// is running or parked at a confirmation prompt — not when finished/stopped.
	const activeTasks = backgroundTasks.filter(
		(bg) => bg.status === "running" || bg.status === "needsConfirmation",
	)
	const activeCount = activeTasks.length
	const hasRunning = activeTasks.some((bg) => bg.status === "running")
	const hasConfirmation = activeTasks.some((bg) => bg.status === "needsConfirmation")

	const handleForeground = (taskId: string) =>
		vscode.postMessage({ type: "foregroundBackgroundTask", text: taskId })
	const handleStop = (taskId: string) => vscode.postMessage({ type: "stopBackgroundTask", text: taskId })

	return (
		<div className="mx-2 mb-1 rounded-lg border border-vscode-panel-border bg-vscode-sideBar-background/40 px-2 py-1.5">
			<button
				type="button"
				onClick={() => setCollapsed((c) => !c)}
				className="flex w-full items-center gap-1 text-[11px] uppercase tracking-wide text-vscode-descriptionForeground hover:text-vscode-foreground">
				{collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
				<span>{t("chat:background.title")}</span>
				<span className="text-vscode-descriptionForeground">({backgroundTasks.length})</span>
				{activeCount > 0 && (
					<span
						className="ml-auto inline-flex items-center gap-1 text-[10px] normal-case text-vscode-descriptionForeground"
						title={
							hasConfirmation
								? t("chat:background.needsConfirmationCount", { count: activeCount })
								: t("chat:background.runningCount", { count: activeCount })
						}>
						{hasRunning ? (
							<Loader2 className="size-2.5 animate-spin" />
						) : (
							<span className="size-2 rounded-full bg-vscode-charts-yellow" />
						)}
						{activeCount}
					</span>
				)}
			</button>

			{!collapsed && (
				<div className="mt-1 flex flex-col gap-0.5">
					{backgroundTasks.map((bg) => {
						const meta = statusMeta[bg.status]
						const isRunning = bg.status === "running"
						return (
							<div
								key={bg.taskId}
								className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-vscode-list-hoverBackground">
								<span className={`size-2 shrink-0 rounded-full ${meta.dot}`} />
								<span
									className="min-w-0 flex-1 truncate text-xs"
									title={bg.task?.task}>
									{bg.task?.task || bg.taskId}
								</span>
								<span
									className={`shrink-0 text-[10px] ${
										bg.status === "needsConfirmation"
											? "font-medium text-vscode-charts-yellow"
											: "text-vscode-descriptionForeground"
									}`}>
									{meta.label}
								</span>
								<LucideIconButton
									icon={ArrowUpToLine}
									title={t("chat:background.foreground")}
									onClick={() => handleForeground(bg.taskId)}
								/>
								{/* While the background task is still executing the control shows a
								    spinner instead of the stop symbol; once it parks at a confirmation
								    prompt or finishes, it turns into the clickable stop. */}
								{isRunning ? (
									<StandardTooltip content={meta.label}>
										<span
											aria-label={meta.label}
											className="inline-flex items-center justify-center p-1.5 text-vscode-descriptionForeground">
											<Loader2 className="size-3 animate-spin" />
										</span>
									</StandardTooltip>
								) : (
									<LucideIconButton
										icon={Square}
										title={t("chat:background.stop")}
										onClick={() => handleStop(bg.taskId)}
									/>
								)}
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
})

export default BackgroundSessions
