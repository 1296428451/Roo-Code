import { McpHub } from "../../../services/mcp/McpHub"
import type { ClineProvider } from "../ClineProvider"

export class McpDelegate {
	constructor(private readonly provider: ClineProvider) {}

	async initializeMcpHub(): Promise<void> {
		try {
			this.provider.mcpHub = new McpHub(this.provider.context)
			await this.provider.mcpHub.initialize()
		} catch (error) {
			this.provider.log(`Failed to initialize MCP Hub: ${error}`)
		}
	}

	getMcpHub(): McpHub | undefined {
		return this.provider.mcpHub
	}

	getMcpServersFromGlobalConfig(): any[] {
		const stateValues = this.provider.contextProxy.getValues()
		const globalConfigServers = stateValues.mcpServers
		if (globalConfigServers && typeof globalConfigServers === "object" && !Array.isArray(globalConfigServers)) {
			return Object.entries(globalConfigServers).map(([name, config]) => ({
				name,
				config: typeof config === "string" ? config : JSON.stringify(config),
				status: "disconnected" as const,
				source: "global" as const,
				disabled: (config as any)?.disabled,
				timeout: (config as any)?.timeout,
			}))
		}
		return []
	}

	getMcpEnabledFromGlobalConfig(): boolean {
		const stateValues = this.provider.contextProxy.getValues()
		return stateValues.mcpEnabled ?? true
	}

	async saveMcpServersToGlobalConfig(servers: any[]): Promise<void> {
		await this.provider.updateGlobalState("mcpServers", servers)
	}
}