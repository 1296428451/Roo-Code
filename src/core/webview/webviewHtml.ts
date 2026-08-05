import axios from "axios"
import * as vscode from "vscode"

import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { t } from "../../i18n"
import type { ClineProvider } from "./ClineProvider"

/**
 * Returns the HTML content for the webview in HMR (development) mode.
 */
export async function getHMRHtmlContent(provider: ClineProvider, webview: vscode.Webview): Promise<string> {
	let localPort = "5173"

	try {
		const fs = require("fs")
		const path = require("path")
		const portFilePath = path.resolve(__dirname, "../../.vite-port")

		if (fs.existsSync(portFilePath)) {
			localPort = fs.readFileSync(portFilePath, "utf8").trim()
			console.log(`[ClineProvider:Vite] Using Vite server port from ${portFilePath}: ${localPort}`)
		} else {
			console.log(
				`[ClineProvider:Vite] Port file not found at ${portFilePath}, using default port: ${localPort}`,
			)
		}
	} catch (err) {
		console.error("[ClineProvider:Vite] Failed to read Vite port file:", err)
	}

	const localServerUrl = `localhost:${localPort}`

	// Check if local dev server is running.
	try {
		await axios.get(`http://${localServerUrl}`)
	} catch (error) {
		vscode.window.showErrorMessage(t("common:errors.hmr_not_running"))
		return getHtmlContent(provider, webview)
	}

	const nonce = getNonce()

	// Get the OpenRouter base URL from configuration
	const { apiConfiguration } = await provider.getState()
	const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
	// Extract the domain for CSP
	const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

	const stylesUri = getUri(webview, provider.contextProxy.extensionUri, [
		"webview-ui",
		"build",
		"assets",
		"index.css",
	])

	const codiconsUri = getUri(webview, provider.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
	const materialIconsUri = getUri(webview, provider.contextProxy.extensionUri, [
		"assets",
		"vscode-material-icons",
		"icons",
	])
	const imagesUri = getUri(webview, provider.contextProxy.extensionUri, ["assets", "images"])
	const audioUri = getUri(webview, provider.contextProxy.extensionUri, ["webview-ui", "audio"])

	const file = "src/index.tsx"
	const scriptUri = `http://${localServerUrl}/${file}`

	const reactRefresh = /*html*/ `
		<script nonce="${nonce}" type="module">
			import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
			RefreshRuntime.injectIntoGlobalHook(window)
			window.$RefreshReg$ = () => {}
			window.$RefreshSig$ = () => (type) => type
			window.__vite_plugin_react_preamble_installed__ = true
		</script>
	`

	const csp = [
		"default-src 'none'",
		`font-src ${webview.cspSource} data:`,
		`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
		`img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:`,
		`media-src ${webview.cspSource}`,
		`script-src 'unsafe-eval' ${webview.cspSource} https://* http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
		`connect-src ${webview.cspSource} ${openRouterDomain} https://* ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
	]

	return /*html*/ `
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
				<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
				<link rel="stylesheet" type="text/css" href="${stylesUri}">
				<link href="${codiconsUri}" rel="stylesheet" />
				<script nonce="${nonce}">
					window.IMAGES_BASE_URI = "${imagesUri}"
					window.AUDIO_BASE_URI = "${audioUri}"
					window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
				</script>
				<title>Roo Code</title>
			</head>
			<body>
				<div id="root"></div>
				${reactRefresh}
				<script type="module" src="${scriptUri}"></script>
			</body>
		</html>
	`
}

/**
 * Returns the HTML content for the webview in production mode.
 */
export async function getHtmlContent(provider: ClineProvider, webview: vscode.Webview): Promise<string> {
	const stylesUri = getUri(webview, provider.contextProxy.extensionUri, [
		"webview-ui",
		"build",
		"assets",
		"index.css",
	])

	const scriptUri = getUri(webview, provider.contextProxy.extensionUri, ["webview-ui", "build", "assets", "index.js"])
	const codiconsUri = getUri(webview, provider.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
	const materialIconsUri = getUri(webview, provider.contextProxy.extensionUri, [
		"assets",
		"vscode-material-icons",
		"icons",
	])
	const imagesUri = getUri(webview, provider.contextProxy.extensionUri, ["assets", "images"])
	const audioUri = getUri(webview, provider.contextProxy.extensionUri, ["webview-ui", "audio"])

	const nonce = getNonce()

	// Get the OpenRouter base URL from configuration
	const { apiConfiguration } = await provider.getState()
	const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
	// Extract the domain for CSP
	const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

	return /*html*/ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
        <meta name="theme-color" content="#000000">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:; media-src ${webview.cspSource}; script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'; connect-src ${webview.cspSource} ${openRouterDomain} https://api.requesty.ai;">
        <link rel="stylesheet" type="text/css" href="${stylesUri}">
		<link href="${codiconsUri}" rel="stylesheet" />
		<script nonce="${nonce}">
			window.IMAGES_BASE_URI = "${imagesUri}"
			window.AUDIO_BASE_URI = "${audioUri}"
			window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
		</script>
        <title>Roo Code</title>
      </head>
      <body>
        <noscript>You need to enable JavaScript to run this app.</noscript>
        <div id="root"></div>
        <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
      </body>
    </html>
  `
}