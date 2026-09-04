import { DEFAULT_DIRS_TO_IGNORE } from "./ignore-config"

/**
 * 模块级缓存，在 SettingsStore.loadAll() 中初始化
 * 如果未初始化，使用默认值
 */
let _cachedDirsToIgnore: string[] | null = null

/**
 * 初始化缓存（在 SettingsStore.loadAll() 中调用）
 */
export function initIgnoreUtilsCache(dirs: string[]): void {
	_cachedDirsToIgnore = dirs
}

/**
 * 获取当前使用的排除目录列表
 */
function getDirsToIgnoreSync(): string[] {
	return _cachedDirsToIgnore ?? DEFAULT_DIRS_TO_IGNORE
}

/**
 * Checks if a file path should be ignored based on the DIRS_TO_IGNORE patterns.
 * This function handles special patterns like ".*" for hidden directories.
 *
 * @param filePath The file path to check
 * @returns true if the path should be ignored, false otherwise
 */
export function isPathInIgnoredDirectory(filePath: string): boolean {
	const dirsToIgnore = getDirsToIgnoreSync()

	// Normalize path separators
	const normalizedPath = filePath.replace(/\\/g, "/")
	const pathParts = normalizedPath.split("/")

	// Check each directory in the path against dirsToIgnore
	for (const part of pathParts) {
		// Skip empty parts (from leading or trailing slashes)
		if (!part) continue

		// Handle the ".*" pattern for hidden directories
		if (dirsToIgnore.includes(".*") && part.startsWith(".") && part !== ".") {
			return true
		}

		// Check for exact matches
		if (dirsToIgnore.includes(part)) {
			return true
		}
	}

	// Check if path contains any ignored directory pattern
	for (const dir of dirsToIgnore) {
		if (dir === ".*") {
			// Already handled above
			continue
		}

		// Check if the directory appears in the path
		if (normalizedPath.includes(`/${dir}/`)) {
			return true
		}
	}

	return false
}
