import { execa, ExecaError } from "execa"
import psTree from "ps-tree"
import process from "process"

import type { RooTerminal } from "./types"
import { BaseTerminal } from "./BaseTerminal"
import { BaseTerminalProcess } from "./BaseTerminalProcess"

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private aborted = false
	private pid?: number
	private subprocess?: ReturnType<typeof execa>
	private pidUpdatePromise?: Promise<void>

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			this.terminal.busy = false
		})
	}

	public get terminal(): RooTerminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		this.command = command

		try {
			this.isHot = true

			this.subprocess = execa({
				shell: BaseTerminal.getExecaShellPath() || true,
				cwd: this.terminal.getCurrentWorkingDirectory(),
				all: true,
				// Capture raw bytes instead of letting execa decode them as UTF-8
				// (its default `encoding: "utf8"` silently turns non-UTF-8 output
				// into replacement characters before we ever see it). With
				// `encoding: "buffer"` the iterable below yields Uint8Array chunks
				// that we decode ourselves, per line. On Chinese Windows cmd.exe
				// built-ins (echo, dir, ...) write GBK/cp936 bytes to a pipe no
				// matter what `chcp` says, while other tools (see PYTHONUTF8) may
				// write UTF-8, so a single fixed decoder cannot be correct.
				encoding: "buffer",
				// Ignore stdin to ensure non-interactive mode and prevent hanging
				stdin: "ignore",
				env: {
					...process.env,
					// Ensure UTF-8 encoding for Unix tools (Ruby, CocoaPods, etc.)
					LANG: "en_US.UTF-8",
					LC_ALL: "en_US.UTF-8",
					// Force Python (a frequent source of CJK output) to emit UTF-8 on Windows
					PYTHONUTF8: "1",
					PYTHONIOENCODING: "utf-8",
				},
			})`${command}`

			this.pid = this.subprocess.pid

			// When using shell: true, the PID is for the shell, not the actual command
			// Find the actual command PID after a small delay
			if (this.pid) {
				this.pidUpdatePromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						psTree(this.pid!, (err, children) => {
							if (!err && children.length > 0) {
								// Update PID to the first child (the actual command)
								const actualPid = parseInt(children[0].PID)
								if (!isNaN(actualPid)) {
									this.pid = actualPid
								}
							}
							resolve()
						})
					}, 100)
				})
			}

			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })

			// `encoding: "buffer"` above makes the iterable yield raw Uint8Array
			// chunks. Buffer bytes and decode at line boundaries so multi-byte
			// sequences spanning chunks stay intact (never decode per chunk: a
			// chunk boundary can split a multi-byte character). On Chinese Windows
			// cmd.exe built-ins emit GBK (cp936) while most other tools emit UTF-8,
			// so each line is decoded adaptively - see decodeLine below.
			let byteBuffer = new Uint8Array(0)

			// Characters that effectively never occur in ordinary Chinese or
			// English terminal output, yet appear constantly when GBK bytes are
			// misread as UTF-8. Examples: GBK "目录" (c4 bf c2 bc) is valid UTF-8
			// and would decode to "Ŀ¼"; GBK "系统" (cf b5 cd b3) decodes to the
			// Greek "ϵͳ".
			const looksLikeGbkMisdecodedAsUtf8 = (text: string): boolean =>
				/[\u0100-\u02ff\u0370-\u03ff\u0400-\u04ff\ufffd\ue000-\uf8ff]/.test(text)

			const decodeGbk = (line: Uint8Array): string => {
				try {
					return new TextDecoder("gbk").decode(line)
				} catch {
					return new TextDecoder("utf-8", { fatal: false }).decode(line)
				}
			}

			const decodeLine = (line: Uint8Array): string => {
				let utf8: string
				try {
					utf8 = new TextDecoder("utf-8", { fatal: true }).decode(line)
				} catch {
					// Not valid UTF-8: on Chinese Windows this is GBK (cp936).
					return decodeGbk(line)
				}
				// Valid UTF-8, but GBK bytes for CJK can coincidentally be valid
				// UTF-8 and decode into bare Latin-Extended/Greek/Cyrillic runs
				// (e.g. "系统" -> "ϵͳ"). Real UTF-8 text that legitimately contains
				// such characters almost always sits next to ASCII letters (e.g.
				// "alpha=α"), whereas GBK mojibake is bare. So only fall back to
				// GBK for bare-looking mojibake that GBK then decodes cleanly.
				if (!looksLikeGbkMisdecodedAsUtf8(utf8) || /[A-Za-z]/.test(utf8)) {
					return utf8
				}
				const gbk = decodeGbk(line)
				return looksLikeGbkMisdecodedAsUtf8(gbk) ? utf8 : gbk
			}
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					if (typeof chunk === "string") {
						yield chunk
						continue
					}
					const merged = new Uint8Array(byteBuffer.length + chunk.length)
					merged.set(byteBuffer)
					merged.set(chunk, byteBuffer.length)
					byteBuffer = merged
					let nl: number
					while ((nl = byteBuffer.indexOf(0x0a)) !== -1) {
						const lineBytes = byteBuffer.subarray(0, nl + 1)
						yield decodeLine(lineBytes)
						byteBuffer = byteBuffer.subarray(nl + 1)
					}
				}
				if (byteBuffer.length > 0) {
					yield decodeLine(byteBuffer)
				}
			})()

			this.terminal.setActiveStream(stream, this.pid)

			for await (const line of stream) {
				if (this.aborted) {
					break
				}

				this.fullOutput += line

				const now = Date.now()

				if (this.isListening && (now - this.lastEmitTime_ms > 500 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

				this.startHotTimer(line)
			}

			if (this.aborted) {
				let timeoutId: NodeJS.Timeout | undefined

				const kill = new Promise<void>((resolve) => {
					console.log(`[ExecaTerminalProcess#run] SIGKILL -> ${this.pid}`)

					timeoutId = setTimeout(() => {
						try {
							this.subprocess?.kill("SIGKILL")
						} catch (e) {}

						resolve()
					}, 5_000)
				})

				try {
					await Promise.race([this.subprocess, kill])
				} catch (error) {
					console.log(
						`[ExecaTerminalProcess#run] subprocess termination error: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}

			this.emit("shell_execution_complete", { exitCode: 0 })
		} catch (error) {
			if (error instanceof ExecaError) {
				console.error(`[ExecaTerminalProcess#run] shell execution error: ${error.message}`)
				this.emit("shell_execution_complete", { exitCode: error.exitCode ?? 0, signalName: error.signal })
			} else {
				console.error(
					`[ExecaTerminalProcess#run] shell execution error: ${error instanceof Error ? error.message : String(error)}`,
				)

				this.emit("shell_execution_complete", { exitCode: 1 })
			}
			this.subprocess = undefined
		}

		this.terminal.setActiveStream(undefined)
		this.emitRemainingBufferIfListening()
		this.stopHotTimer()
		this.emit("completed", this.fullOutput)
		this.emit("continue")
		this.subprocess = undefined
	}

	public override continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.aborted = true

		// Function to perform the kill operations
		const performKill = () => {
			// Try to kill using the subprocess object
			if (this.subprocess) {
				try {
					this.subprocess.kill("SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill subprocess: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}

			// Kill the stored PID (which should be the actual command after our update)
			if (this.pid) {
				try {
					process.kill(this.pid, "SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill process ${this.pid}: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}
		}

		// If PID update is in progress, wait for it before killing
		if (this.pidUpdatePromise) {
			this.pidUpdatePromise.then(performKill).catch(() => performKill())
		} else {
			performKill()
		}

		// Continue with the rest of the abort logic
		if (this.pid) {
			// Also check for any child processes
			psTree(this.pid, async (err, children) => {
				if (!err) {
					const pids = children.map((p) => parseInt(p.PID))

					for (const pid of pids) {
						try {
							process.kill(pid, "SIGKILL")
						} catch (e) {
							console.warn(
								`[ExecaTerminalProcess#abort] Failed to send SIGKILL to child PID ${pid}: ${e instanceof Error ? e.message : String(e)}`,
							)
						}
					}
				} else {
					console.error(
						`[ExecaTerminalProcess#abort] Failed to get process tree for PID ${this.pid}: ${err.message}`,
					)
				}
			})
		}
	}

	public override hasUnretrievedOutput() {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput() {
		let output = this.fullOutput.slice(this.lastRetrievedIndex)
		let index = output.lastIndexOf("\n")

		if (index === -1) {
			return ""
		}

		index++
		this.lastRetrievedIndex += index

		// console.log(
		// 	`[ExecaTerminalProcess#getUnretrievedOutput] fullOutput.length=${this.fullOutput.length} lastRetrievedIndex=${this.lastRetrievedIndex}`,
		// 	output.slice(0, index),
		// )

		return output.slice(0, index)
	}

	private emitRemainingBufferIfListening() {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}
}
