import * as fs from "fs/promises"
import * as path from "path"

import { fileExistsAtPath } from "../../utils/fs"

/**
 * DeletedFilesService — per-task "soft delete" (trash) manager.
 *
 * When a tool deletes a file, instead of unlinking it, this service moves the
 * file into `<taskDir>/.trash/` so the user can recover it later from the
 * UI, like recovering modified code via checkpoints.
 *
 * Layout:
 *   <taskDir>/.trash/
 *     _index.json                          ← list of {relativePath, trashedAt, trashName}
 *     <trashName>                          ← exact copy of the deleted file content
 *
 * Trash files are removed automatically when the task directory is deleted.
 */
export interface DeletedFileEntry {
	/** Original relative path inside the workspace (the path the user would type to open it). */
	relativePath: string
	/** ISO-ish timestamp (millis since epoch) for sort + display. */
	trashedAt: number
	/** Filename inside .trash/ (timestamp-prefixed to avoid collisions). */
	trashName: string
	/** Approximate size in bytes at delete time (for UI). */
	size: number
}

const TRASH_SUBDIR = ".trash"
const TRASH_INDEX_FILE = "_index.json"

function safeSegmentForFile(relativePath: string): string {
	return relativePath.replace(/[\\/]/g, "__").replace(/[<>:"|?*\x00-\x1f]/g, "_").slice(0, 200) || "file"
}

export class DeletedFilesService {
	private readonly trashDir: string
	private _entries: DeletedFileEntry[] = []
	private initialized = false

	constructor(
		private readonly taskId: string,
		private readonly taskDir: string,
		private readonly workspaceDir: string,
		private readonly log: (message: string) => void,
	) {
		this.trashDir = path.join(this.taskDir, TRASH_SUBDIR)
	}

	static get trashSubdir() {
		return TRASH_SUBDIR
	}

	get isInitialized() {
		return this.initialized
	}

	get entries(): readonly DeletedFileEntry[] {
		return this._entries
	}

	async init(): Promise<void> {
		if (this.initialized) return
		await fs.mkdir(this.trashDir, { recursive: true })
		await this.recoverIndex()
		this.initialized = true
		this.log(`[DeletedFilesService] initialized at ${this.trashDir} (${this._entries.length} entries)`)
	}

	private async recoverIndex(): Promise<void> {
		const indexPath = path.join(this.trashDir, TRASH_INDEX_FILE)
		try {
			if (!(await fileExistsAtPath(indexPath))) return
			const parsed = JSON.parse(await fs.readFile(indexPath, "utf-8")) as DeletedFileEntry[]
			if (!Array.isArray(parsed)) return
			this._entries = parsed
		} catch (err) {
			this.log(`[DeletedFilesService] failed to load index: ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	private async writeIndex(): Promise<void> {
		await fs.writeFile(
			path.join(this.trashDir, TRASH_INDEX_FILE),
			JSON.stringify(this._entries, null, 2),
			"utf-8",
		)
	}

	/**
	 * Move a file from the workspace into the trash instead of deleting it.
	 * Returns the DeletedFileEntry on success, or undefined if the file no
	 * longer existed (in which case the caller can no-op).
	 */
	async moveToTrash(relativePath: string): Promise<DeletedFileEntry | undefined> {
		if (!this.initialized) {
			await this.init()
		}

		const absolutePath = path.resolve(this.workspaceDir, relativePath)
		const exists = await fileExistsAtPath(absolutePath)
		if (!exists) {
			return undefined
		}

		const stat = await fs.stat(absolutePath)
		const trashedAt = Date.now()
		const safeSeg = safeSegmentForFile(relativePath)
		const trashName = `${String(trashedAt).padStart(14, "0")}-${safeSeg}`

		// Ensure unique trash name if collision
		let finalName = trashName
		let counter = 1
		while (this._entries.some((e) => e.trashName === finalName)) {
			finalName = `${trashName}__${counter++}`
		}

		const destPath = path.join(this.trashDir, finalName)

		try {
			// Prefer rename (atomic) — falls back to copy+unlink across mount points.
			try {
				await fs.rename(absolutePath, destPath)
			} catch (renameErr) {
				await fs.copyFile(absolutePath, destPath)
				await fs.unlink(absolutePath)
			}
		} catch (err) {
			this.log(`[DeletedFilesService] failed to move ${relativePath} to trash: ${err instanceof Error ? err.message : String(err)}`)
			throw err
		}

		const entry: DeletedFileEntry = {
			relativePath,
			trashedAt,
			trashName: finalName,
			size: stat.size,
		}
		this._entries.push(entry)
		await this.writeIndex()
		this.log(`[DeletedFilesService] moved to trash: ${relativePath} (${stat.size} bytes)`)
		return entry
	}

	/**
	 * Restore a file from the trash back to its original workspace path.
	 * Removes the trash entry and the trash file on success.
	 *
	 * @param relativePath - The original workspace-relative path to restore.
	 * @param options.overwrite - If true, silently overwrite an existing
	 *   file at the target path. If false (default), throw a clear error
	 *   so the caller can prompt the user for confirmation first.
	 */
	async restoreFromTrash(
		relativePath: string,
		options: { overwrite?: boolean } = {},
	): Promise<boolean> {
		if (!this.initialized) {
			await this.init()
		}
		const entry = this._entries.find((e) => e.relativePath === relativePath)
		if (!entry) return false

		const trashPath = path.join(this.trashDir, entry.trashName)
		const targetPath = path.resolve(this.workspaceDir, entry.relativePath)

		try {
			// Make sure the destination directory exists
			await fs.mkdir(path.dirname(targetPath), { recursive: true })

			// If a file already exists at the target, require explicit opt-in
			// to overwrite (the caller is expected to have prompted the user).
			if (await fileExistsAtPath(targetPath) && !options.overwrite) {
				throw new Error(`Cannot restore: ${entry.relativePath} already exists in the workspace`)
			}

			try {
				await fs.rename(trashPath, targetPath)
			} catch (renameErr) {
				await fs.copyFile(trashPath, targetPath)
				await fs.unlink(trashPath)
			}

			this._entries = this._entries.filter((e) => e.relativePath !== relativePath)
			await this.writeIndex()
			this.log(
				`[DeletedFilesService] restored: ${entry.relativePath}${options.overwrite ? " (overwrite)" : ""}`,
			)
			return true
		} catch (err) {
			this.log(`[DeletedFilesService] failed to restore ${relativePath}: ${err instanceof Error ? err.message : String(err)}`)
			throw err
		}
	}

	getEntries(): DeletedFileEntry[] {
		return this._entries.slice()
	}
}