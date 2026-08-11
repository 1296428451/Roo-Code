import { McpHub } from "../../../services/mcp/McpHub"
import type { ClineProvider } from "../ClineProvider"

export class McpDelegate {
	constructor(private readonly provider: ClineProvider) {}

	async initializeMcpHub(): Promise<void> {
		try {
			this.provider.mcpHub = new McpHub(this.provider)
			await this.provider.mcpHub.waitUntilReady()
		} catch (error) {
			this.provider.log(`Failed to initialize MCP Hub: ${error}`)
		}
	}

	getMcpHub(): McpHub | undefined {
		return this.provider.mcpHub
	}

	getMcpServersFromGlobalConfig(): Record<string, any> {
		const stateValues = this.provider.contextProxy.getValues()
		const globalConfigServers = stateValues.mcpServers
		if (globalConfigServers && typeof globalConfigServers === "object" && !Array.isArray(globalConfigServers)) {
			return globalConfigServers
		}
		return {}
	}

	getMcpEnabledFromGlobalConfig(): boolean {
		const stateValues = this.provider.contextProxy.getValues()
		return stateValues.mcpEnabled ?? true
	}

	async saveMcpServersToGlobalConfig(servers: any[]): Promise<void> {
		await this.provider.updateGlobalState("mcpServers", servers)
	}
}