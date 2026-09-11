import { memo, useEffect, useMemo, useState, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight, FileDiff, History, Trash2, Undo2 } from "lucide-react"
import { createTwoFilesPatch } from "diff"

import type { ClineMessage, ExtensionMessage } from "@roo-code/types"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui"
import { cn } from "@/lib/utils"
import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"

import { fileChangesFromMessages, type FileChangeEntry } from "./utils/fileChangesFromMessages"
import CodeAccordion from "../common/CodeAccordion"

interface FileChangesPanelProps {
	clineMessages: ClineMessage[] | undefined
	className?: string
}

interface RestoreError {
	path: string
	kind: "deleted" | "modified"
	error: string
	ts: number
}

const FileChangesPanel = memo(({ clineMessages, className }: FileChangesPanelProps) => {
	const { t } = useTranslation()
	const { deletedFiles } = useExtensionState()
	const [panelExpanded, setPanelExpanded] = useState(false)
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
	const [finalContentByPath, setFinalContentByPath] = useState<Record<string, string | null>>({})
	const pendingPathsRef = useRef<Set<string>>(new Set())
	const [restoringPath, setRestoringPath] = useState<string | null>(null)
	// Tracks in-flight restore for the modified-file button separately so both
	// kinds of restore can show their own spinner.
	const [restoringOriginalPath, setRestoringOriginalPath] = useState<string | null>(null)
	const [restoreErrors, setRestoreErrors] = useState<RestoreError[]>([])

	// Reset expanded file rows and final content cache when switching to a different task.
	// Note: deletedFiles comes from useExtensionState() and is NOT reset here — it is
	// kept in sync by the extension's `deletedFilesUpdated` broadcasts, which also fire
	// at task init (so resuming an old task still shows files trashed in a previous
	// session) and after every move/restore operation.
	useEffect(() => {
		setExpandedPaths(new Set())
		setFinalContentByPath({})
		pendingPathsRef.current = new Set()
		setRestoringPath(null)
		setRestoringOriginalPath(null)
		setRestoreErrors([])
	}, [clineMessages])

	const fileChanges = useMemo(() => fileChangesFromMessages(clineMessages), [clineMessages])

	// Group by path so we show one row per file (multiple edits to same file combined for display)
	const byPath = useMemo(() => {
		const map = new Map<string, FileChangeEntry[]>()
		for (const entry of fileChanges) {
			const key = entry.path
			const list = map.get(key) ?? []
			list.push(entry)
			map.set(key, list)
		}
		return map
	}, [fileChanges])

	// Aggregate total lines added/removed across all files for the panel header
	const totalStats = useMemo(() => {
		return fileChanges.reduce(
			(acc, e) => ({
				added: acc.added + (e.diffStats?.added ?? 0),
				removed: acc.removed + (e.diffStats?.removed ?? 0),
			}),
			{ added: 0, removed: 0 },
		)
	}, [fileChanges])

	const togglePath = useCallback((path: string) => {
		setExpandedPaths((prev) => {
			const next = new Set(prev)
			if (next.has(path)) next.delete(path)
			else next.add(path)
			return next
		})
	}, [])

	// Request final file content when a row is expanded and we have originalContent
	useEffect(() => {
		for (const path of expandedPaths) {
			const entries = byPath.get(path)
			if (!entries?.length) continue
			const originalContent = entries[0].originalContent
			const lookupPath = path.startsWith("./") ? path.slice(2) : path
			if (
				originalContent !== undefined &&
				!(lookupPath in finalContentByPath) &&
				!pendingPathsRef.current.has(lookupPath)
			) {
				pendingPathsRef.current.add(lookupPath)
				vscode.postMessage({ type: "readFileContent", text: lookupPath })
			}
		}
	}, [expandedPaths, byPath, finalContentByPath])

	// Listen for fileContent responses
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			if (message.type === "fileContent" && message.fileContent?.path != null) {
				const fc = message.fileContent
				pendingPathsRef.current.delete(fc.path)
				setFinalContentByPath((prev) => ({ ...prev, [fc.path]: fc.content ?? null }))
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const handleRestoreDeleted = useCallback((relativePath: string) => {
		setRestoringPath(relativePath)
		vscode.postMessage({ type: "restoreDeletedFile", text: relativePath })
		// The extension will broadcast a `deletedFilesUpdated` event when the
		// restore finishes; the effect above clears restoringPath via key change.
		window.setTimeout(() => {
			setRestoringPath((current) => (current === relativePath ? null : current))
		}, 8000)
	}, [])

	const handleRestoreOriginal = useCallback((relativePath: string) => {
		setRestoringOriginalPath(relativePath)
		// Clear any previous error for this path before issuing the new request.
		setRestoreErrors((prev) => prev.filter((e) => e.path !== relativePath))
		vscode.postMessage({ type: "restoreFileToOriginal", text: relativePath })
		window.setTimeout(() => {
			setRestoringOriginalPath((current) => (current === relativePath ? null : current))
		}, 8000)
	}, [])

	// Listen for restore results from the extension (success or error).
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			if (message.type !== "fileRestoreResult" || !message.fileRestoreResult) return
			const { kind, relativePath, success, error } = message.fileRestoreResult
			if (kind === "deleted") {
				setRestoringPath((current) => (current === relativePath ? null : current))
			} else {
				setRestoringOriginalPath((current) => (current === relativePath ? null : current))
			}
			if (!success && error) {
				setRestoreErrors((prev) => {
					const filtered = prev.filter((e) => e.path !== relativePath)
					return [
						...filtered,
						{ path: relativePath, kind, error, ts: Date.now() },
					]
				})
			} else {
				// Successful restore — drop any previous error for this path.
				setRestoreErrors((prev) => prev.filter((e) => e.path !== relativePath))
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	if (fileChanges.length === 0 && deletedFiles.length === 0) return null

	const fileCount = byPath.size
	const deletedCount = deletedFiles.length
	// Header text: e.g. "12 files changed (3 deleted, recoverable)"
	const headerLabel =
		deletedCount > 0
			? t("chat:fileChangesInConversation.headerWithDeleted", {
					count: fileCount,
					deletedCount,
				})
			: t("chat:fileChangesInConversation.header", { count: fileCount })

	return (
		<Collapsible open={panelExpanded} onOpenChange={setPanelExpanded} className={cn("px-3", className)}>
			<CollapsibleTrigger
				className={cn(
					"flex items-center gap-2 w-full py-2 rounded-md text-left text-vscode-foreground",
					"hover:bg-vscode-list-hoverBackground",
				)}>
				{panelExpanded ? (
					<ChevronDown className="size-4 shrink-0" aria-hidden />
				) : (
					<ChevronRight className="size-4 shrink-0" aria-hidden />
				)}
				<FileDiff className="size-4 shrink-0" aria-hidden />
				<span className="text-sm font-medium">{headerLabel}</span>
				{totalStats.added > 0 || totalStats.removed > 0 ? (
					<div
						className="flex items-center gap-2 ml-auto shrink-0"
						aria-label={`${totalStats.added} lines added, ${totalStats.removed} lines removed`}>
						<span className="text-xs font-medium text-vscode-charts-green" data-testid="total-added">
							+{totalStats.added}
						</span>
						<span className="text-xs font-medium text-vscode-charts-red" data-testid="total-removed">
							-{totalStats.removed}
						</span>
					</div>
				) : null}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="flex flex-col gap-1 pb-2 pl-6">
					{/* Modified / created files */}
					{Array.from(byPath.entries()).map(([path, entries]) => {
						const originalContent = entries[0].originalContent
						const lookupPath = path.startsWith("./") ? path.slice(2) : path
						const finalContent = finalContentByPath[lookupPath]
						const hasMergedDiff =
							originalContent !== undefined && finalContent != null && finalContent !== ""
						const displayDiff = hasMergedDiff
							? createTwoFilesPatch(path, path, originalContent, finalContent)
							: entries.map((e) => e.diff).join("\n\n")
						const combinedStats = entries.reduce(
							(acc, e) => ({
								added: acc.added + (e.diffStats?.added ?? 0),
								removed: acc.removed + (e.diffStats?.removed ?? 0),
							}),
							{ added: 0, removed: 0 },
						)
						const isExpanded = expandedPaths.has(path)
						const isRestoring = restoringOriginalPath === path
						const errorForPath = restoreErrors.find((e) => e.path === path)
						return (
							<div
								key={path}
								className="rounded border border-vscode-panel-border overflow-hidden"
								data-testid="modified-file-row">
								<div className="flex items-stretch">
									<div className="flex-1 min-w-0">
										<CodeAccordion
											path={path}
											code={displayDiff}
											language="diff"
											isExpanded={isExpanded}
											onToggleExpand={() => togglePath(path)}
											diffStats={
												combinedStats.added > 0 || combinedStats.removed > 0
													? combinedStats
													: undefined
											}
											onJumpToFile={
												path
													? () =>
															vscode.postMessage({
																type: "openFile",
																text: path.startsWith("./") ? path : "./" + path,
															})
													: undefined
											}
										/>
									</div>
									<button
										type="button"
										className={cn(
											"m-1 px-2 py-1 text-xs rounded border shrink-0 self-start",
											"border-vscode-button-border bg-transparent text-vscode-button-foreground",
											"hover:bg-vscode-button-hoverBackground",
											"inline-flex items-center gap-1",
											isRestoring && "opacity-60 cursor-wait",
										)}
										disabled={isRestoring}
										onClick={() => handleRestoreOriginal(path)}
										title={t("chat:fileChangesInConversation.restoreOriginalTooltip")}
										data-testid="restore-original-file-btn">
										{isRestoring ? (
											<>
												<History className="size-3.5 animate-spin" aria-hidden />
												{t("chat:fileChangesInConversation.restoring")}
											</>
										) : (
											<>
												<Undo2 className="size-3.5" aria-hidden />
												{t("chat:fileChangesInConversation.restore")}
											</>
										)}
									</button>
								</div>
								{errorForPath && (
									<div
										className="px-2 py-1 text-xs text-vscode-errorForeground border-t border-vscode-panel-border bg-vscode-inputValidation-errorBackground/30"
										role="alert"
										data-testid="restore-error">
										{errorForPath.error}
									</div>
								)}
							</div>
						)
					})}

					{/* Deleted files (recoverable from per-task .trash) */}
					{deletedFiles.map((entry) => {
						const isRestoring = restoringPath === entry.relativePath
						return (
							<div
								key={`deleted:${entry.relativePath}`}
								className="flex items-center gap-2 py-1 px-2 rounded border border-vscode-panel-border"
								data-testid="deleted-file-row">
								<Trash2
									className="size-3.5 shrink-0 text-vscode-errorForeground"
									aria-hidden
								/>
								<span
									className="flex-1 truncate text-sm font-mono text-vscode-foreground"
									title={entry.relativePath}>
									{entry.relativePath}
								</span>
								<button
									type="button"
									className={cn(
										"px-2 py-1 text-xs rounded border",
										"border-vscode-button-border bg-transparent text-vscode-button-foreground",
										"hover:bg-vscode-button-hoverBackground",
										isRestoring && "opacity-60 cursor-wait",
									)}
									disabled={isRestoring}
									onClick={() => handleRestoreDeleted(entry.relativePath)}
									data-testid="restore-deleted-file-btn">
									{isRestoring
										? t("chat:fileChangesInConversation.restoring")
										: t("chat:fileChangesInConversation.restore")}
								</button>
							</div>
						)
					})}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
})

FileChangesPanel.displayName = "FileChangesPanel"

export default FileChangesPanel
