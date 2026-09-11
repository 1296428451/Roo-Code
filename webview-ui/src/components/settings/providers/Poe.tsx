import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useQueryClient } from "@tanstack/react-query"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	poeDefaultModelId,
	type ProviderName,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { handleModelChangeSideEffects } from "../utils/providerModelConfig"

type PoeProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const Poe = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: PoeProps) => {
	const { t } = useAppTranslation()
	const queryClient = useQueryClient()
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
		const key = apiConfiguration.poeApiKey
		if (!key) {
			return
		}

		vscode.postMessage({
			type: "requestRouterModels",
			values: { poeApiKey: key, poeBaseUrl: apiConfiguration.poeBaseUrl },
		})
		queryClient.invalidateQueries({ queryKey: ["routerModels"] })
	}, [apiConfiguration.poeApiKey, apiConfiguration.poeBaseUrl, queryClient])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.poeApiKey || ""}
				type="password"
				onInput={handleInputChange("poeApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.poeApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.poeApiKey && (
				<VSCodeButtonLink href="https://poe.com/api_key" appearance="secondary">
					{t("settings:providers.getPoeApiKey")}
				</VSCodeButtonLink>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={poeDefaultModelId}
				models={routerModels?.poe ?? {}}
				modelIdKey="apiModelId"
				serviceName="Poe"
				serviceUrl="https://poe.com"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
				onModelChange={(modelId) =>
					handleModelChangeSideEffects("poe" as ProviderName, modelId, setApiConfigurationField)
				}
				refetchModels={handleRefreshModels}
			/>
		</>
	)
}
