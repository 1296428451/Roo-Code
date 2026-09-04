/**
 * 默认排除目录列表（当 ignore.json 不存在或读取失败时使用）
 * 此常量仅作为默认值，实际使用时应通过 getDirsToIgnore() 从配置文件读取
 *
 * @deprecated 请使用 src/services/glob/ignore-config.ts 中的函数来读取配置
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
