import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

/**
 * Locates the ripgrep binary.
 *
 * Historically Roo only looked for `rg` inside the VSCode installation
 * (`vscode.env.appRoot`). That assumption breaks in three common setups:
 *
 * 1. CLI usage (`roo`), where `appRoot` is the CLI package rather than VSCode
 *    and the binary ships in the CLI's `node_modules` (or is copied to `<root>/bin/rg`).
 * 2. pnpm workspaces, where `@vscode/ripgrep` is not hoisted to `node_modules/
 *    @vscode/ripgrep` but lives under `node_modules/.pnpm/@vscode+ripgrep@x.y.z/...`.
 * 3. Installs where the `@vscode/ripgrep` postinstall script was skipped or its
 *    download failed, leaving an empty `bin/` folder - users then usually have a
 *    system `rg` on `PATH` (scoop, choco, brew, apt, ...).
 *
 * This module therefore resolves the binary from an ordered list of strategies
 * and reports every location it tried, so failures are diagnosable.
 */

const isWindows = process.platform.startsWith("win")

/** Platform specific ripgrep executable name. */
export const RIPGREP_BIN_NAME = isWindows ? "rg.exe" : "rg"

/**
 * Environment variables that may point at a ripgrep binary (or the folder that
 * contains it). `ROO_RIPGREP_PATH` is set by the CLI launcher script.
 */
const RIPGREP_ENV_VARS = ["ROO_RIPGREP_PATH", "RIPGREP_PATH", "RG_PATH"]

/** Layouts, relative to a package/project root, that may contain the binary. */
const PACKAGE_BIN_DIRS = [
	path.join("node_modules", "@vscode", "ripgrep", "bin"),
	path.join("node_modules", "vscode-ripgrep", "bin"),
	path.join("node_modules.asar.unpacked", "@vscode", "ripgrep", "bin"),
	path.join("node_modules.asar.unpacked", "vscode-ripgrep", "bin"),
	path.join("node_modules.asar.unpacked", "node_modules", "@vscode", "ripgrep", "bin"),
	// Release tarball layout: <root>/bin/rg next to the wrapper script.
	"bin",
]

/** Absolute locations used by common package managers. */
function wellKnownPaths(): string[] {
	const home = os.homedir()
	const candidates = [
		path.join(home, "scoop", "shims", RIPGREP_BIN_NAME),
		path.join(home, ".local", "bin", RIPGREP_BIN_NAME),
		path.join(home, ".cargo", "bin", RIPGREP_BIN_NAME),
		"/usr/local/bin/rg",
		"/usr/bin/rg",
		"/opt/homebrew/bin/rg",
		"/opt/local/bin/rg",
		"/snap/bin/rg",
	]

	if (isWindows) {
		candidates.push(
			path.join(process.env.ProgramData ?? "C:\\ProgramData", "chocolatey", "bin", RIPGREP_BIN_NAME),
			path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Links", RIPGREP_BIN_NAME),
		)
	}

	return candidates
}

/**
 * Directory of the current module when running as CommonJS (the extension
 * bundle). `undefined` under ESM (tests), where `__dirname` does not exist.
 */
function currentModuleDir(): string | undefined {
	try {
		// `typeof` is safe on an undeclared identifier, unlike a bare reference.
		return typeof __dirname === "string" ? __dirname : undefined
	} catch {
		return undefined
	}
}

async function isFile(candidate: string): Promise<boolean> {
	try {
		const stat = await fs.stat(candidate)
		return stat.isFile()
	} catch {
		return false
	}
}

/**
 * Yields `dir`, then each of its ancestors, closest first.
 */
function* ancestors(dir: string): Generator<string> {
	let current = path.resolve(dir)
	let previous = ""

	while (current !== previous) {
		yield current
		previous = current
		current = path.dirname(current)
	}
}

/**
 * Expands an env var value into likely binary paths. Accepts either the binary
 * itself or the directory that contains it.
 */
function expandEnvValue(value: string): string[] {
	const trimmed = value.trim()
	if (!trimmed) {
		return []
	}

	return [trimmed, path.join(trimmed, RIPGREP_BIN_NAME), path.join(trimmed, "bin", RIPGREP_BIN_NAME)]
}

/**
 * pnpm does not hoist `@vscode/ripgrep` to `<root>/node_modules/@vscode/ripgrep`
 * when it is only a transitive/optional dependency, so also look inside the
 * virtual store.
 */
async function pnpmStoreCandidates(root: string): Promise<string[]> {
	const storeDir = path.join(root, "node_modules", ".pnpm")

	let entries: string[]
	try {
		entries = await fs.readdir(storeDir)
	} catch {
		return []
	}

	return entries
		.filter((entry) => entry.startsWith("@vscode+ripgrep@") || entry.startsWith("vscode-ripgrep@"))
		.map((entry) =>
			path.join(
				storeDir,
				entry,
				"node_modules",
				entry.startsWith("@vscode+ripgrep@") ? path.join("@vscode", "ripgrep") : "vscode-ripgrep",
				"bin",
				RIPGREP_BIN_NAME,
			),
		)
}

