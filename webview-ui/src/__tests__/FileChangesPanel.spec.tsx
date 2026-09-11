import React from "react"
import { act, fireEvent, render, screen } from "@/utils/test-utils"
import type { ClineMessage } from "@roo-code/types"
import { TranslationProvider } from "@/i18n/__mocks__/TranslationContext"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import FileChangesPanel from "../components/chat/FileChangesPanel"

const mockPostMessage = vi.fn()

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: unknown[]) => mockPostMessage(...args),
	},
}))

// Mock i18n to return readable header with count
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, opts?: { count?: number; deletedCount?: number }) => {
			if (key === "chat:fileChangesInConversation.header" && opts?.count != null) {
				return `${opts.count} file(s) changed in this conversation`
			}
			if (key === "chat:fileChangesInConversation.headerWithDeleted") {
				return `${opts?.count} file(s) changed (${opts?.deletedCount} deleted, recoverable)`
			}
			return key
		},
	}),
}))

// Lightweight mock so we don't pull in CodeBlock/DiffView
vi.mock("@src/components/common/CodeAccordion", () => ({
	default: ({
		path,
		isExpanded,
		onToggleExpand,
	}: {
		path?: string
		isExpanded: boolean
		onToggleExpand: () => void
	}) => (
		<div data-testid="code-accordian">
			<span data-testid="accordian-path">{path}</span>
			<button type="button" onClick={onToggleExpand} data-testid="accordian-toggle">
				{isExpanded ? "expanded" : "collapsed"}
			</button>
		</div>
	),
}))

function createFileEditMessage(
	path: string,
	diff: string,
	diffStats?: { added: number; removed: number },
): ClineMessage {
	return {
		type: "ask",
		ask: "tool",
		ts: Date.now(),
		partial: false,
		isAnswered: true,
		text: JSON.stringify({
			tool: "appliedDiff",
			path,
			diff,
			...(diffStats && { diffStats }),
		}),
	}
}

function renderPanel(messages: ClineMessage[] | undefined) {
	return render(
		<TranslationProvider>
			<ExtensionStateContextProvider>
				<FileChangesPanel clineMessages={messages} />
			</ExtensionStateContextProvider>
		</TranslationProvider>,
	)
}

// Simulate the extension broadcasting the current trash list to the webview
function broadcastDeletedFiles(deletedFiles: { relativePath: string; trashedAt: number; size: number }[]) {
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "deletedFilesUpdated", deletedFiles },
			}),
		)
	})
}

