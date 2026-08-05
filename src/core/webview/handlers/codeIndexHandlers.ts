import * as vscode from "vscode"
import { ClineProvider } from "../ClineProvider"
import { CodeIndexManager } from "../../../services/code-index/manager"
import { t } from "../../../i18n"

export const handleCodeIndexOperations = async (ctx: import("../webviewMessageHandler").HandlerContext, message: any): Promise<void> => {
	const { provider, updateGlobalState } = ctx

	switch (message.type) {
		case "saveCodeIndexSettingsAtomic": {
			if (!message.codeIndexSettings) {
				break
			}

			const settings = message.codeIndexSettings

			try {
				const currentConfig = ctx.getGlobalState("codebaseIndexConfig") || {}
				const embedderProviderChanged = currentConfig.codebaseIndexEmbedderProvider !== settings.codebaseIndexEmbedderProvider

				const globalStateConfig = {
					...currentConfig,
					codebaseIndexEnabled: settings.codebaseIndexEnabled,
					codebaseIndexQdrantUrl: settings.codebaseIndexQdrantUrl,
					codebaseIndexEmbedderProvider: settings.codebaseIndexEmbedderProvider,
					codebaseIndexEmbedderBaseUrl: settings.codebaseIndexEmbedderBaseUrl,
					codebaseIndexEmbedderModelId: settings.codebaseIndexEmbedderModelId,
					codebaseIndexEmbedderModelDimension: settings.codebaseIndexEmbedderModelDimension,
					codebaseIndexOpenAiCompatibleBaseUrl: settings.codebaseIndexOpenAiCompatibleBaseUrl,
					codebaseIndexBedrockRegion: settings.codebaseIndexBedrockRegion,
					codebaseIndexBedrockProfile: settings.codebaseIndexBedrockProfile,
					codebaseIndexSearchMaxResults: settings.codebaseIndexSearchMaxResults,
					codebaseIndexSearchMinScore: settings.codebaseIndexSearchMinScore,
					codebaseIndexOpenRouterSpecificProvider: settings.codebaseIndexOpenRouterSpecificProvider,
				}

				await updateGlobalState("codebaseIndexConfig", globalStateConfig)

				if (settings.codeIndexOpenAiKey !== undefined) {
					await provider.contextProxy.storeSecret("codeIndexOpenAiKey", settings.codeIndexOpenAiKey)
				}
				if (settings.codeIndexQdrantApiKey !== undefined) {
					await provider.contextProxy.storeSecret("codeIndexQdrantApiKey", settings.codeIndexQdrantApiKey)
				}
				if (settings.codebaseIndexOpenAiCompatibleApiKey !== undefined) {
					await provider.contextProxy.storeSecret("codebaseIndexOpenAiCompatibleApiKey", settings.codebaseIndexOpenAiCompatibleApiKey)
				}
				if (settings.codebaseIndexGeminiApiKey !== undefined) {
					await provider.contextProxy.storeSecret("codebaseIndexGeminiApiKey", settings.codebaseIndexGeminiApiKey)
				}
				if (settings.codebaseIndexMistralApiKey !== undefined) {
					await provider.contextProxy.storeSecret("codebaseIndexMistralApiKey", settings.codebaseIndexMistralApiKey)
				}
				if (settings.codebaseIndexVercelAiGatewayApiKey !== undefined) {
					await provider.contextProxy.storeSecret("codebaseIndexVercelAiGatewayApiKey", settings.codebaseIndexVercelAiGatewayApiKey)
				}
				if (settings.codebaseIndexOpenRouterApiKey !== undefined) {
					await provider.contextProxy.storeSecret("codebaseIndexOpenRouterApiKey", settings.codebaseIndexOpenRouterApiKey)
				}

				await provider.postMessageToWebview({
					type: "codeIndexSettingsSaved",
					success: true,
					settings: globalStateConfig,
				})

				await provider.postStateToWebview()

				const currentCodeIndexManager = provider.getCurrentWorkspaceCodeIndexManager()
				if (currentCodeIndexManager) {
					if (embedderProviderChanged) {
						try {
							await currentCodeIndexManager.handleSettingsChange()
						} catch (error) {
							provider.log(`Embedder validation failed after provider change: ${error}`)
							await provider.postMessageToWebview({
								type: "indexingStatusUpdate",
								values: currentCodeIndexManager.getCurrentStatus(),
							})
							break
						}
					} else {
						try {
							await currentCodeIndexManager.handleSettingsChange()
						} catch (error) {
							provider.log(`Settings change handling error: ${error}`)
						}
					}

					await new Promise((resolve) => setTimeout(resolve, 200))

					if (currentCodeIndexManager.isFeatureEnabled && currentCodeIndexManager.isFeatureConfigured) {
						if (!currentCodeIndexManager.isInitialized) {
							try {
								await currentCodeIndexManager.initialize(provider.contextProxy)
								provider.log(`Code index manager initialized after settings save`)
							} catch (error) {
								provider.log(`Code index initialization failed: ${error}`)
								await provider.postMessageToWebview({
									type: "indexingStatusUpdate",
									values: currentCodeIndexManager.getCurrentStatus(),
								})
							}
						}
					}
				} else {
					provider.log("Cannot save code index settings: No workspace folder open")
					await provider.postMessageToWebview({
						type: "indexingStatusUpdate",
						values: {
							systemStatus: "Error",
							message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
							processedItems: 0,
							totalItems: 0,
							currentItemUnit: "items",
						},
					})
				}
			} catch (error) {
				provider.log(`Error saving code index settings: ${error}`)
				await provider.postMessageToWebview({
					type: "codeIndexSettingsSaved",
					success: false,
					error: error instanceof Error ? error.message : "Failed to save settings",
				})
			}
			break
		}

		case "requestIndexingStatus": {
			const manager = provider.getCurrentWorkspaceCodeIndexManager()
			if (!manager) {
				provider.postMessageToWebview({
					type: "indexingStatusUpdate",
					values: {
						systemStatus: "Error",
						message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
						processedItems: 0,
						totalItems: 0,
						currentItemUnit: "items",
						workspacePath: undefined,
					},
				})
				return
			}

			const status = manager.getCurrentStatus()
			provider.postMessageToWebview({ type: "indexingStatusUpdate", values: status })
			break
		}

		case "requestCodeIndexSecretStatus": {
			await provider.contextProxy.refreshSecrets()
			const hasOpenAiKey = !!provider.contextProxy.getSecret("codeIndexOpenAiKey")
			const hasQdrantApiKey = !!provider.contextProxy.getSecret("codeIndexQdrantApiKey")
			const hasOpenAiCompatibleApiKey = !!provider.contextProxy.getSecret("codebaseIndexOpenAiCompatibleApiKey")
			const hasGeminiApiKey = !!provider.contextProxy.getSecret("codebaseIndexGeminiApiKey")
			const hasMistralApiKey = !!provider.contextProxy.getSecret("codebaseIndexMistralApiKey")
			const hasVercelAiGatewayApiKey = !!provider.contextProxy.getSecret("codebaseIndexVercelAiGatewayApiKey")
			const hasOpenRouterApiKey = !!provider.contextProxy.getSecret("codebaseIndexOpenRouterApiKey")

			provider.postMessageToWebview({
				type: "codeIndexSecretStatus",
				values: {
					hasOpenAiKey,
					hasQdrantApiKey,
					hasOpenAiCompatibleApiKey,
					hasGeminiApiKey,
					hasMistralApiKey,
					hasVercelAiGatewayApiKey,
					hasOpenRouterApiKey,
				},
			})
			break
		}

		case "startIndexing": {
			try {
				const manager = provider.getCurrentWorkspaceCodeIndexManager()
				if (!manager) {
					provider.postMessageToWebview({
						type: "indexingStatusUpdate",
						values: {
							systemStatus: "Error",
							message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
							processedItems: 0,
							totalItems: 0,
							currentItemUnit: "items",
						},
					})
					provider.log("Cannot start indexing: No workspace folder open")
					return
				}

				await manager.setWorkspaceEnabled(true)

				if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
					await manager.initialize(provider.contextProxy)

					const currentState = manager.state
					if (currentState === "Standby" || currentState === "Error") {
						manager.startIndexing()

						if (!manager.isInitialized) {
							await manager.initialize(provider.contextProxy)
							if (manager.state === "Standby" || manager.state === "Error") {
								manager.startIndexing()
							}
						}
					}
				}
			} catch (error) {
				provider.log(`Error starting indexing: ${error}`)
			}
			break
		}

		case "stopIndexing": {
			try {
				const manager = provider.getCurrentWorkspaceCodeIndexManager()
				if (!manager) {
					provider.log("Cannot stop indexing: No workspace folder open")
					return
				}
				manager.stopIndexing()
				provider.postMessageToWebview({
					type: "indexingStatusUpdate",
					values: manager.getCurrentStatus(),
				})
			} catch (error) {
				provider.log(`Error stopping indexing: ${error}`)
			}
			break
		}

		case "toggleWorkspaceIndexing": {
			try {
				const manager = provider.getCurrentWorkspaceCodeIndexManager()
				if (!manager) {
					provider.log("Cannot toggle workspace indexing: No workspace folder open")
					return
				}
				const enabled = message.bool ?? false
				await manager.setWorkspaceEnabled(enabled)
				if (enabled && manager.isFeatureEnabled && manager.isFeatureConfigured) {
					await manager.initialize(provider.contextProxy)
					manager.startIndexing()
				} else if (!enabled) {
					manager.stopIndexing()
				}
				provider.postMessageToWebview({
					type: "indexingStatusUpdate",
					values: manager.getCurrentStatus(),
				})
			} catch (error) {
				provider.log(`Error toggling workspace indexing: ${error}`)
			}
			break
		}

		case "setAutoEnableDefault": {
			try {
				const manager = provider.getCurrentWorkspaceCodeIndexManager()
				if (!manager) {
					provider.log("Cannot set auto-enable default: No workspace folder open")
					return
				}
				const allManagers = CodeIndexManager.getAllInstances()
				const priorStates = new Map(allManagers.map((m) => [m, m.isWorkspaceEnabled]))
				await manager.setAutoEnableDefault(message.bool ?? true)
				for (const m of allManagers) {
					const wasEnabled = priorStates.get(m)!
					const isNowEnabled = m.isWorkspaceEnabled
					if (wasEnabled && !isNowEnabled) {
						m.stopIndexing()
					} else if (!wasEnabled && isNowEnabled && m.isFeatureEnabled && m.isFeatureConfigured) {
						await m.initialize(provider.contextProxy)
						m.startIndexing()
					}
				}
				provider.postMessageToWebview({
					type: "indexingStatusUpdate",
					values: manager.getCurrentStatus(),
				})
			} catch (error) {
				provider.log(`Error setting auto-enable default: ${error}`)
			}
			break
		}

		case "setIndexWorkspacePath": {
			try {
				const manager = provider.getCurrentWorkspaceCodeIndexManager()
				if (!manager) {
					provider.log("Cannot set index workspace path: No workspace folder open")
					return
				}
				const workspacePath = message.workspacePath
				await manager.setIndexWorkspacePath(workspacePath)
				provider.postMessageToWebview({
					type: "indexingStatusUpdate",
					values: manager.getCurrentStatus(),
				})
			} catch (error) {
				provider.log(`Error setting index workspace path: ${error}`)
			}
			break
		}

		case "clearIndexData": {
			try {
				const manager = provider.getCurrentWorkspaceCodeIndexManager()
				if (!manager) {
					provider.log("Cannot clear index data: No workspace folder open")
					provider.postMessageToWebview({
						type: "indexCleared",
						values: { success: false, error: t("embeddings:orchestrator.indexingRequiresWorkspace") },
					})
					return
				}
				await manager.clearIndexData()
				provider.postMessageToWebview({ type: "indexCleared", values: { success: true } })
			} catch (error) {
				provider.log(`Error clearing index data: ${error}`)
				provider.postMessageToWebview({
					type: "indexCleared",
					values: { success: false, error: error instanceof Error ? error.message : String(error) },
				})
			}
			break
		}
	}
}