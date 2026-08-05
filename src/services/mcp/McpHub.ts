import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import ReconnectingEventSource from "reconnecting-eventsource"
import {
	CallToolResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
	ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
import chokidar, { FSWatcher } from "chokidar"
import delay from "delay"
import deepEqual from "fast-deep-equal"
import type { z } from "zod"

import type {
	McpResource,
	McpResourceResponse,
	McpResourceTemplate,
	McpServer,
	McpTool,
	McpToolCallResponse,
} from "@roo-code/types"

import { t } from "../../i18n"

import { ClineProvider } from "../../core/webview/ClineProvider"

import { GlobalFileNames } from "../../shared/globalFileNames"

import { fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual, getWorkspacePath } from "../../utils/path"
import { injectVariables } from "../../utils/config"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { sanitizeMcpName, toolNamesMatch } from "../../utils/mcp-name"

import {
	ServerConfigSchema,
	McpSettingsSchema,
	validateServerConfig,
} from "./mcpConfigValidator"

export { ServerConfigSchema, McpSettingsSchema } from "./mcpConfigValidator"

// Discriminated union for connection states
export type ConnectedMcpConnection = {
	type: "connected"
	server: McpServer
	client: Client
	transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
}

export type DisconnectedMcpConnection = {
	type: "disconnected"
	server: McpServer
	client: null
	transport: null
}

export type McpConnection = ConnectedMcpConnection | DisconnectedMcpConnection

// Enum for disable reasons
export enum DisableReason {
	MCP_DISABLED = "mcpDisabled",
	SERVER_DISABLED = "serverDisabled",
}

export class McpHub {
	private providerRef: WeakRef<ClineProvider>
	private provider: ClineProvider
	private disposables: vscode.Disposable[] = []

	private log(_message: string): void {
		// console.log(message)
		// try {
		// 	this.provider?.log(message)
		// } catch (_) {}
	}
	private settingsWatcher?: vscode.FileSystemWatcher
	private fileWatchers: Map<string, FSWatcher[]> = new Map()
	private projectMcpWatcher?: vscode.FileSystemWatcher
	private isDisposed: boolean = false
	connections: McpConnection[] = []
	isConnecting: boolean = false
	private refCount: number = 0 // Reference counter for active clients
	private configChangeDebounceTimers: Map<string, NodeJS.Timeout> = new Map()
	private isProgrammaticUpdate: boolean = false
	private flagResetTimer?: NodeJS.Timeout
	private sanitizedNameRegistry: Map<string, string> = new Map()
	private initializationPromise: Promise<void>

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.provider = provider
		this.watchMcpSettingsFile()
		this.watchProjectMcpFile().catch(console.error)
		this.setupWorkspaceFoldersWatcher()
		this.initializationPromise = Promise.all([
			this.initializeGlobalMcpServers(),
			this.initializeProjectMcpServers(),
		]).then(() => {})
	}

	/**
	 * Waits until all MCP servers have finished their initial connection attempts.
	 * Each server individually handles its own timeout, so this will not block indefinitely.
	 */
	async waitUntilReady(): Promise<void> {
		await this.initializationPromise
	}
	/**
	 * Registers a client (e.g., ClineProvider) using this hub.
	 * Increments the reference count.
	 */
	public registerClient(): void {
		this.refCount++
		// console.log(`McpHub: Client registered. Ref count: ${this.refCount}`)
	}

	/**
	 * Unregisters a client. Decrements the reference count.
	 * If the count reaches zero, disposes the hub.
	 */
	public async unregisterClient(): Promise<void> {
		this.refCount--

		// console.log(`McpHub: Client unregistered. Ref count: ${this.refCount}`)

		if (this.refCount <= 0) {
			console.log("McpHub: Last client unregistered. Disposing hub.")
			await this.dispose()
		}
	}

	private validateServerConfig(config: any, serverName?: string): z.infer<typeof ServerConfigSchema> {
		return validateServerConfig(config, serverName)
	}

	/**
	 * Formats and displays error messages to the user
	 * @param message The error message prefix
	 * @param error The error object
	 */
	private showErrorMessage(message: string, error: unknown): void {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error(`${message}: ${errorMessage}`)
	}

	public setupWorkspaceFoldersWatcher(): void {
		// Skip if test environment is detected
		if (process.env.NODE_ENV === "test") {
			return
		}

		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(async () => {
				await this.updateProjectMcpServers()
				await this.watchProjectMcpFile()
			}),
		)
	}

	/**
	 * Debounced wrapper for handling config file changes
	 */
	private debounceConfigChange(filePath: string, source: "global" | "project"): void {
		// Skip processing if this is a programmatic update to prevent unnecessary server restarts
		if (this.isProgrammaticUpdate) {
			return
		}

		const key = `${source}-${filePath}`

		// Clear existing timer if any
		const existingTimer = this.configChangeDebounceTimers.get(key)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}

		// Set new timer
		const timer = setTimeout(async () => {
			this.configChangeDebounceTimers.delete(key)
			await this.handleConfigFileChange(filePath, source)
		}, 500) // 500ms debounce

		this.configChangeDebounceTimers.set(key, timer)
	}

	private async handleConfigFileChange(filePath: string, source: "global" | "project"): Promise<void> {
		this.log(`[McpHub] handleConfigFileChange: filePath=${filePath}, source=${source}`)
		try {
			const content = await fs.readFile(filePath, "utf-8")
			let config: any

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, parseError)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			const result = McpSettingsSchema.safeParse(config)

			if (!result.success) {
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))
				return
			}

			this.log(`[McpHub] handleConfigFileChange: mcpServers keys=[${Object.keys(result.data.mcpServers || {}).join(", ")}], source=${source}`)
			await this.updateServerConnections(result.data.mcpServers || {}, source)
		} catch (error) {
			// Check if the error is because the file doesn't exist
			if (error.code === "ENOENT" && source === "project") {
				// File was deleted, clean up project MCP servers
				await this.cleanupProjectMcpServers()
				await this.notifyWebviewOfServerChanges()
				vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
			} else {
				this.showErrorMessage(t("mcp:errors.failed_update_project"), error)
			}
		}
	}

	private async watchProjectMcpFile(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		// Clean up existing project MCP watcher if it exists
		if (this.projectMcpWatcher) {
			this.projectMcpWatcher.dispose()
			this.projectMcpWatcher = undefined
		}

		if (!vscode.workspace.workspaceFolders?.length) {
			return
		}

		const workspaceFolder = this.provider?.cwd ?? getWorkspacePath()
		const projectMcpPattern = new vscode.RelativePattern(workspaceFolder, ".roo/mcp.json")

		// Create a file system watcher for the project MCP file pattern
		this.projectMcpWatcher = vscode.workspace.createFileSystemWatcher(projectMcpPattern)

		// Watch for file changes
		const changeDisposable = this.projectMcpWatcher.onDidChange((uri) => {
			this.debounceConfigChange(uri.fsPath, "project")
		})

		// Watch for file creation
		const createDisposable = this.projectMcpWatcher.onDidCreate((uri) => {
			this.debounceConfigChange(uri.fsPath, "project")
		})

		// Watch for file deletion
		const deleteDisposable = this.projectMcpWatcher.onDidDelete(async () => {
			// Clean up all project MCP servers when the file is deleted
			await this.cleanupProjectMcpServers()
			await this.notifyWebviewOfServerChanges()
			vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
		})

		this.disposables.push(
			vscode.Disposable.from(changeDisposable, createDisposable, deleteDisposable, this.projectMcpWatcher),
		)
	}

	private async updateProjectMcpServers(): Promise<void> {
		try {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) return

			const content = await fs.readFile(projectMcpPath, "utf-8")
			let config: any

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, parseError)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			// Validate configuration structure
			const result = McpSettingsSchema.safeParse(config)
			if (result.success) {
				await this.updateServerConnections(result.data.mcpServers || {}, "project")
			} else {
				// Format validation errors for better user feedback
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				console.error("Invalid project MCP settings format:", errorMessages)
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))
			}
		} catch (error) {
			this.showErrorMessage(t("mcp:errors.failed_update_project"), error)
		}
	}

	private async cleanupProjectMcpServers(): Promise<void> {
		// Disconnect and remove all project MCP servers
		const projectConnections = this.connections.filter((conn) => conn.server.source === "project")

		for (const conn of projectConnections) {
			await this.deleteConnection(conn.server.name, "project")
		}

		// Clear project servers from the connections list
		await this.updateServerConnections({}, "project", false)
	}

	getServers(): McpServer[] {
		// Only return enabled servers, deduplicating by name with project servers taking priority
		const enabledConnections = this.connections.filter((conn) => !conn.server.disabled)

		// Deduplicate by server name: project servers take priority over global servers
		const serversByName = new Map<string, McpServer>()
		for (const conn of enabledConnections) {
			const existing = serversByName.get(conn.server.name)
			if (!existing) {
				serversByName.set(conn.server.name, conn.server)
			} else if (conn.server.source === "project" && existing.source !== "project") {
				// Project server overrides global server with the same name
				serversByName.set(conn.server.name, conn.server)
			}
			// If existing is project and current is global, keep existing (project wins)
		}

		return Array.from(serversByName.values())
	}

	getAllServers(): McpServer[] {
		// Return all servers regardless of state
		return this.connections.map((conn) => conn.server)
	}

	async getMcpServersPath(): Promise<string> {
		const provider = this.provider
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpServersPath = await provider.ensureMcpServersDirectoryExists()
		return mcpServersPath
	}

	async getMcpSettingsFilePath(): Promise<string> {
		const provider = this.provider
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpSettingsFilePath = path.join(
			await provider.ensureSettingsDirectoryExists(),
			GlobalFileNames.mcpSettings,
		)
		const fileExists = await fileExistsAtPath(mcpSettingsFilePath)
		if (!fileExists) {
			await fs.writeFile(
				mcpSettingsFilePath,
				`{
  "mcpServers": {

  }
}`,
			)
		}
		return mcpSettingsFilePath
	}

	private async watchMcpSettingsFile(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		// Clean up existing settings watcher if it exists
		if (this.settingsWatcher) {
			this.settingsWatcher.dispose()
			this.settingsWatcher = undefined
		}

		const settingsPath = await this.getMcpSettingsFilePath()
		this.log(`[McpHub] watchMcpSettingsFile: settingsPath=${settingsPath}`)

		// Sync the file with the global config when the file was just created with empty
		// "mcpServers" by getMcpSettingsFilePath(). This prevents a race condition where the
		// OS delivers a delayed file-creation notification after the watcher is set up, which
		// would cause handleConfigFileChange to read the empty file and delete all connections.
		const provider = this.provider
		if (provider) {
			try {
				const content = await fs.readFile(settingsPath, "utf-8")
				this.log(`[McpHub] watchMcpSettingsFile: file content before sync: ${content.slice(0, 200)}`)
				const config = JSON.parse(content)
				if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
					const globalConfigServers = provider.getMcpServersFromGlobalConfig()
					this.log(`[McpHub] watchMcpSettingsFile: globalConfigServers keys=${globalConfigServers ? JSON.stringify(Object.keys(globalConfigServers)) : "undefined"}`)
					if (
						globalConfigServers &&
						typeof globalConfigServers === "object" &&
						!Array.isArray(globalConfigServers) &&
						Object.keys(globalConfigServers).length > 0
					) {
						await safeWriteJson(settingsPath, { mcpServers: globalConfigServers }, { prettyPrint: true })
						this.log(`[McpHub] watchMcpSettingsFile: synced file with global config, count=${Object.keys(globalConfigServers).length}`)
					}
				} else {
					this.log(`[McpHub] watchMcpSettingsFile: file already has mcpServers, count=${Object.keys(config.mcpServers).length}`)
				}
			} catch (_) {
				// If the file can't be read or parsed, that's fine — the watcher will handle
				// changes once the file is properly written by the user or programmatic updates.
				this.log(`[McpHub] watchMcpSettingsFile: error reading/syncing file: ${_}`)
			}
		}

		const settingsUri = vscode.Uri.file(settingsPath)
		const settingsPattern = new vscode.RelativePattern(path.dirname(settingsPath), path.basename(settingsPath))

		// Create a file system watcher for the global MCP settings file
		this.settingsWatcher = vscode.workspace.createFileSystemWatcher(settingsPattern)

		// Watch for file changes
		const changeDisposable = this.settingsWatcher.onDidChange((uri) => {
			if (arePathsEqual(uri.fsPath, settingsPath)) {
				this.debounceConfigChange(settingsPath, "global")
			}
		})

		// Watch for file creation
		const createDisposable = this.settingsWatcher.onDidCreate((uri) => {
			if (arePathsEqual(uri.fsPath, settingsPath)) {
				this.debounceConfigChange(settingsPath, "global")
			}
		})

		this.disposables.push(vscode.Disposable.from(changeDisposable, createDisposable, this.settingsWatcher))
	}

	private async initializeMcpServers(source: "global" | "project"): Promise<void> {
		try {
			let mcpServers: Record<string, any> = {}

			if (source === "global") {
				const provider = this.provider
				this.log(`[McpHub] initializeMcpServers global: provider=${provider ? "exists" : "undefined"}`)
				if (provider) {
					const globalConfigServers = provider.getMcpServersFromGlobalConfig()
					this.log(`[McpHub] getMcpServersFromGlobalConfig: keys=${globalConfigServers ? JSON.stringify(Object.keys(globalConfigServers)) : "undefined"}`)
					if (globalConfigServers && Object.keys(globalConfigServers).length > 0) {
						mcpServers = globalConfigServers
						this.log(`[McpHub] Using globalConfigServers: count=${Object.keys(mcpServers).length}`)
					}
				}

				if (Object.keys(mcpServers).length === 0) {
					this.log(`[McpHub] globalConfigServers empty, trying mcp_settings.json fallback`)
					const configPath = await this.getMcpSettingsFilePath()
					if (configPath) {
						const content = await fs.readFile(configPath, "utf-8")
						const config = JSON.parse(content)
						const result = McpSettingsSchema.safeParse(config)
						if (result.success) {
							mcpServers = result.data.mcpServers || {}
							this.log(`[McpHub] mcp_settings.json loaded: count=${Object.keys(mcpServers).length}`)
						}
					}
				}
			} else {
				const configPath = await this.getProjectMcpPath()
				if (!configPath) {
					return
				}
				const content = await fs.readFile(configPath, "utf-8")
				const config = JSON.parse(content)
				const result = McpSettingsSchema.safeParse(config)
				if (result.success) {
					mcpServers = result.data.mcpServers || {}
				}
			}

			// console.log(`[McpHub] updateServerConnections: source=${source}, count=${Object.keys(mcpServers).length}`)
			await this.updateServerConnections(mcpServers, source, false)
		} catch (error) {
			// console.error(`[McpHub] initializeMcpServers ${source} FAILED:`, error)
			if (error instanceof SyntaxError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, error)
				vscode.window.showErrorMessage(errorMessage)
			} else {
				this.showErrorMessage(`Failed to initialize ${source} MCP servers`, error)
			}
		}
	}

	private async initializeGlobalMcpServers(): Promise<void> {
		await this.initializeMcpServers("global")
	}

	// Get project-level MCP configuration path
	private async getProjectMcpPath(): Promise<string | null> {
		const workspacePath = this.provider?.cwd ?? getWorkspacePath()
		const projectMcpDir = path.join(workspacePath, ".roo")
		const projectMcpPath = path.join(projectMcpDir, "mcp.json")

		try {
			await fs.access(projectMcpPath)
			return projectMcpPath
		} catch {
			return null
		}
	}

	// Initialize project-level MCP servers
	private async initializeProjectMcpServers(): Promise<void> {
		await this.initializeMcpServers("project")
	}

	/**
	 * Creates a placeholder connection for disabled servers or when MCP is globally disabled
	 * @param name The server name
	 * @param config The server configuration
	 * @param source The source of the server (global or project)
	 * @param reason The reason for creating a placeholder (mcpDisabled or serverDisabled)
	 * @returns A placeholder DisconnectedMcpConnection object
	 */
	private createPlaceholderConnection(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project",
		reason: DisableReason,
	): DisconnectedMcpConnection {
		return {
			type: "disconnected",
			server: {
				name,
				config: JSON.stringify(config),
				status: "disconnected",
				disabled: reason === DisableReason.SERVER_DISABLED ? true : config.disabled,
				source,
				projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
				errorHistory: [],
			},
			client: null,
			transport: null,
		}
	}

	/**
	 * Checks if MCP is globally enabled
	 * @returns Promise<boolean> indicating if MCP is enabled
	 */
	private async isMcpEnabled(): Promise<boolean> {
		const provider = this.provider
		if (!provider) {
			return true
		}
		const enabled = provider.getMcpEnabledFromGlobalConfig()
		return enabled
	}

	private async connectToServer(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project" = "global",
	): Promise<void> {
		// console.log(`[McpHub] connectToServer: name=${name}, source=${source}, type=${config.type}, disabled=${config.disabled}`)
		this.log(`[McpHub] connectToServer: name=${name}, source=${source}, type=${config.type}, disabled=${config.disabled}`)
		// Remove existing connection if it exists with the same source
		await this.deleteConnection(name, source)

		// Register the sanitized name for O(1) lookup
		const sanitizedName = sanitizeMcpName(name)
		this.sanitizedNameRegistry.set(sanitizedName, name)

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			// Still create a connection object to track the server, but don't actually connect
			const connection = this.createPlaceholderConnection(name, config, source, DisableReason.MCP_DISABLED)
			this.connections.push(connection)
			return
		}

		// Skip connecting to disabled servers
		if (config.disabled) {
			// Still create a connection object to track the server, but don't actually connect
			const connection = this.createPlaceholderConnection(name, config, source, DisableReason.SERVER_DISABLED)
			this.connections.push(connection)
			return
		}

		// Set up file watchers for enabled servers
		this.setupFileWatcher(name, config, source)

		// Push a placeholder connection BEFORE any potentially failing operations (e.g., new Client,
		// injectVariables). This ensures the server always appears in the settings page even if
		// initialization fails early.
		const placeholderConn = this.createPlaceholderConnection(name, config, source, DisableReason.SERVER_DISABLED)
		placeholderConn.server.disabled = false
		placeholderConn.server.status = "connecting"
		this.connections.push(placeholderConn)
		this.log(`[McpHub] connectToServer: placeholder pushed for ${name}, connections count=${this.connections.length}`)

		try {
			const client = new Client(
				{
					name: "Roo Code",
					version: this.provider?.context.extension?.packageJSON?.version ?? "1.0.0",
				},
				{
					capabilities: {},
				},
			)

			let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

			// Inject variables to the config (environment, magic variables,...)
			const configInjected = (await injectVariables(config, {
				env: process.env,
				workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
			})) as typeof config

			// Remove the placeholder and push the real connection
			this.connections = this.connections.filter((c) => c !== placeholderConn)
			const connection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name,
					config: JSON.stringify(configInjected),
					status: "connecting",
					disabled: configInjected.disabled,
					source,
					projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
					errorHistory: [],
				},
				client,
				transport: null as any,
			}
			this.connections.push(connection)
			this.log(`[McpHub] connectToServer: real connection pushed for ${name}, connections count=${this.connections.length}`)

			await this.notifyWebviewOfServerChanges()

			// Compute connect timeout early so SSE ReconnectingEventSource can use it
			const connectTimeoutMs = (configInjected.timeout ?? 60) * 1000

			if (configInjected.type === "stdio") {
				// On Windows, wrap commands with cmd.exe to handle non-exe executables like npx.ps1
				// This is necessary for node version managers (fnm, nvm-windows, volta) that implement
				// commands as PowerShell scripts rather than executables.
				// Note: This adds a small overhead as commands go through an additional shell layer.
				const isWindows = process.platform === "win32"

				// Check if command is already cmd.exe to avoid double-wrapping
				const isAlreadyWrapped =
					configInjected.command.toLowerCase() === "cmd.exe" || configInjected.command.toLowerCase() === "cmd"

				const command = isWindows && !isAlreadyWrapped ? "cmd.exe" : configInjected.command
				const args =
					isWindows && !isAlreadyWrapped
						? ["/c", configInjected.command, ...(configInjected.args || [])]
						: configInjected.args

				transport = new StdioClientTransport({
					command,
					args,
					cwd: configInjected.cwd,
					env: {
						...getDefaultEnvironment(),
						...(configInjected.env || {}),
					},
					stderr: "pipe",
				})
				connection.transport = transport

				// Set up stdio specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}":`, error)
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
				}

				// transport.stderr is only available after the process has been started. However we can't start it separately from the .connect() call because it also starts the transport. And we can't place this after the connect call since we need to capture the stderr stream before the connection is established, in order to capture errors during the connection process.
				// As a workaround, we start the transport ourselves, and then monkey-patch the start method to no-op so that .connect() doesn't try to start it again.
				await transport.start()
				const stderrStream = transport.stderr
				if (stderrStream) {
					stderrStream.on("data", async (data: Buffer) => {
						const output = data.toString()
						// Check if output contains INFO level log
						const isInfoLog = /INFO/i.test(output)

						if (isInfoLog) {
							// Log normal informational messages
							console.log(`Server "${name}" info:`, output)
						} else {
							// Treat as error log
							console.error(`Server "${name}" stderr:`, output)
							const connection = this.findConnection(name, source)
							if (connection) {
								this.appendErrorMessage(connection, output)
								if (connection.server.status === "disconnected") {
									await this.notifyWebviewOfServerChanges()
								}
							}
						}
					})
				} else {
					console.error(`No stderr stream for ${name}`)
				}
			} else if (configInjected.type === "streamable-http") {
				// Streamable HTTP connection
				transport = new StreamableHTTPClientTransport(new URL(configInjected.url), {
					requestInit: {
						headers: configInjected.headers,
					},
				})
				connection.transport = transport

				// Set up Streamable HTTP specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}" (streamable-http):`, error)
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
				}
			} else if (configInjected.type === "sse") {
				// SSE connection
				const sseOptions = {
					requestInit: {
						headers: configInjected.headers,
					},
				}
				// Configure ReconnectingEventSource options
				const reconnectingEventSourceOptions = {
					max_retry_time: connectTimeoutMs, // Match the connect timeout for retry duration
					withCredentials: configInjected.headers?.["Authorization"] ? true : false, // Enable credentials if Authorization header exists
					onopen: (event: Event) => {
						// ReconnectingEventSource fires this when a connection is (re)established.
						// Update the server status and clear any error so the UI reflects the
						// actual connection state.
						const connection = this.findConnection(name, source)
						if (connection) {
							connection.server.status = "connected"
							connection.server.error = ""
						}
						this.notifyWebviewOfServerChanges()
					},
					fetch: (url: string | URL, init: RequestInit) => {
						const headers = new Headers({ ...(init?.headers || {}), ...(configInjected.headers || {}) })
						return fetch(url, {
							...init,
							headers,
						})
					},
				}
				global.EventSource = ReconnectingEventSource
				transport = new SSEClientTransport(new URL(configInjected.url), {
					...sseOptions,
					eventSourceInit: reconnectingEventSourceOptions,
				})
				connection.transport = transport

				// Set up SSE specific error handling
				// ReconnectingEventSource handles reconnection automatically, so transient
				// errors (502, 504, etc.) during reconnection should NOT set the server
				// to "disconnected" or populate the error field.
				//
				// Note: SSEClientTransport does NOT support an "onopen" callback.
				// Reconnection status updates are handled by client.connect() completing
				// successfully. The onerror handler only clears stale error messages.
				// The onclose handler only fires on permanent disconnection (after all
				// ReconnectingEventSource retries are exhausted).
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}" (SSE, will auto-retry):`, error)
					// Explicitly clear the error field so the UI doesn't show a transient error
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.error = ""
					}
					await this.notifyWebviewOfServerChanges()
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
				}
			} else {
				// Should not happen if validateServerConfig is correct
				throw new Error(`Unsupported MCP server type: ${(configInjected as any).type}`)
			}

			// Only override transport.start for stdio transports that have already been started
			if (configInjected.type === "stdio") {
				transport.start = async () => {}
			}

			// Connect with per-server configurable timeout
			const connectResult = await Promise.race([
				client.connect(transport).then(() => "connected" as const),
				new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), connectTimeoutMs)),
			])

			if (connectResult === "timeout") {
				const errorMsg = `Connection to MCP server "${name}" timed out after ${configInjected.timeout ?? 60}s`
				console.warn(errorMsg)
				connection.server.status = "disconnected"
				connection.server.error = errorMsg
				this.appendErrorMessage(connection, errorMsg, "warn")
				return
			}

			// console.log(`[McpHub] connectToServer: ${name} connected successfully`)
			connection.server.status = "connected"
			connection.server.error = ""
			connection.server.instructions = client.getInstructions()

			connection.server.tools = await this.fetchToolsList(name, source)
			connection.server.resources = await this.fetchResourcesList(name, source)
			connection.server.resourceTemplates = await this.fetchResourceTemplatesList(name, source)
		} catch (error) {
			const connection = this.findConnection(name, source)
			if (connection) {
				const errorMsg = error instanceof Error ? error.message : `${error}`
				// console.log(`[McpHub] connectToServer catch: name=${name}, type=${config.type}, errorMsg=${errorMsg.substring(0, 200)}`)
				// For SSE with ReconnectingEventSource, transient HTTP errors (502, 504)
				// during initial connection are expected to be resolved by auto-reconnection.
				// Don't mark as disconnected or set the error field — let the transport's
				// onclose handler handle permanent disconnection.
				if (config.type === "sse" && /Non-200 status code/i.test(errorMsg)) {
					// console.warn(`[McpHub] SSE transient error for "${name}" (will auto-retry): ${errorMsg}`)
				} else {
					connection.server.status = "disconnected"
					this.appendErrorMessage(connection, errorMsg)
				}
			}
			console.error(`Failed to connect to MCP server "${name}":`, error)
		}
	}

	private appendErrorMessage(connection: McpConnection, error: string, level: "error" | "warn" | "info" = "error") {
		const MAX_ERROR_LENGTH = 1000
		const truncatedError =
			error.length > MAX_ERROR_LENGTH
				? `${error.substring(0, MAX_ERROR_LENGTH)}...(error message truncated)`
				: error

		// Add to error history
		if (!connection.server.errorHistory) {
			connection.server.errorHistory = []
		}

		connection.server.errorHistory.push({
			message: truncatedError,
			timestamp: Date.now(),
			level,
		})

		// Keep only the last 100 errors
		if (connection.server.errorHistory.length > 100) {
			connection.server.errorHistory = connection.server.errorHistory.slice(-100)
		}

		// Update current error display
		connection.server.error = truncatedError
	}

	/**
	 * Helper method to find a connection by server name and source
	 * @param serverName The name of the server to find
	 * @param source Optional source to filter by (global or project)
	 * @returns The matching connection or undefined if not found
	 */
	private findConnection(serverName: string, source?: "global" | "project"): McpConnection | undefined {
		// If source is specified, only find servers with that source
		if (source !== undefined) {
			return this.connections.find((conn) => conn.server.name === serverName && conn.server.source === source)
		}

		// If no source is specified, first look for project servers, then global servers
		// This ensures that when servers have the same name, project servers are prioritized
		const projectConn = this.connections.find(
			(conn) => conn.server.name === serverName && conn.server.source === "project",
		)
		if (projectConn) return projectConn

		// If no project server is found, look for global servers
		return this.connections.find(
			(conn) => conn.server.name === serverName && (conn.server.source === "global" || !conn.server.source),
		)
	}

	/**
	 * Find a connection by sanitized server name.
	 * This is used when parsing MCP tool responses where the server name has been
	 * sanitized (e.g., hyphens replaced with underscores) for API compliance.
	 * Uses fuzzy matching to handle cases where models convert hyphens to underscores.
	 * @param sanitizedServerName The sanitized server name from the API tool call
	 * @returns The original server name if found, or null if no match
	 */
	public findServerNameBySanitizedName(sanitizedServerName: string): string | null {
		// First, check for an exact match
		const exactMatch = this.connections.find((conn) => conn.server.name === sanitizedServerName)
		if (exactMatch) {
			return exactMatch.server.name
		}

		// Check the registry for sanitized name mapping
		const registryMatch = this.sanitizedNameRegistry.get(sanitizedServerName)
		if (registryMatch) {
			return registryMatch
		}

		// Use fuzzy matching: treat hyphens and underscores as equivalent
		const fuzzyMatch = this.connections.find((conn) => toolNamesMatch(conn.server.name, sanitizedServerName))
		if (fuzzyMatch) {
			return fuzzyMatch.server.name
		}

		return null
	}

	private async fetchToolsList(serverName: string, source?: "global" | "project"): Promise<McpTool[]> {
		try {
			// Use the helper method to find the connection
			const connection = this.findConnection(serverName, source)

			if (!connection || connection.type !== "connected") {
				return []
			}

			let response: z.infer<typeof ListToolsResultSchema> | null = null
			try {
				response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema)
			} catch (firstError) {
				console.warn(`[McpHub] First tools/list attempt failed for ${serverName}:`, firstError)
				// Retry once after a short delay (SSE timing issues can cause incomplete results)
				await delay(2000)
				try {
					response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema)
				} catch (retryError) {
					console.error(`[McpHub] Retry tools/list also failed for ${serverName}:`, retryError)
					return []
				}
			}
			if (!response) {
				return []
			}

			// Determine the actual source of the server
			const actualSource = connection.server.source || "global"
			let configPath: string
			let alwaysAllowConfig: string[] = []
			let disabledToolsList: string[] = []

			// Read from the appropriate config file based on the actual source
			try {
				let serverConfigData: Record<string, any> = {}
				if (actualSource === "project") {
					// Get project MCP config path
					const projectMcpPath = await this.getProjectMcpPath()
					if (projectMcpPath) {
						configPath = projectMcpPath
						const content = await fs.readFile(configPath, "utf-8")
						serverConfigData = JSON.parse(content)
					}
				} else {
					// Get global MCP settings path
					configPath = await this.getMcpSettingsFilePath()
					const content = await fs.readFile(configPath, "utf-8")
					serverConfigData = JSON.parse(content)
				}
				if (serverConfigData) {
					alwaysAllowConfig = serverConfigData.mcpServers?.[serverName]?.alwaysAllow || []
					disabledToolsList = serverConfigData.mcpServers?.[serverName]?.disabledTools || []
				}
			} catch (error) {
				console.error(`Failed to read tool configuration for ${serverName}:`, error)
				// Continue with empty configs
			}

			// Check if wildcard "*" is in the alwaysAllow config
			const hasWildcard = alwaysAllowConfig.includes("*")

			// Mark tools as always allowed and enabled for prompt based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				alwaysAllow: hasWildcard || alwaysAllowConfig.includes(tool.name),
				enabledForPrompt: !disabledToolsList.includes(tool.name),
			}))

			return tools
		} catch (error) {
			console.error(`Failed to fetch tools for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourcesList(serverName: string, source?: "global" | "project"): Promise<McpResource[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema)
			return response?.resources || []
		} catch (error) {
			// console.error(`Failed to fetch resources for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourceTemplatesList(
		serverName: string,
		source?: "global" | "project",
	): Promise<McpResourceTemplate[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
			)
			return response?.resourceTemplates || []
		} catch (error) {
			// console.error(`Failed to fetch resource templates for ${serverName}:`, error)
			return []
		}
	}

	async deleteConnection(name: string, source?: "global" | "project"): Promise<void> {
		// Clean up file watchers for this server
		this.removeFileWatchersForServer(name)

		// If source is provided, only delete connections from that source
		const connections = source
			? this.connections.filter((conn) => conn.server.name === name && conn.server.source === source)
			: this.connections.filter((conn) => conn.server.name === name)

		for (const connection of connections) {
			try {
				if (connection.type === "connected") {
					await connection.transport.close()
					await connection.client.close()
				}
			} catch (error) {
				console.error(`Failed to close transport for ${name}:`, error)
			}
		}

		// Remove the connections from the array
		this.connections = this.connections.filter((conn) => {
			if (conn.server.name !== name) return true
			if (source && conn.server.source !== source) return true
			return false
		})

		// Remove from sanitized name registry if no more connections with this name exist
		const remainingConnections = this.connections.filter((conn) => conn.server.name === name)
		if (remainingConnections.length === 0) {
			const sanitizedName = sanitizeMcpName(name)
			this.sanitizedNameRegistry.delete(sanitizedName)
		}
	}

	async updateServerConnections(
		newServers: Record<string, any>,
		source: "global" | "project" = "global",
		manageConnectingState: boolean = true,
	): Promise<void> {
		// console.log(`[McpHub] updateServerConnections: source=${source}, newServers keys=[${Object.keys(newServers).join(", ")}], manageConnectingState=${manageConnectingState}`)
		this.log(`[McpHub] updateServerConnections: source=${source}, newServers keys=[${Object.keys(newServers).join(", ")}], manageConnectingState=${manageConnectingState}`)
		if (manageConnectingState) {
			this.isConnecting = true
		}
		try {
		this.removeAllFileWatchers()
		// Filter connections by source
		const currentConnections = this.connections.filter(
			(conn) => conn.server.source === source || (!conn.server.source && source === "global"),
		)
		const currentNames = new Set(currentConnections.map((conn) => conn.server.name))
		const newNames = new Set(Object.keys(newServers))

		// Delete removed servers
		for (const name of currentNames) {
			if (!newNames.has(name)) {
				await this.deleteConnection(name, source)
			}
		}

		// Update or add servers
		for (const [name, config] of Object.entries(newServers)) {
			// Only consider connections that match the current source
			const currentConnection = this.findConnection(name, source)

			// Validate and transform the config
			let validatedConfig: z.infer<typeof ServerConfigSchema>
			try {
				validatedConfig = this.validateServerConfig(config, name)
			} catch (error) {
				this.showErrorMessage(`Invalid configuration for MCP server "${name}"`, error)
				continue
			}

			if (!currentConnection) {
				// New server
				try {
					// Only setup file watcher for enabled servers
					if (!validatedConfig.disabled) {
						this.setupFileWatcher(name, validatedConfig, source)
					}
					await this.connectToServer(name, validatedConfig, source)
				} catch (error) {
					this.showErrorMessage(`Failed to connect to new MCP server ${name}`, error)
				}
			} else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed config
				try {
					// Only setup file watcher for enabled servers
					if (!validatedConfig.disabled) {
						this.setupFileWatcher(name, validatedConfig, source)
					}
					await this.deleteConnection(name, source)
					await this.connectToServer(name, validatedConfig, source)
				} catch (error) {
					this.showErrorMessage(`Failed to reconnect MCP server ${name}`, error)
				}
			}
			// If server exists with same config, do nothing
		}
		this.log(`[McpHub] updateServerConnections complete: connections count=${this.connections.length}, names=[${this.connections.map(c => c.server.name).join(", ")}]`)
		await this.notifyWebviewOfServerChanges()
		} finally {
			if (manageConnectingState) {
				this.isConnecting = false
			}
		}
	}

	private setupFileWatcher(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project" = "global",
	) {
		// Initialize an empty array for this server if it doesn't exist
		if (!this.fileWatchers.has(name)) {
			this.fileWatchers.set(name, [])
		}

		const watchers = this.fileWatchers.get(name) || []

		// Only stdio type has args
		if (config.type === "stdio") {
			// Setup watchers for custom watchPaths if defined
			if (config.watchPaths && config.watchPaths.length > 0) {
				const watchPathsWatcher = chokidar.watch(config.watchPaths, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true,
				})

				watchPathsWatcher.on("change", async (changedPath) => {
					try {
						// Pass the source from the config to restartConnection
						await this.restartConnection(name, source)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${changedPath}:`, error)
					}
				})

				watchers.push(watchPathsWatcher)
			}

			// Also setup the fallback build/index.js watcher if applicable
			const filePath = config.args?.find((arg: string) => arg.includes("build/index.js"))
			if (filePath) {
				// we use chokidar instead of onDidSaveTextDocument because it doesn't require the file to be open in the editor
				const indexJsWatcher = chokidar.watch(filePath, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true, // This helps with atomic writes
				})

				indexJsWatcher.on("change", async () => {
					try {
						// Pass the source from the config to restartConnection
						await this.restartConnection(name, source)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${filePath}:`, error)
					}
				})

				watchers.push(indexJsWatcher)
			}

			// Update the fileWatchers map with all watchers for this server
			if (watchers.length > 0) {
				this.fileWatchers.set(name, watchers)
			}
		}
	}

	private removeAllFileWatchers() {
		this.fileWatchers.forEach((watchers) => watchers.forEach((watcher) => watcher.close()))
		this.fileWatchers.clear()
	}

	private removeFileWatchersForServer(serverName: string) {
		const watchers = this.fileWatchers.get(serverName)
		if (watchers) {
			watchers.forEach((watcher) => watcher.close())
			this.fileWatchers.delete(serverName)
		}
	}

	async restartConnection(serverName: string, source?: "global" | "project"): Promise<void> {
		this.isConnecting = true
		try {

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			return
		}

		// Get existing connection and update its status
		const connection = this.findConnection(serverName, source)
		const config = connection?.server.config
		if (config) {
			vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }))
			connection.server.status = "connecting"
			connection.server.error = ""
			await this.notifyWebviewOfServerChanges()
			await delay(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName, connection.server.source)
				// Parse the config to validate it
				const parsedConfig = JSON.parse(config)
				try {
					// Validate the config
					const validatedConfig = this.validateServerConfig(parsedConfig, serverName)

					// Try to connect again using validated config
					await this.connectToServer(serverName, validatedConfig, connection.server.source || "global")
					vscode.window.showInformationMessage(t("mcp:info.server_connected", { serverName }))
				} catch (validationError) {
					this.showErrorMessage(`Invalid configuration for MCP server "${serverName}"`, validationError)
				}
			} catch (error) {
				this.showErrorMessage(`Failed to restart ${serverName} MCP server connection`, error)
			}
		}

		await this.notifyWebviewOfServerChanges()
		} finally {
			this.isConnecting = false
		}
	}

	public async refreshAllConnections(): Promise<void> {
		if (this.isConnecting) {
			return
		}

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			// Clear all existing connections
			const existingConnections = [...this.connections]
			for (const conn of existingConnections) {
				await this.deleteConnection(conn.server.name, conn.server.source)
			}

			// Still initialize servers to track them, but they won't connect
			await this.initializeMcpServers("global")
			await this.initializeMcpServers("project")

			await this.notifyWebviewOfServerChanges()
			return
		}

		this.isConnecting = true

		try {
			// Clear all existing connections first
			const existingConnections = [...this.connections]
			for (const conn of existingConnections) {
				await this.deleteConnection(conn.server.name, conn.server.source)
			}

			// Re-initialize all servers from scratch
			// This ensures proper initialization including fetching tools, resources, etc.
			await this.initializeMcpServers("global")
			await this.initializeMcpServers("project")

			await delay(100)

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage("Failed to refresh MCP servers", error)
		} finally {
			this.isConnecting = false
		}
	}

	public async notifyWebviewOfServerChanges(): Promise<void> {
		// Get global server order from settings file
		const settingsPath = await this.getMcpSettingsFilePath()
		const content = await fs.readFile(settingsPath, "utf-8")
		const config = JSON.parse(content)
		const globalServerOrder = Object.keys(config.mcpServers || {})

		// Get project server order if available
		const projectMcpPath = await this.getProjectMcpPath()
		let projectServerOrder: string[] = []
		if (projectMcpPath) {
			try {
				const projectContent = await fs.readFile(projectMcpPath, "utf-8")
				const projectConfig = JSON.parse(projectContent)
				projectServerOrder = Object.keys(projectConfig.mcpServers || {})
			} catch (error) {
				// Silently continue with empty project server order
			}
		}

		// Sort connections: first project servers in their defined order, then global servers in their defined order
		// This ensures that when servers have the same name, project servers are prioritized
		const sortedConnections = [...this.connections].sort((a, b) => {
			const aIsGlobal = a.server.source === "global" || !a.server.source
			const bIsGlobal = b.server.source === "global" || !b.server.source

			// If both are global or both are project, sort by their respective order
			if (aIsGlobal && bIsGlobal) {
				const indexA = globalServerOrder.indexOf(a.server.name)
				const indexB = globalServerOrder.indexOf(b.server.name)
				return indexA - indexB
			} else if (!aIsGlobal && !bIsGlobal) {
				const indexA = projectServerOrder.indexOf(a.server.name)
				const indexB = projectServerOrder.indexOf(b.server.name)
				return indexA - indexB
			}

			// Project servers come before global servers (reversed from original)
			return aIsGlobal ? 1 : -1
		})

		// Send sorted servers to webview
		const targetProvider: ClineProvider | undefined = this.provider

		if (targetProvider) {
			const serversToSend = sortedConnections.map((connection) => connection.server)
			// console.log(`[McpHub] notifyWebview: sending ${serversToSend.length} servers to webview: ${serversToSend.map((s) => `${s.name}:${s.status}:${s.error ? s.error.substring(0, 50) : "none"}`).join(", ")}`)

			const message = {
				type: "mcpServers" as const,
				mcpServers: serversToSend,
			}

			try {
				await targetProvider.postMessageToWebview(message)
			} catch (error) {
				console.error("Error calling targetProvider.postMessageToWebview:", error)
			}
		} else {
			console.error(
				"No target provider available (neither from getInstance nor providerRef) - cannot send mcpServers message to webview",
			)
		}
	}

	public async toggleServerDisabled(
		serverName: string,
		disabled: boolean,
		source?: "global" | "project",
	): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			const serverSource = connection.server.source || "global"
			// Update the server config in the appropriate file
			await this.updateServerConfig(serverName, { disabled }, serverSource)

			// Update the connection object
			if (connection) {
				try {
					connection.server.disabled = disabled

					// If disabling a connected server, disconnect it
					if (disabled && connection.server.status === "connected") {
						// Clean up file watchers when disabling
						this.removeFileWatchersForServer(serverName)
						await this.deleteConnection(serverName, serverSource)
						// Re-add as a disabled connection
						// Re-read config from file to get updated disabled state
						const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource)
						await this.connectToServer(serverName, updatedConfig, serverSource)
					} else if (!disabled && connection.server.status === "disconnected") {
						// If enabling a disabled server, connect it
						// Re-read config from file to get updated disabled state
						const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource)
						await this.deleteConnection(serverName, serverSource)
						// When re-enabling, file watchers will be set up in connectToServer
						await this.connectToServer(serverName, updatedConfig, serverSource)
					} else if (connection.server.status === "connected") {
						// Only refresh capabilities if connected
						connection.server.tools = await this.fetchToolsList(serverName, serverSource)
						connection.server.resources = await this.fetchResourcesList(serverName, serverSource)
						connection.server.resourceTemplates = await this.fetchResourceTemplatesList(
							serverName,
							serverSource,
						)
					}
				} catch (error) {
					console.error(`Failed to refresh capabilities for ${serverName}:`, error)
				}
			}

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage(`Failed to update server ${serverName} state`, error)
			throw error
		}
	}

	/**
	 * Helper method to read a server's configuration from the appropriate settings file
	 * @param serverName The name of the server to read
	 * @param source Whether to read from the global or project config
	 * @returns The validated server configuration
	 */
	private async readServerConfigFromFile(
		serverName: string,
		source: "global" | "project" = "global",
	): Promise<z.infer<typeof ServerConfigSchema>> {
		// Determine which config file to read
		let configPath: string
		if (source === "project") {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			configPath = await this.getMcpSettingsFilePath()
		}

		// Ensure the settings file exists and is accessible
		try {
			await fs.access(configPath)
		} catch (error) {
			console.error("Settings file not accessible:", error)
			throw new Error("Settings file not accessible")
		}

		// Read and parse the config file
		const content = await fs.readFile(configPath, "utf-8")
		const config = JSON.parse(content)

		// Validate the config structure
		if (!config || typeof config !== "object") {
			throw new Error("Invalid config structure")
		}

		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			throw new Error("No mcpServers section in config")
		}

		if (!config.mcpServers[serverName]) {
			throw new Error(`Server ${serverName} not found in config`)
		}

		// Validate and return the server config
		return this.validateServerConfig(config.mcpServers[serverName], serverName)
	}

	/**
	 * Helper method to update a server's configuration in the appropriate settings file
	 * @param serverName The name of the server to update
	 * @param configUpdate The configuration updates to apply
	 * @param source Whether to update the global or project config
	 */
	private async updateServerConfig(
		serverName: string,
		configUpdate: Record<string, any>,
		source: "global" | "project" = "global",
	): Promise<void> {
		// Determine which config file to update
		let configPath: string
		if (source === "project") {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			configPath = await this.getMcpSettingsFilePath()
		}

		// Ensure the settings file exists and is accessible
		try {
			await fs.access(configPath)
		} catch (error) {
			console.error("Settings file not accessible:", error)
			throw new Error("Settings file not accessible")
		}

		// Read and parse the config file
		const content = await fs.readFile(configPath, "utf-8")
		const config = JSON.parse(content)

		// Validate the config structure
		if (!config || typeof config !== "object") {
			throw new Error("Invalid config structure")
		}

		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			config.mcpServers = {}
		}

		if (!config.mcpServers[serverName]) {
			config.mcpServers[serverName] = {}
		}

		// Create a new server config object to ensure clean structure
		const serverConfig = {
			...config.mcpServers[serverName],
			...configUpdate,
		}

		// Ensure required fields exist
		if (!serverConfig.alwaysAllow) {
			serverConfig.alwaysAllow = []
		}

		config.mcpServers[serverName] = serverConfig

		// Write the entire config back
		const updatedConfig = {
			mcpServers: config.mcpServers,
		}

		// Set flag to prevent file watcher from triggering server restart
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
		}
		this.isProgrammaticUpdate = true
		try {
			await safeWriteJson(configPath, updatedConfig, { prettyPrint: true })

			// Also save to GlobalConfig for global servers
			if (source === "global") {
				const provider = this.provider
				if (provider) {
					await provider.saveMcpServersToGlobalConfig(updatedConfig.mcpServers)
				}
			}
		} finally {
			// Reset flag after watcher debounce period (non-blocking)
			this.flagResetTimer = setTimeout(() => {
				this.isProgrammaticUpdate = false
				this.flagResetTimer = undefined
			}, 600)
		}
	}

	public async updateServerTimeout(
		serverName: string,
		timeout: number,
		source?: "global" | "project",
	): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			// Update the server config in the appropriate file
			await this.updateServerConfig(serverName, { timeout }, connection.server.source || "global")

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage(`Failed to update server ${serverName} timeout settings`, error)
			throw error
		}
	}

	public async deleteServer(serverName: string, source?: "global" | "project"): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			const serverSource = connection.server.source || "global"
			// Determine config file based on server source
			const isProjectServer = serverSource === "project"
			let configPath: string

			if (isProjectServer) {
				// Get project MCP config path
				const projectMcpPath = await this.getProjectMcpPath()
				if (!projectMcpPath) {
					throw new Error("Project MCP configuration file not found")
				}
				configPath = projectMcpPath
			} else {
				// Get global MCP settings path
				configPath = await this.getMcpSettingsFilePath()
			}

			// Ensure the settings file exists and is accessible
			try {
				await fs.access(configPath)
			} catch (error) {
				throw new Error("Settings file not accessible")
			}

			const content = await fs.readFile(configPath, "utf-8")
			const config = JSON.parse(content)

			// Validate the config structure
			if (!config || typeof config !== "object") {
				throw new Error("Invalid config structure")
			}

			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			// Remove the server from the settings
			if (config.mcpServers[serverName]) {
				delete config.mcpServers[serverName]

				// Write the entire config back
				const updatedConfig = {
					mcpServers: config.mcpServers,
				}

				await safeWriteJson(configPath, updatedConfig, { prettyPrint: true })

				// Also save to GlobalConfig for global servers
				if (serverSource === "global") {
					const provider = this.provider
					if (provider) {
						await provider.saveMcpServersToGlobalConfig(updatedConfig.mcpServers)
					}
				}

				// Update server connections with the correct source
				await this.updateServerConnections(config.mcpServers, serverSource)

				vscode.window.showInformationMessage(t("mcp:info.server_deleted", { serverName }))
			} else {
				vscode.window.showWarningMessage(t("mcp:info.server_not_found", { serverName }))
			}
		} catch (error) {
			this.showErrorMessage(`Failed to delete MCP server ${serverName}`, error)
			throw error
		}
	}

	async readResource(serverName: string, uri: string, source?: "global" | "project"): Promise<McpResourceResponse> {
		const connection = this.findConnection(serverName, source)
		if (!connection || connection.type !== "connected") {
			throw new Error(`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}`)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}
		return await connection.client.request(
			{
				method: "resources/read",
				params: {
					uri,
				},
			},
			ReadResourceResultSchema,
		)
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments?: Record<string, unknown>,
		source?: "global" | "project",
	): Promise<McpToolCallResponse> {
		const connection = this.findConnection(serverName, source)
		if (!connection || connection.type !== "connected") {
			throw new Error(
				`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
			)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled and cannot be used`)
		}

		let timeout: number
		try {
			const parsedConfig = ServerConfigSchema.parse(JSON.parse(connection.server.config))
			timeout = (parsedConfig.timeout ?? 60) * 1000
		} catch (error) {
			console.error("Failed to parse server config for timeout:", error)
			// Default to 60 seconds if parsing fails
			timeout = 60 * 1000
		}

		return await connection.client.request(
			{
				method: "tools/call",
				params: {
					name: toolName,
					arguments: toolArguments,
				},
			},
			CallToolResultSchema,
			{
				timeout,
			},
		)
	}

	/**
	 * Helper method to update a specific tool list (alwaysAllow or disabledTools)
	 * in the appropriate settings file.
	 * @param serverName The name of the server to update
	 * @param source Whether to update the global or project config
	 * @param toolName The name of the tool to add or remove
	 * @param listName The name of the list to modify ("alwaysAllow" or "disabledTools")
	 * @param addTool Whether to add (true) or remove (false) the tool from the list
	 */
	private async updateServerToolList(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		listName: "alwaysAllow" | "disabledTools",
		addTool: boolean,
	): Promise<void> {
		// Find the connection with matching name and source
		const connection = this.findConnection(serverName, source)

		if (!connection) {
			throw new Error(`Server ${serverName} with source ${source} not found`)
		}

		// Determine the correct config path based on the source
		let configPath: string
		if (source === "project") {
			// Get project MCP config path
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			// Get global MCP settings path
			configPath = await this.getMcpSettingsFilePath()
		}

		// Normalize path for cross-platform compatibility
		// Use a consistent path format for both reading and writing
		const normalizedPath = process.platform === "win32" ? configPath.replace(/\\/g, "/") : configPath

		// Read the appropriate config file
		const content = await fs.readFile(normalizedPath, "utf-8")
		const config = JSON.parse(content)

		if (!config.mcpServers) {
			config.mcpServers = {}
		}

		if (!config.mcpServers[serverName]) {
			config.mcpServers[serverName] = {
				type: "stdio",
				command: "node",
				args: [], // Default to an empty array; can be set later if needed
			}
		}

		if (!config.mcpServers[serverName][listName]) {
			config.mcpServers[serverName][listName] = []
		}

		const targetList = config.mcpServers[serverName][listName]
		const toolIndex = targetList.indexOf(toolName)

		if (addTool && toolIndex === -1) {
			targetList.push(toolName)
		} else if (!addTool && toolIndex !== -1) {
			targetList.splice(toolIndex, 1)
		}

		// Set flag to prevent file watcher from triggering server restart
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
		}
		this.isProgrammaticUpdate = true
		try {
			await safeWriteJson(normalizedPath, config, { prettyPrint: true })

			// Also save to GlobalConfig for global servers
			if (source === "global") {
				const provider = this.provider
				if (provider) {
					await provider.saveMcpServersToGlobalConfig(config.mcpServers)
				}
			}
		} finally {
			// Reset flag after watcher debounce period (non-blocking)
			this.flagResetTimer = setTimeout(() => {
				this.isProgrammaticUpdate = false
				this.flagResetTimer = undefined
			}, 600)
		}

		if (connection) {
			connection.server.tools = await this.fetchToolsList(serverName, source)
			await this.notifyWebviewOfServerChanges()
		}
	}

	async toggleToolAlwaysAllow(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		shouldAllow: boolean,
	): Promise<void> {
		try {
			await this.updateServerToolList(serverName, source, toolName, "alwaysAllow", shouldAllow)
		} catch (error) {
			this.showErrorMessage(
				`Failed to toggle always allow for tool "${toolName}" on server "${serverName}" with source "${source}"`,
				error,
			)
			throw error
		}
	}

	async toggleToolEnabledForPrompt(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		isEnabled: boolean,
	): Promise<void> {
		try {
			// When isEnabled is true, we want to remove the tool from the disabledTools list.
			// When isEnabled is false, we want to add the tool to the disabledTools list.
			const addToolToDisabledList = !isEnabled
			await this.updateServerToolList(serverName, source, toolName, "disabledTools", addToolToDisabledList)
		} catch (error) {
			this.showErrorMessage(`Failed to update settings for tool ${toolName}`, error)
			throw error // Re-throw to ensure the error is properly handled
		}
	}

	/**
	 * Handles enabling/disabling MCP globally
	 * @param enabled Whether MCP should be enabled or disabled
	 * @returns Promise<void>
	 */
	async handleMcpEnabledChange(enabled: boolean): Promise<void> {
		if (!enabled) {
			// If MCP is being disabled, disconnect all servers with error handling
			const existingConnections = [...this.connections]
			const disconnectionErrors: Array<{ serverName: string; error: string }> = []

			for (const conn of existingConnections) {
				try {
					await this.deleteConnection(conn.server.name, conn.server.source)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					disconnectionErrors.push({
						serverName: conn.server.name,
						error: errorMessage,
					})
					console.error(`Failed to disconnect MCP server ${conn.server.name}: ${errorMessage}`)
				}
			}

			// If there were errors, notify the user
			if (disconnectionErrors.length > 0) {
				const errorSummary = disconnectionErrors.map((e) => `${e.serverName}: ${e.error}`).join("\n")
				vscode.window.showWarningMessage(
					t("mcp:errors.disconnect_servers_partial", {
						count: disconnectionErrors.length,
						errors: errorSummary,
					}),
				)
			}

			// Re-initialize servers to track them in disconnected state
			try {
				await this.refreshAllConnections()
			} catch (error) {
				console.error(`Failed to refresh MCP connections after disabling: ${error}`)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_disable"))
			}
		} else {
			// If MCP is being enabled, reconnect all servers
			try {
				await this.refreshAllConnections()
			} catch (error) {
				console.error(`Failed to refresh MCP connections after enabling: ${error}`)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_enable"))
			}
		}
	}

	async dispose(): Promise<void> {
		// Prevent multiple disposals
		if (this.isDisposed) {
			return
		}

		this.isDisposed = true

		// Clear all debounce timers
		for (const timer of this.configChangeDebounceTimers.values()) {
			clearTimeout(timer)
		}

		this.configChangeDebounceTimers.clear()

		// Clear flag reset timer and reset programmatic update flag
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
			this.flagResetTimer = undefined
		}

		this.isProgrammaticUpdate = false
		this.removeAllFileWatchers()

		for (const connection of this.connections) {
			try {
				await this.deleteConnection(connection.server.name, connection.server.source)
			} catch (error) {
				console.error(`Failed to close connection for ${connection.server.name}:`, error)
			}
		}

		this.connections = []

		if (this.settingsWatcher) {
			this.settingsWatcher.dispose()
			this.settingsWatcher = undefined
		}

		if (this.projectMcpWatcher) {
			this.projectMcpWatcher.dispose()
			this.projectMcpWatcher = undefined
		}

		this.disposables.forEach((d) => d.dispose())
	}
}