describe("FileChangesPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders nothing when clineMessages is undefined", () => {
		const { container } = renderPanel(undefined)
		expect(container.firstChild).toBeNull()
	})

	it("renders nothing when clineMessages is empty", () => {
		const { container } = renderPanel([])
		expect(container.firstChild).toBeNull()
	})

	it("renders nothing when there are no file-edit messages", () => {
		const messages: ClineMessage[] = [
			{
				type: "say",
				say: "text",
				ts: Date.now(),
				partial: false,
				text: "hello",
			},
			{
				type: "ask",
				ask: "tool",
				ts: Date.now(),
				partial: false,
				text: JSON.stringify({ tool: "read_file", path: "x.ts" }),
			},
		]
		const { container } = renderPanel(messages)
		expect(container.firstChild).toBeNull()
	})

	it("renders nothing when file-edit ask tool is not approved (isAnswered false or missing)", () => {
		const messages: ClineMessage[] = [
			{
				type: "ask",
				ask: "tool",
				ts: Date.now(),
				partial: false,
				text: JSON.stringify({
					tool: "appliedDiff",
					path: "src/foo.ts",
					diff: "+line",
				}),
			},
		]
		const { container } = renderPanel(messages)
		expect(container.firstChild).toBeNull()
	})

	it("renders panel with header when there is one file edit", () => {
		const messages = [createFileEditMessage("src/foo.ts", "@@ -1 +1 @@\n+line")]
		renderPanel(messages)

		expect(screen.getByText("1 file(s) changed in this conversation")).toBeInTheDocument()
		// Expand panel so file row is in DOM (CollapsibleContent may not render when closed in some setups)
		fireEvent.click(screen.getByText("1 file(s) changed in this conversation").closest("button")!)
		expect(screen.getByTestId("accordian-path")).toHaveTextContent("src/foo.ts")
	})

	it("renders one row per unique path when multiple files edited", () => {
		const messages = [createFileEditMessage("src/a.ts", "diff a"), createFileEditMessage("src/b.ts", "diff b")]
		renderPanel(messages)

		expect(screen.getByText("2 file(s) changed in this conversation")).toBeInTheDocument()
		// Expand panel so file rows are rendered
		fireEvent.click(screen.getByText("2 file(s) changed in this conversation").closest("button")!)
		const paths = screen.getAllByTestId("accordian-path")
		expect(paths).toHaveLength(2)
		expect(paths.map((el) => el.textContent)).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]))
	})

	it("collapsed by default: panel trigger shows chevron and expanding reveals file rows", () => {
		const messages = [createFileEditMessage("src/foo.ts", "diff")]
		renderPanel(messages)

		// Header visible
		const headerText = screen.getByText("1 file(s) changed in this conversation")
		expect(headerText).toBeInTheDocument()
		// Trigger is the button that contains the header text
		const trigger = headerText.closest("button")
		expect(trigger).toBeInTheDocument()

		// Expand panel
		fireEvent.click(trigger!)
		expect(screen.getByTestId("accordian-path")).toHaveTextContent("src/foo.ts")
	})

	it("toggling a file row expand calls onToggleExpand", () => {
		const messages = [createFileEditMessage("src/foo.ts", "diff")]
		renderPanel(messages)

		// Expand panel first so the file row is rendered
		const headerText = screen.getByText("1 file(s) changed in this conversation")
		fireEvent.click(headerText.closest("button")!)

		const accordianToggle = screen.getByTestId("accordian-toggle")
		expect(accordianToggle).toHaveTextContent("collapsed")
		fireEvent.click(accordianToggle)
		expect(accordianToggle).toHaveTextContent("expanded")
	})

	it("hides aggregate stats when no diffStats are present", () => {
		const messages = [createFileEditMessage("src/a.ts", "diff a"), createFileEditMessage("src/b.ts", "diff b")]
		renderPanel(messages)

		expect(screen.queryByTestId("total-added")).not.toBeInTheDocument()
		expect(screen.queryByTestId("total-removed")).not.toBeInTheDocument()
	})

	it("shows aggregated + and - totals in the header when diffStats are present", () => {
		const messages = [
			createFileEditMessage("src/a.ts", "diff a", { added: 3, removed: 1 }),
			createFileEditMessage("src/b.ts", "diff b", { added: 2, removed: 5 }),
		]
		renderPanel(messages)

		expect(screen.getByTestId("total-added")).toHaveTextContent("+5")
		expect(screen.getByTestId("total-removed")).toHaveTextContent("-6")
	})

	it("renders deleted files from extension state even when there are no file edits", () => {
		renderPanel([])
		broadcastDeletedFiles([{ relativePath: "src/old.ts", trashedAt: Date.now(), size: 10 }])

		expect(screen.getByText("0 file(s) changed (1 deleted, recoverable)")).toBeInTheDocument()
		fireEvent.click(screen.getByText("0 file(s) changed (1 deleted, recoverable)").closest("button")!)
		const row = screen.getByTestId("deleted-file-row")
		expect(row).toHaveTextContent("src/old.ts")
	})

	it("shows deleted files alongside modified files and counts them in the header", () => {
		const messages = [createFileEditMessage("src/foo.ts", "diff")]
		renderPanel(messages)
		broadcastDeletedFiles([{ relativePath: "src/old.ts", trashedAt: Date.now(), size: 10 }])

		expect(screen.getByText("1 file(s) changed (1 deleted, recoverable)")).toBeInTheDocument()
		fireEvent.click(screen.getByText("1 file(s) changed (1 deleted, recoverable)").closest("button")!)
		expect(screen.getByTestId("accordian-path")).toHaveTextContent("src/foo.ts")
		expect(screen.getByTestId("deleted-file-row")).toHaveTextContent("src/old.ts")
	})

	it("clicking restore on a deleted file posts restoreDeletedFile with the relative path", () => {
		renderPanel([])
		broadcastDeletedFiles([{ relativePath: "src/old.ts", trashedAt: Date.now(), size: 10 }])

		fireEvent.click(screen.getByText("0 file(s) changed (1 deleted, recoverable)").closest("button")!)
		fireEvent.click(screen.getByTestId("restore-deleted-file-btn"))

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "restoreDeletedFile", text: "src/old.ts" })
	})
})