function pathEnvCandidates(): string[] {
	const pathValue = process.env.PATH ?? process.env.Path ?? ""
	return pathValue
		.split(path.delimiter)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => path.join(entry, RIPGREP_BIN_NAME))
}

/**
 * Builds the ordered list of candidate paths to probe.
 */
async function buildCandidates(vscodeAppRoot?: string): Promise<string[]> {
	const candidates: string[] = []

	// 1. Explicit override - highest priority.
	for (const envVar of RIPGREP_ENV_VARS) {
		const value = process.env[envVar]
		if (value) {
			candidates.push(...expandEnvValue(value))
		}
	}

	// 2. The VSCode installation and every ancestor project root (handles pnpm
	//    workspaces where the CLI lives in `apps/cli` and rg is at the repo root).
	const roots = new Set<string>()

	if (vscodeAppRoot) {
		roots.add(vscodeAppRoot)
	}

	if (process.env.ROO_CLI_ROOT) {
		roots.add(process.env.ROO_CLI_ROOT)
	}

	if (process.env.ROO_EXTENSION_PATH) {
		roots.add(process.env.ROO_EXTENSION_PATH)
	}

	if (process.cwd()) {
		roots.add(process.cwd())
	}

	// The directory of the extension bundle / this module (best effort).
	const moduleDir = currentModuleDir()
	if (moduleDir) {
		roots.add(moduleDir)
	}

	// Collect every directory worth probing: the roots themselves plus all their
	// ancestors, so a hoisted/monorepo layout is still found from `apps/cli`.
	const searchDirs: string[] = []
	const seenDirs = new Set<string>()

	for (const root of roots) {
		if (!root) {
			continue
		}

		for (const dir of ancestors(root)) {
			if (!seenDirs.has(dir)) {
				seenDirs.add(dir)
				searchDirs.push(dir)
			}
		}
	}

	for (const dir of searchDirs) {
		for (const binDir of PACKAGE_BIN_DIRS) {
			candidates.push(path.join(dir, binDir, RIPGREP_BIN_NAME))
		}
	}

	// 3. pnpm virtual store - also probed for ancestors, since the store lives at
	//    the workspace root rather than next to the consuming package.
	for (const dir of searchDirs) {
		candidates.push(...(await pnpmStoreCandidates(dir)))
	}

	// 4. System install (PATH first, then conventional locations).
	candidates.push(...pathEnvCandidates(), ...wellKnownPaths())

	// De-duplicate while preserving priority order.
	return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
}

/** Locations probed by the most recent lookup - used for diagnostics. */
let lastSearchedPaths: string[] = []

/** Cached successful lookup, keyed by environment + app root. */
let cachedResult: { key: string; value: string } | null = null

function cacheKey(vscodeAppRoot?: string): string {
	return [
		vscodeAppRoot ?? "",
		...RIPGREP_ENV_VARS.map((envVar) => process.env[envVar] ?? ""),
		process.env.PATH ?? "",
		process.env.Path ?? "",
	].join("\u0000")
}

/**
 * Clears the cached lookup. Exposed for tests and for recovering from an
 * environment change at runtime (e.g. the binary being installed on demand).
 */
export function resetRipgrepBinaryCache(): void {
	cachedResult = null
	lastSearchedPaths = []
}

/**
 * Returns the locations probed by the last successful (or failed) lookup.
 */
export function getRipgrepSearchedPaths(): string[] {
	return [...lastSearchedPaths]
}

/**
 * Finds the ripgrep binary.
 *
 * @param vscodeAppRoot The VSCode/extension host application root, when known.
 * @returns The absolute path to the binary, or `undefined` when not found.
 */
export async function getBinPath(vscodeAppRoot?: string): Promise<string | undefined> {
	const key = cacheKey(vscodeAppRoot)

	if (cachedResult?.key === key) {
		return cachedResult.value
	}

	const candidates = await buildCandidates(vscodeAppRoot)
	lastSearchedPaths = candidates

	for (const candidate of candidates) {
		if (await isFile(candidate)) {
			cachedResult = { key, value: candidate }
			return candidate
		}
	}

	return undefined
}

/**
 * Formats a human readable description of where ripgrep was looked for.
 */
export function describeRipgrepSearchPaths(limit = 8): string {
	const searched = getRipgrepSearchedPaths()

	if (searched.length === 0) {
		return "No search locations recorded."
	}

	const shown = searched.slice(0, limit)
	const suffix = searched.length > limit ? `\n  ... and ${searched.length - limit} more` : ""

	return `Searched:\n  ${shown.join("\n  ")}${suffix}`
}
