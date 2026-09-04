import * as fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../utils/fs"

export interface DiffChange {
	/** Relative path of the changed file */
	paths: {
		relative: string
		absolute: string
	}
	/** File content before the change (undefined = file did not exist) */
	before?: string
	/** File content after the change (undefined = file was deleted) */
	after?: string
	/** Type of change */
	type: "modified" | "added" | "deleted"
}

/**
 * FileSnapshotService — per-task file-level snapshot manager.
 *
 * Replaces the git-based shadow checkpoint system with simple file copies.
 * Snapshots are stored inside the task directory and automatically removed
 * when the task directory is deleted.
 *
 * Layout:
 *   <taskDir>/snapshots/
 *     <index>-<label>/
 *       <relative/path/to/file.ext>   ← file content before this edit
 *       _meta.json                     ← metadata for this snapshot
 *
 * Key properties:
 * - Only files touched by write tools are snapshotted (not full workspace)
 * - No git, no core.worktree, no checkout/reset/clean on real workspace
 * - Restoring = copying snapshot files back to workspace
 * - Deleting task dir = deleting all snapshots
 */

export interface SnapshotMeta {
	index: number
	label: string
	timestamp: number
	files: string[]   // relative paths
	tool: string      // which tool triggered this snapshot
	description: string  // human-readable summary
}

export interface SnapshotEntry {
	id: string          // "<index>-<label>"
	meta: SnapshotMeta
	dir: string          // absolute path to snapshot directory
}

const SNAPSHOTS_SUBDIR = "snapshots"
const META_FILE = "_meta.json"

// Reserved characters that are unsafe in directory names on Windows
const UNSAFE_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

function sanitizeLabel(label: string): string {
	return label.replace(UNSAFE_CHARS, "_").trim().slice(0, 60) || "untitled"
}

/**
 * Generate a human-friendly label for a snapshot.
 *
 * Examples:
 *   "write-to-file"  → "write-to-file"
 *   "apply-diff"      → "apply-diff"
 *   "user-message"    → "user-message"
 *   "search-replace"  → "search-replace"
 *   "apply-patch"     → "apply-patch"
 *   "edit"            → "edit"
 *   "edit-file"       → "edit-file"
 */
function buildLabel(tool: string, fileCount: number): string {
	// Convert tool name to a readable label
	const labelMap: Record<string, string> = {
		"write_to_file": "write-to-file",
		"apply_diff": "apply-diff",
		"apply_patch": "apply-patch",
		"search_replace": "search-replace",
		"edit": "edit",
		"edit_file": "edit-file",
		"user_message": "user-message",
	}
	return labelMap[tool] || sanitizeLabel(tool)
}

export class FileSnapshotService {
	private readonly snapshotsDir: string
	private _snapshots: SnapshotEntry[] = []
	private _nextIndex = 1
	private initialized = false

	constructor(
		private readonly taskId: string,
		private readonly taskDir: string,
		private readonly workspaceDir: string,
		private readonly log: (message: string) => void,
	) {
		this.snapshotsDir = path.join(this.taskDir, SNAPSHOTS_SUBDIR)
	}

	/** Subdirectory name inside task dir */
	static get snapshotsSubdir() {
		return SNAPSHOTS_SUBDIR
	}

	get isInitialized() {
		return this.initialized
	}

	get snapshots(): readonly SnapshotEntry[] {
		return this._snapshots
	}

	async init(): Promise<void> {
		if (this.initialized) return

		await fs.mkdir(this.snapshotsDir, { recursive: true })

		// Recover existing snapshots (e.g. after task reload)
		await this.recoverSnapshots()

		this.initialized = true
		this.log(`[FileSnapshotService] initialized at ${this.snapshotsDir} with ${this._snapshots.length} existing snapshots`)
	}

