import * as vscode from "vscode"
import type { ExtensionMessage } from "@roo-code/types"
import { WebviewMessage } from "../../../shared/WebviewMessage"
import { getHMRHtmlContent, getHtmlContent } from "../webviewHtml"
import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

export class WebviewLifecycleDelegate {
	constructor(private readonly provider: ClineProvider) {}

	async resolveWebviewView(
		webviewView: vscode.WebviewView | vscode.WebviewPanel,
		_context: vscode.WebviewViewResolveContext<unknown>,
		_token: vscode.CancellationToken,
	): Promise<void> {
		this.provider.view = webviewView

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.provider.context.extensionUri],
		}

		webviewView.webview.html = await this.getHtmlContent(webviewView.webview)

		this.setWebviewMessageListener(webviewView.webview)

		// Handle visibility changes
		if ("onDidChangeVisibility" in webviewView) {
			this.provider.webviewDisposables.push(
				webviewView.onDidChangeVisibility(() => {
					if (webviewView.visible) {
						this.provider.postStateToWebview()
					}
				}),
			)
		}

		// Handle dispose
		this.provider.webviewDisposables.push(
			webviewView.onDidDispose(() => {
				this.provider.dispose()
			}),
		)

		// Mark as launched and post initial state
		this.provider.isViewLaunched = true
		await this.provider.postStateToWebview()
	}

	public async postMessageToWebview(message: ExtensionMessage): Promise<void> {
		if (!this.provider.view) return

		try {
			await this.provider.view.webview.postMessage(message)
		} catch (error) {
			this.provider.log(`Failed to post message to webview: ${error}`)
		}
	}

	public async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		return getHMRHtmlContent(this.provider, webview)
	}

	public async getHtmlContent(webview: vscode.Webview): Promise<string> {
		return getHtmlContent(this.provider, webview)
	}

	public setWebviewMessageListener(webview: vscode.Webview) {
		webview.onDidReceiveMessage(
			(message: WebviewMessage) => {
				webviewMessageHandler(this.provider, message)
			},
			undefined,
			this.provider.webviewDisposables,
		)
	}

	public clearWebviewResources() {
		for (const disposable of this.provider.webviewDisposables) {
			disposable.dispose()
		}
		this.provider.webviewDisposables = []
	}
}