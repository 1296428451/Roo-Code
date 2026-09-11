import { useCallback } from "react"
import { VSCodeTextField, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	litellmDefaultModelId,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type LiteLLMProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const LiteLLM = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: LiteLLMProps) => {
	const { t } = useAppTranslation()
	const { routerModels } = useExtensionState()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const handleRefreshModels = useCallback(() => {
		const key = apiConfiguration.litellmApiKey
		const url = apiConfiguration.litellmBaseUrl

		if (!key || !url) {
			return
		}

		vscode.postMessage({
			type: "requestRouterModels",
			values: { litellmApiKey: key, litellmBaseUrl: url },
		})
	}, [apiConfiguration.litellmApiKey, apiConfiguration.litellmBaseUrl])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.litellmBaseUrl || ""}
				onInput={handleInputChange("litellmBaseUrl")}
				placeholder={t("settings:placeholders.baseUrl")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.litellmBaseUrl")}</label>
			</VSCodeTextField>

			<VSCodeTextField
				value={apiConfiguration?.litellmApiKey || ""}
				type="password"
				onInput={handleInputChange("litellmApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.litellmApiKey")}</label>
			</VSCodeTextField>

			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				defaultModelId={litellmDefaultModelId}
				models={routerModels?.litellm ?? {}}
				modelIdKey="litellmModelId"
				serviceName="LiteLLM"
				serviceUrl="https://docs.litellm.ai/"
				setApiConfigurationField={setApiConfigurationField}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
				refetchModels={handleRefreshModels}
			/>

			{/* Show prompt caching option if the selected model supports it */}
			{(() => {
				const selectedModelId = apiConfiguration.litellmModelId || litellmDefaultModelId
				const selectedModel = routerModels?.litellm?.[selectedModelId]
				if (selectedModel?.supportsPromptCache) {
					return (
						<div className="mt-4">
							<VSCodeCheckbox
								checked={apiConfiguration.litellmUsePromptCache || false}
								onChange={(e: any) => {
									setApiConfigurationField("litellmUsePromptCache", e.target.checked)
								}}>
								<span className="font-medium">{t("settings:providers.enablePromptCache")}</span>
							</VSCodeCheckbox>
							<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1">
								{t("settings:providers.enablePromptCacheTitle")}
							</div>
						</div>
					)
				}
				return null
			})()}
		</>
	)
}
