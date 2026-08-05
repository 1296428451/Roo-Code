import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { SettingsStore } from "../SettingsStore"

describe("SettingsStore", () => {
	let tempRoot: string

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-settings-store-"))
	})

	afterEach(async () => {
		await fs.rm(tempRoot, { recursive: true, force: true })
	})

	it("loads roo-code-config.json from globalStorage/settings", async () => {
		const settingsDir = path.join(tempRoot, "settings")
		const config = {
			globalSettings: {
				customInstructions: "Loaded from global storage",
			},
			providerProfiles: {
				currentApiConfigName: "global-profile",
				apiConfigs: {
					"global-profile": {
						id: "global-profile-id",
						apiProvider: "openrouter",
						openRouterModelId: "openai/gpt-4o-mini",
					},
				},
			},
		}

		await fs.mkdir(settingsDir, { recursive: true })
		await fs.writeFile(path.join(settingsDir, "roo-code-config.json"), JSON.stringify(config), "utf-8")

		const store = new SettingsStore(settingsDir)
		await store.loadAll()

		expect(store.getGlobalState("customInstructions")).toBe("Loaded from global storage")
		expect(await store.loadProviderProfiles()).toEqual(config.providerProfiles)
		expect(await store.configFileExists()).toBe(true)
	})
})
