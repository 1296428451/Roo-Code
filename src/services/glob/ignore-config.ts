import * as fs from "fs/promises"
import * as path from "path"

const IGNORE_CONFIG_FILE = "ignore.json"

/**
 * 默认排除目录列表（当 ignore.json 不存在或读取失败时使用）
 */
export const DEFAULT_DIRS_TO_IGNORE = [
    "node_modules",
    "__pycache__",
    "env",
    "venv",
    "target/dependency",
    "build/dependencies",
    "dist",
    "out",
    "bundle",
    "vendor",
    "tmp",
    "temp",
    "deps",
    "pkg",
    "Pods",
    ".git",
]

interface IgnoreConfig {
    DIRS_TO_IGNORE: string[]
}

/**
 * 缓存最后一次读取的值，避免重复文件 I/O
 */
let cachedDirsToIgnore: string[] | null = null
let cachedSettingsDir: string | null = null

/**
 * 确保 ignore.json 文件存在，如果不存在则创建默认值
 */
export async function ensureIgnoreConfigExists(settingsDir: string): Promise<void> {
    const configPath = path.join(settingsDir, IGNORE_CONFIG_FILE)
    try {
        await fs.access(configPath)
        // 文件已存在，不需要创建
    } catch {
        // 文件不存在，创建默认值
        const defaultConfig: IgnoreConfig = {
            DIRS_TO_IGNORE: [...DEFAULT_DIRS_TO_IGNORE],
        }
        await fs.mkdir(settingsDir, { recursive: true })
        await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8")
    }
}

/**
 * 读取 ignore.json 中的 DIRS_TO_IGNORE 配置
 * 如果文件不存在或读取失败，返回默认值
 */
export async function getDirsToIgnore(settingsDir: string): Promise<string[]> {
    const configPath = path.join(settingsDir, IGNORE_CONFIG_FILE)
    try {
        const content = await fs.readFile(configPath, "utf-8")
        const parsed = JSON.parse(content) as IgnoreConfig
        if (parsed && Array.isArray(parsed.DIRS_TO_IGNORE) && parsed.DIRS_TO_IGNORE.length > 0) {
            return parsed.DIRS_TO_IGNORE
        }
    } catch (error) {
        // 文件不存在或解析失败，使用默认值
        console.warn("[IgnoreConfig] Failed to read ignore.json, using defaults:", error)
    }
    return [...DEFAULT_DIRS_TO_IGNORE]
}

/**
 * 获取缓存的 DIRS_TO_IGNORE 配置
 * 如果 settingsDir 发生变化，会重新读取配置文件
 */
export async function getDirsToIgnoreCached(settingsDir: string): Promise<string[]> {
    if (cachedDirsToIgnore !== null && cachedSettingsDir === settingsDir) {
        return cachedDirsToIgnore
    }
    cachedDirsToIgnore = await getDirsToIgnore(settingsDir)
    cachedSettingsDir = settingsDir
    return cachedDirsToIgnore
}

/**
 * 更新 ignore.json 中的 DIRS_TO_IGNORE 配置
 */
export async function updateDirsToIgnore(settingsDir: string, dirs: string[]): Promise<void> {
    const configPath = path.join(settingsDir, IGNORE_CONFIG_FILE)
    const config: IgnoreConfig = { DIRS_TO_IGNORE: [...dirs] }
    await fs.mkdir(settingsDir, { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")
    // 清除缓存
    clearDirsToIgnoreCache()
}

/**
 * 清除缓存（当配置文件被修改时调用）
 */
export function clearDirsToIgnoreCache(): void {
    cachedDirsToIgnore = null
    cachedSettingsDir = null
}

/**
 * 基于排除目录列表生成 ripgrep 排除参数
 * 用于在递归搜索中排除指定目录
 *
 * @param dirsToIgnore 排除目录列表（由调用方提供缓存值）
 * @param targetDirName 当前正在扫描的目标目录名（可选）
 */
export function buildRipgrepExcludeArgs(dirsToIgnore: string[], targetDirName?: string): string[] {
    const args: string[] = []

    for (const dir of dirsToIgnore) {
        // Special handling for hidden directories pattern
        if (dir === ".*") {
            continue
        }

        // When explicitly targeting a directory that's in the ignore list,
        // skip adding exclusion for the target directory itself
        if (dir === targetDirName) {
            continue
        }

        // For all other cases, exclude the directory pattern globally
        args.push("-g", `!**/${dir}/**`)
    }

    return args
}