	/**
	 * Scan existing snapshot directories and load metadata.
	 * Allows restoring snapshots from a previous session after task reload.
	 */
	private async recoverSnapshots(): Promise<void> {
		let entries: string[]
		try {
			entries = await fs.readdir(this.snapshotsDir)
		} catch {
			return
		}

		const dirs = entries.filter(e => !e.startsWith("."))

		for (const dir of dirs) {
			const metaPath = path.join(this.snapshotsDir, dir, META_FILE)
			try {
				if (await fileExistsAtPath(metaPath)) {
					const meta = JSON.parse(await fs.readFile(metaPath, "utf-8")) as SnapshotMeta
					this._snapshots.push({
						id: dir,
						meta,
						dir: path.join(this.snapshotsDir, dir),
					})

					// Track next index
					if (meta.index >= this._nextIndex) {
						this._nextIndex = meta.index + 1
					}
				}
			} catch (err) {
				this.log(`[FileSnapshotService] failed to load snapshot ${dir}: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		// Sort by index
		this._snapshots.sort((a, b) => a.meta.index - b.meta.index)
	}

	/**
	 * Create a snapshot of the given files before a write operation.
	 *
	 * @param files - Array of { relativePath, content } where content is the
	 *                CURRENT file content (before the write). If content is
	 *                undefined and file doesn't exist, it's recorded as a
	 *                "new file" marker (empty string in snapshot).
	 * @param tool   - Name of the tool triggering this snapshot
	 * @param description - Human-readable description
	 * @returns The snapshot entry, or undefined if no files to snapshot.
	 */
	async saveSnapshot(
		files: Array<{ relativePath: string; content?: string }>,
		tool: string,
		description?: string,
	): Promise<SnapshotEntry | undefined> {
		if (!this.initialized) {
			await this.init()
		}

		if (files.length === 0) {
			return undefined
		}

		const index = this._nextIndex++
		const label = buildLabel(tool, files.length)
		const id = `${String(index).padStart(3, "0")}-${label}`
		const snapshotDir = path.join(this.snapshotsDir, id)

		await fs.mkdir(snapshotDir, { recursive: true })

		const savedFiles: string[] = []

		for (const { relativePath, content } of files) {
			const destPath = path.join(snapshotDir, relativePath)
			const destDir = path.dirname(destPath)

			await fs.mkdir(destDir, { recursive: true })

			// If content is provided, use it; otherwise try to read from disk
			let fileContent: string
			if (content !== undefined) {
				fileContent = content
			} else {
				const absPath = path.resolve(this.workspaceDir, relativePath)
				try {
					fileContent = await fs.readFile(absPath, "utf-8")
				} catch {
					// File doesn't exist yet — mark as new file with empty content
					fileContent = ""
				}
			}

			await fs.writeFile(destPath, fileContent, "utf-8")
			savedFiles.push(relativePath)
		}

		const meta: SnapshotMeta = {
			index,
			label,
			timestamp: Date.now(),
			files: savedFiles,
			tool,
			description: description || `${tool} on ${savedFiles.length} file(s)`,
		}

		// Write metadata
		await fs.writeFile(
			path.join(snapshotDir, META_FILE),
			JSON.stringify(meta, null, 2),
			"utf-8",
		)

		const entry: SnapshotEntry = { id, meta, dir: snapshotDir }
		this._snapshots.push(entry)

		this.log(`[FileSnapshotService] snapshot #${index} saved: ${label} (${savedFiles.length} file(s))`)

		return entry
	}

	/**
	 * Restore files to the state at a given snapshot.
	 * This copies the snapshot files back to the workspace.
	 *
	 * Note: Only files that were snapshotted are restored. Files modified
	 * by execute_command or manual edits (not via write tools) are NOT
	 * affected — this is by design, to prevent accidental data loss.
	 */
	async restoreSnapshot(snapshotId: string): Promise<void> {
		const entry = this._snapshots.find(s => s.id === snapshotId)
		if (!entry) {
			throw new Error(`Snapshot ${snapshotId} not found`)
		}

		const snapshotIndex = entry.meta.index

		// Restore files from this snapshot
		for (const relativePath of entry.meta.files) {
			const srcPath = path.join(entry.dir, relativePath)
			const destPath = path.resolve(this.workspaceDir, relativePath)
			const destDir = path.dirname(destPath)

			await fs.mkdir(destDir, { recursive: true })

			try {
				const content = await fs.readFile(srcPath, "utf-8")
				await fs.writeFile(destPath, content, "utf-8")
			} catch (err) {
				this.log(`[FileSnapshotService] failed to restore ${relativePath}: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		// Remove all snapshots after this one (they represent later edits)
		const toRemove = this._snapshots.filter(s => s.meta.index > snapshotIndex)
		for (const s of toRemove) {
			try {
				await fs.rm(s.dir, { recursive: true, force: true })
			} catch {
				// best effort
			}
		}

		// Update in-memory list
		this._snapshots = this._snapshots.filter(s => s.meta.index <= snapshotIndex)

		this.log(`[FileSnapshotService] restored snapshot #${snapshotIndex} (${entry.meta.label}), removed ${toRemove.length} later snapshots`)
	}

	/**
	 * Get a list of all snapshots for UI display.
	 */
	getSnapshots(): SnapshotEntry[] {
		return this._snapshots.slice()
	}

	/**
	 * Get a specific snapshot's file content.
	 * Used for diff display.
	 */
	async getSnapshotFile(snapshotId: string, relativePath: string): Promise<string | undefined> {
		const entry = this._snapshots.find(s => s.id === snapshotId)
		if (!entry) return undefined

		try {
			return await fs.readFile(path.join(entry.dir, relativePath), "utf-8")
		} catch {
			return undefined
		}
	}

	/**
	 * Compute diff between two snapshots, or between a snapshot and the current workspace state.
	 *
	 * @param from - Snapshot ID to diff from (undefined = first snapshot)
	 * @param to   - Snapshot ID to diff to (undefined = current workspace state)
	 * @returns Array of DiffChange for files that differ between the two states.
	 */
	async getDiff(opts: { from?: string; to?: string }): Promise<DiffChange[]> {
		const { from: fromId, to: toId } = opts

		// Collect all file paths from both endpoints
		const fromFiles = await this.collectFilesForSnapshot(fromId)
		const toFiles = await this.collectFilesForState(toId)

		const allPaths = new Set<string>([...fromFiles.keys(), ...toFiles.keys()])
		const changes: DiffChange[] = []

		for (const relativePath of allPaths) {
			const beforeContent = fromFiles.get(relativePath)
			const afterContent = toFiles.get(relativePath)

			// Skip if content is identical
			if (beforeContent === afterContent) continue

			const absPath = path.resolve(this.workspaceDir, relativePath)

			let type: DiffChange["type"]
			if (beforeContent === undefined && afterContent !== undefined) {
				type = "added"
			} else if (beforeContent !== undefined && afterContent === undefined) {
				type = "deleted"
			} else {
				type = "modified"
			}

			changes.push({
				paths: { relative: relativePath, absolute: absPath },
				before: beforeContent,
				after: afterContent,
				type,
			})
		}

		return changes
	}

	/**
	 * Collect file contents from a given snapshot.
	 * If snapshotId is undefined, uses the first snapshot.
	 */
	private async collectFilesForSnapshot(snapshotId: string | undefined): Promise<Map<string, string>> {
		const result = new Map<string, string>()

		const entry = snapshotId
			? this._snapshots.find(s => s.id === snapshotId)
			: this._snapshots[0]

		if (!entry) return result

		for (const relativePath of entry.meta.files) {
			try {
				const content = await fs.readFile(path.join(entry.dir, relativePath), "utf-8")
				result.set(relativePath, content)
			} catch {
				// skip
			}
		}

		return result
	}

	/**
	 * Collect file contents for a given snapshot state (or current workspace if undefined).
	 *
	 * Each snapshot records the file content BEFORE the write tool ran.
	 * So snapshot N's content = state before write N = state after write N-1.
	 *
	 * For "to-current" (toId = undefined), we read the actual workspace files.
	 * For a specific snapshot ID, we read that snapshot's recorded file content.
	 */
	private async collectFilesForState(snapshotId: string | undefined): Promise<Map<string, string>> {
		const result = new Map<string, string>()

		if (!snapshotId) {
			// "to-current": read actual workspace files
			// Collect all unique file paths from all snapshots
			const allPaths = new Set<string>()
			for (const s of this._snapshots) {
				for (const f of s.meta.files) {
					allPaths.add(f)
				}
			}

			for (const relativePath of allPaths) {
				const absPath = path.resolve(this.workspaceDir, relativePath)
				try {
					const content = await fs.readFile(absPath, "utf-8")
					result.set(relativePath, content)
				} catch {
					// File no longer exists in workspace — it was deleted
				}
			}
			return result
		}

		// Read the snapshot's own recorded file content
		const entry = this._snapshots.find(s => s.id === snapshotId)
		if (!entry) return result

		for (const relativePath of entry.meta.files) {
			try {
				const content = await fs.readFile(path.join(entry.dir, relativePath), "utf-8")
				result.set(relativePath, content)
			} catch {
				// skip
			}
		}

		return result
	}
}
