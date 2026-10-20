#!/usr/bin/env node

/**
 * Ensures a ripgrep binary is available for the extension and the CLI.
 *
 * `@vscode/ripgrep` downloads the binary in its own postinstall script. That
 * script is silently skipped or fails in a few situations (pnpm not running
 * build scripts, blocked network, offline installs), which leaves an empty
 * `bin/` directory and breaks every file-listing/search tool at runtime with
 * "Could not find ripgrep binary".
 *
 * This script never fails the install:
 *   1. exits silently when a binary can already be resolved;
 *   2. otherwise runs the `@vscode/ripgrep` postinstall script;
 *   3. otherwise prints how to fix it manually (install ripgrep or set
 *      ROO_RIPGREP_PATH).
 */

import { spawnSync } from "child_process"
import { existsSync, readdirSync, statSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "..")
const BIN_NAME = process.platform.startsWith("win") ? "rg.exe" : "rg"

const LAYOUTS = [
	path.join("node_modules", "@vscode", "ripgrep", "bin"),
	path.join("node_modules", "vscode-ripgrep", "bin"),
	path.join("bin"),
]

function isFile(candidate) {
	try {
		return statSync(candidate).isFile()
	} catch {
		return false
	}
}

/** Directories worth probing for an installed binary. */
function searchRoots() {
	const roots = [REPO_ROOT, path.join(REPO_ROOT, "apps", "cli"), path.join(REPO_ROOT, "src")]

	for (const envVar of ["ROO_CLI_ROOT", "ROO_EXTENSION_PATH"]) {
		const value = process.env[envVar]
		if (value) {
			roots.push(value)
		}
	}

	if (process.cwd()) {
		roots.push(process.cwd())
	}

	return [...new Set(roots.map((root) => path.resolve(root)))]
}

function findExistingBinary() {
	for (const envVar of ["ROO_RIPGREP_PATH", "RIPGREP_PATH", "RG_PATH"]) {
		const value = process.env[envVar]

		if (value && isFile(value)) {
			return value
		}
	}

	for (const root of searchRoots()) {
		for (const layout of LAYOUTS) {
			const candidate = path.join(root, layout, BIN_NAME)
			if (isFile(candidate)) {
				return candidate
			}
		}
	}

	return undefined
}

/** Finds the `@vscode/ripgrep` postinstall script so we can reuse its downloader. */
function findPostinstallScript() {
	const packages = ["@vscode/ripgrep", "vscode-ripgrep"]

	for (const root of searchRoots()) {
		for (const pkg of packages) {
			const script = path.join(root, "node_modules", pkg, "lib", "postinstall.js")
			if (isFile(script)) {
				return script
			}
		}
	}

	return undefined
}

function runPostinstall(script) {
	console.log(`[ensure-ripgrep] Downloading ripgrep via ${path.relative(REPO_ROOT, script)} ...`)

	const result = spawnSync(process.execPath, [script, "--force"], {
		cwd: path.dirname(script),
		stdio: "inherit",
		env: process.env,
	})

	return result.status === 0
}

function warnManualFix() {
	console.warn(
		[
			"",
			"[ensure-ripgrep] ripgrep could not be provisioned automatically.",
			"  File listing and regex search tools will fail until this is fixed.",
			"",
			"  Fix by doing ONE of the following:",
			`    - install ripgrep system-wide (it must be on PATH as '${BIN_NAME}')`,
			"    - set ROO_RIPGREP_PATH to the absolute path of the rg binary",
			`    - place the binary at apps/cli/node_modules/@vscode/ripgrep/bin/${BIN_NAME}`,
			"",
		].join("\n"),
	)
}

function main() {
	const existing = findExistingBinary()

	if (existing) {
		console.log(`[ensure-ripgrep] Found existing binary: ${existing}`)
		return
	}

	const postinstall = findPostinstallScript()

	if (postinstall && runPostinstall(postinstall)) {
		const provisioned = findExistingBinary()

		if (provisioned) {
			console.log(`[ensure-ripgrep] Provisioned binary: ${provisioned}`)
			return
		}
	}

	// Last resort: surface any empty bin directory that hints at a skipped download.
	for (const root of searchRoots()) {
		for (const layout of LAYOUTS) {
			const dir = path.join(root, layout)

			if (existsSync(dir) && readdirSync(dir).length === 0) {
				console.warn(`[ensure-ripgrep] Empty bin directory: ${dir}`)
			}
		}
	}

	warnManualFix()
}

try {
	main()
} catch (error) {
	console.warn(`[ensure-ripgrep] Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
}

// Never break `pnpm install`.
process.exit(0)
