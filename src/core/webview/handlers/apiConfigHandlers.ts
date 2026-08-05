import * as vscode from "vscode"
import { ClineProvider } from "../ClineProvider"
import { t } from "../../../i18n"

export const handleApiConfigOperations = async (ctx: import("../webviewMessageHandler").HandlerContext, message: any): Promise<void> => {
	const { provider, updateGlobalState } = ctx

	switch (message.type) {
		case "saveApiConfiguration":
			if (message.text && message.apiConfiguration) {
				try {
					await provider.providerSettingsManager.saveConfig(message.text, message.apiConfiguration)
					const listApiConfig = await provider.providerSettingsManager.listConfig()
					await updateGlobalState("listApiConfigMeta", listApiConfig)
				} catch (error) {
					provider.log(`Error save api configuration: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.save_api_config"))
				}
			}
			break

		case "upsertApiConfiguration":
			if (message.text && message.apiConfiguration) {
				await provider.upsertProviderProfile(message.text, message.apiConfiguration)
			}
			break

		case "renameApiConfiguration":
			if (message.values && message.apiConfiguration) {
				try {
					const { oldName, newName } = message.values
					if (oldName === newName) {
						break
					}
					const { id } = await provider.providerSettingsManager.getProfile({ name: oldName })
					await provider.providerSettingsManager.saveConfig(newName, { ...message.apiConfiguration, id })
					await provider.providerSettingsManager.deleteConfig(oldName)
					await provider.activateProviderProfile({ name: newName })
				} catch (error) {
					provider.log(`Error rename api configuration: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.rename_api_config"))
				}
			}
			break

		case "loadApiConfiguration":
			if (message.text) {
				try {
					await provider.activateProviderProfile({ name: message.text })
				} catch (error) {
					provider.log(`Error load api configuration: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.load_api_config"))
				}
			}
			break

		case "loadApiConfigurationById":
			if (message.text) {
				try {
					await provider.activateProviderProfile({ id: message.text })
				} catch (error) {
					provider.log(`Error load api configuration by ID: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.load_api_config"))
				}
			}
			break

		case "deleteApiConfiguration":
			if (message.text) {
				const answer = await vscode.window.showInformationMessage(
					t("common:confirmation.delete_config_profile"),
					{ modal: true },
					t("common:answers.yes"),
				)
				if (answer !== t("common:answers.yes")) {
					break
				}

				const oldName = message.text
				const newName = (await provider.providerSettingsManager.listConfig()).filter(
					(c) => c.name !== oldName,
				)[0]?.name

				if (!newName) {
					vscode.window.showErrorMessage(t("common:errors.delete_api_config"))
					return
				}

				try {
					await provider.providerSettingsManager.deleteConfig(oldName)
					await provider.activateProviderProfile({ name: newName })
				} catch (error) {
					provider.log(`Error delete api configuration: ${error}`)
					vscode.window.showErrorMessage(t("common:errors.delete_api_config"))
				}
			}
			break

		case "getListApiConfiguration":
			try {
				const listApiConfig = await provider.providerSettingsManager.listConfig()
				await updateGlobalState("listApiConfigMeta", listApiConfig)
				provider.postMessageToWebview({ type: "listApiConfig", listApiConfig })
			} catch (error) {
				provider.log(`Error get list api configuration: ${error}`)
				vscode.window.showErrorMessage(t("common:errors.list_api_config"))
			}
			break
	}
}