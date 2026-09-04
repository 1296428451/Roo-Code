/**
 * Quick smoke test for FileSnapshotService.
 * Run: npx tsx src/services/checkpoints/__tests__/FileSnapshotService.spec.ts
 */
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { FileSnapshotService } from "../FileSnapshotService"

async function main() {
	// Create temp directories
	const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fs-snapshot-test-"))
	const taskDir = path.join(tmpRoot, "task-001")
	const workspaceDir = path.join(tmpRoot, "workspace")
	await fs.mkdir(taskDir, { recursive: true })
	await fs.mkdir(workspaceDir, { recursive: true })

	// Create a test file
	const testFile = path.join(workspaceDir, "src", "main.ts")
	await fs.mkdir(path.dirname(testFile), { recursive: true })
	await fs.writeFile(testFile, "console.log('hello')\n", "utf-8")

	const logs: string[] = []
	const service = new FileSnapshotService("task-001", taskDir, workspaceDir, (msg) => logs.push(msg))

	// Init
	await service.init()
	console.log("✅ Init OK, snapshots:", service.snapshots.length)

	// Save snapshot 1: before editing main.ts
	const snap1 = await service.saveSnapshot(
		[{ relativePath: "src/main.ts", content: "console.log('hello')\n" }],
		"write_to_file",
		"Edit main.ts",
	)
	console.log("✅ Snapshot 1 saved:", snap1?.id, "files:", snap1?.meta.files)

	// Modify the file
	await fs.writeFile(testFile, "console.log('world')\n", "utf-8")

	// Save snapshot 2: before second edit
	const snap2 = await service.saveSnapshot(
		[{ relativePath: "src/main.ts", content: "console.log('world')\n" }],
		"apply_diff",
		"Apply diff to main.ts",
	)
	console.log("✅ Snapshot 2 saved:", snap2?.id, "files:", snap2?.meta.files)

	// Modify again
	await fs.writeFile(testFile, "console.log('final')\n", "utf-8")

	// Verify current content
	const beforeRestore = await fs.readFile(testFile, "utf-8")
	console.log("✅ Before restore:", beforeRestore.trim())

	// Restore to snapshot 1
	await service.restoreSnapshot(snap1!.id)
	const afterRestore1 = await fs.readFile(testFile, "utf-8")
	console.log("✅ After restore to snap1:", afterRestore1.trim())
	if (afterRestore1 !== "console.log('hello')\n") {
		throw new Error(`Restore failed: expected "hello", got "${afterRestore1}"`)
	}

	// Verify snapshots after restore (snap2 should be removed)
	console.log("✅ Snapshots after restore:", service.snapshots.map(s => s.id))

	// Test recovery (simulate task reload)
	const service2 = new FileSnapshotService("task-001", taskDir, workspaceDir, (msg) => logs.push(msg))
	await service2.init()
	console.log("✅ Recovery: loaded", service2.snapshots.length, "snapshots")
	if (service2.snapshots.length !== 1) {
		throw new Error(`Expected 1 snapshot after recovery, got ${service2.snapshots.length}`)
	}

	// Test new file snapshot
	const newFileSnap = await service2.saveSnapshot(
		[{ relativePath: "src/new.ts", content: undefined }],
		"write_to_file",
		"Create new.ts",
	)
	console.log("✅ New file snapshot:", newFileSnap?.id)

	// Cleanup
	await fs.rm(tmpRoot, { recursive: true, force: true })
	console.log("✅ All tests passed!")
	console.log("Logs:", logs.join("\n"))
}

main().catch((err) => {
	console.error("❌ Test failed:", err)
	process.exit(1)
})
