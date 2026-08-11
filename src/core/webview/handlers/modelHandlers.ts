import type { WebviewMessage, ModelRecord } from "@roo-code/types"
import type { HandlerContext } from "./context"
import { type RouterName, toRouterName, type GetModelsOptions } from "../../../shared/api"
import { getModels, flushModels } from "../../../api/providers/fetchers/modelCache"
import { getOpenAiModels } from "../../../api/providers/openai"
import { getVsCodeLmModels } from "../../../api/providers/vscode-lm"

export async function handleModelOperations(ctx: HandlerContext, message: WebviewMessage): Promise<void> {
	const { provider } = ctx

	switch (message.type) {
		case "flushRouterModels": {
			const routerNameFlush: RouterName = toRouterName(message.text)
			await flushModels({ provider: routerNameFlush } as GetModelsOptions, true)
			break
		}

		case "requestRouterModels": {
			const { apiConfiguration } = await provider.getState()

			const requestedProvider = message?.values?.provider
			const providerFilter = requestedProvider ? toRouterName(requestedProvider) : undefined
			const shouldRefresh = message?.values?.refresh === true

			const routerModels: Record<RouterName, ModelRecord> = providerFilter
				? ({} as Record<RouterName, ModelRecord>)
				: {
						openrouter: {},
						"vercel-ai-gateway": {},
						litellm: {},
						requesty: {},
						unbound: {},
						ollama: {},
						lmstudio: {},
						poe: {},
					}

			const safeGetModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
				try {
					return await getModels(options)
				} catch (error) {
					console.error(
						`Failed to fetch models in handleModelOperations requestRouterModels for ${options.provider}:`,
						error,
					)
					throw error
				}
			}

			const candidates: { key: RouterName; options: GetModelsOptions }[] = [
				{ key: "openrouter", options: { provider: "openrouter" } },
				{
					key: "requesty",
					options: {
						provider: "requesty",
						apiKey: apiConfiguration.requestyApiKey,
						baseUrl: apiConfiguration.requestyBaseUrl,
					},
				},
				{
					key: "unbound",
					options: {
						provider: "unbound",
						apiKey: apiConfiguration.unboundApiKey,
					},
				},
				{ key: "vercel-ai-gateway", options: { provider: "vercel-ai-gateway" } },
			]

			const litellmApiKey = apiConfiguration.litellmApiKey || message?.values?.litellmApiKey
			const litellmBaseUrl = apiConfiguration.litellmBaseUrl || message?.values?.litellmBaseUrl

			if (litellmApiKey && litellmBaseUrl) {
				if (message?.values?.litellmApiKey || message?.values?.litellmBaseUrl) {
					await flushModels({ provider: "litellm", apiKey: litellmApiKey, baseUrl: litellmBaseUrl }, true)
				}

				candidates.push({
					key: "litellm",
					options: { provider: "litellm", apiKey: litellmApiKey, baseUrl: litellmBaseUrl },
				})
			}

			const poeApiKey = apiConfiguration.poeApiKey || message?.values?.poeApiKey
			const poeBaseUrl = apiConfiguration.poeBaseUrl || message?.values?.poeBaseUrl

			if (poeApiKey) {
				if (message?.values?.poeApiKey || message?.values?.poeBaseUrl) {
					await flushModels({ provider: "poe", apiKey: poeApiKey, baseUrl: poeBaseUrl }, true)
				}

				candidates.push({
					key: "poe",
					options: { provider: "poe", apiKey: poeApiKey, baseUrl: poeBaseUrl },
				})
			}

			const modelFetchPromises = providerFilter
				? candidates.filter(({ key }) => key === providerFilter)
				: candidates

			if (shouldRefresh && providerFilter && modelFetchPromises.length > 0) {
				const targetCandidate = modelFetchPromises[0]
				await flushModels(targetCandidate.options, true)
			}

			const results = await Promise.allSettled(
				modelFetchPromises.map(async ({ key, options }) => {
					const models = await safeGetModels(options)
					return { key, models }
				}),
			)

			results.forEach((result, index) => {
				const routerName = modelFetchPromises[index].key

				if (result.status === "fulfilled") {
					routerModels[routerName] = result.value.models
				} else {
					const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason)
					console.error(`Error fetching models for ${routerName}:`, result.reason)

					routerModels[routerName] = {}

					provider.postMessageToWebview({
						type: "singleRouterModelFetchResponse",
						success: false,
						error: errorMessage,
						values: { provider: routerName },
					})
				}
			})

			provider.postMessageToWebview({
				type: "routerModels",
				routerModels,
				values: providerFilter ? { provider: requestedProvider } : undefined,
			})
			break
		}

		case "requestOllamaModels": {
			const { apiConfiguration: ollamaApiConfig } = await provider.getState()
			try {
				const ollamaOptions = {
					provider: "ollama" as const,
					baseUrl: ollamaApiConfig.ollamaBaseUrl,
					apiKey: ollamaApiConfig.ollamaApiKey,
				}
				await flushModels(ollamaOptions, true)

				const ollamaModels = await getModels(ollamaOptions)

				if (Object.keys(ollamaModels).length > 0) {
					provider.postMessageToWebview({ type: "ollamaModels", ollamaModels: ollamaModels })
				}
			} catch (error) {
				console.debug("Ollama models fetch failed:", error)
			}
			break
		}

		case "requestLmStudioModels": {
			const { apiConfiguration: lmStudioApiConfig } = await provider.getState()
			try {
				const lmStudioOptions = {
					provider: "lmstudio" as const,
					baseUrl: lmStudioApiConfig.lmStudioBaseUrl,
				}
				await flushModels(lmStudioOptions, true)

				const lmStudioModels = await getModels(lmStudioOptions)

				if (Object.keys(lmStudioModels).length > 0) {
					provider.postMessageToWebview({
						type: "lmStudioModels",
						lmStudioModels: lmStudioModels,
					})
				}
			} catch (error) {
				console.debug("LM Studio models fetch failed:", error)
			}
			break
		}

		case "requestOpenAiModels":
			if (message?.values?.baseUrl && message?.values?.apiKey) {
				const openAiModels = await getOpenAiModels(
					message?.values?.baseUrl,
					message?.values?.apiKey,
					message?.values?.openAiHeaders,
				)

				provider.postMessageToWebview({ type: "openAiModels", openAiModels })
			}
			break

		case "requestVsCodeLmModels": {
			const vsCodeLmModels = await getVsCodeLmModels()
			provider.postMessageToWebview({ type: "vsCodeLmModels", vsCodeLmModels })
			break
		}
	}
}