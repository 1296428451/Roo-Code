/**
 * Quick test for FileSnapshotService diff functionality
 */
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { FileSnapshotService } from "../FileSnapshotService"

async function main() {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-diff-test-"))
	const taskDir = path.join(tmpDir, "task-001")
	const workspaceDir = path.join(tmpDir, "workspace")
	await fs.mkdir(workspaceDir, { recursive: true })

	const svc = new FileSnapshotService("task-001", taskDir, workspaceDir, (m) => console.log(m))
	await svc.init()

	// Create initial file
	const filePath = path.join(workspaceDir, "src/main.ts")
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, "console.log('hello')", "utf-8")

	// Snapshot 1: before first edit (content = "console.log('hello')")
	const snap1 = await svc.saveSnapshot(
		[{ relativePath: "src/main.ts", content: "console.log('hello')" }],
		"write_to_file",
		"first write"
	)
	console.log("✅ Snapshot 1:", snap1?.id)

	// Simulate the write tool modifying the file
	await fs.writeFile(filePath, "console.log('world')", "utf-8")

	// Snapshot 2: before second edit (content = "console.log('world')")
	const snap2 = await svc.saveSnapshot(
		[{ relativePath: "src/main.ts", content: "console.log('world')" }],
		"apply_diff",
		"second write"
	)
	console.log("✅ Snapshot 2:", snap2?.id)

	// Simulate second edit
	await fs.writeFile(filePath, "console.log('final')", "utf-8")

	// Test 1: Diff between snap1 and snap2 ("checkpoint" mode)
	const diff1 = await svc.getDiff({ from: snap1!.id, to: snap2!.id })
	console.log("\n=== Diff snap1 → snap2 ===")
	for (const c of diff1) {
		console.log(`  ${c.type}: ${c.paths.relative}`)
		console.log(`    before: ${JSON.stringify(c.before)}`)
		console.log(`    after:  ${JSON.stringify(c.after)}`)
	}
	assert(diff1.length > 0, "Should have changes between snap1 and snap2")
	assert(diff1[0].before === "console.log('hello')", "snap1 content should be 'hello'")
	assert(diff1[0].after === "console.log('world')", "snap2 content should be 'world'")
	console.log("✅ Diff snap1→snap2 correct")

	// Test 2: Diff from snap1 to current workspace ("to-current" mode)
	const diff2 = await svc.getDiff({ from: snap1!.id, to: undefined })
	console.log("\n=== Diff snap1 → current ===")
	for (const c of diff2) {
		console.log(`  ${c.type}: ${c.paths.relative}`)
		console.log(`    before: ${JSON.stringify(c.before)}`)
		console.log(`    after:  ${JSON.stringify(c.after)}`)
	}
	assert(diff2.length > 0, "Should have changes between snap1 and current")
	assert(diff2[0].before === "console.log('hello')", "snap1 content should be 'hello'")
	assert(diff2[0].after === "console.log('final')", "current content should be 'final'")
	console.log("✅ Diff snap1→current correct")

	// Test 3: Diff from first snapshot (from-init, no from specified)
	const diff3 = await svc.getDiff({ from: undefined, to: snap2!.id })
	console.log("\n=== Diff first → snap2 ===")
	for (const c of diff3) {
		console.log(`  ${c.type}: ${c.paths.relative}`)
		console.log(`    before: ${JSON.stringify(c.before)}`)
		console.log(`    after:  ${JSON.stringify(c.after)}`)
	}
	assert(diff3.length > 0, "Should have changes")
	assert(diff3[0].before === "console.log('hello')", "first snap content should be 'hello'")
	assert(diff3[0].after === "console.log('world')", "snap2 content should be 'world'")
	console.log("✅ Diff first→snap2 correct")

	// Test 4: No changes (diff snap1 to snap1)
	const diff4 = await svc.getDiff({ from: snap1!.id, to: snap1!.id })
	console.log("\n=== Diff snap1 → snap1 (should be empty) ===")
	console.log(`  changes: ${diff4.length}`)
	assert(diff4.length === 0, "Same snapshot should have no changes")
	console.log("✅ Diff snap1→snap1 is empty")

	// Test 5: Full diff (first → current)
	const diff5 = await svc.getDiff({ from: undefined, to: undefined })
	console.log("\n=== Diff first → current (full) ===")
	for (const c of diff5) {
		console.log(`  ${c.type}: ${c.paths.relative}`)
		console.log(`    before: ${JSON.stringify(c.before)}`)
		console.log(`    after:  ${JSON.stringify(c.after)}`)
	}
	assert(diff5.length > 0, "Full diff should have changes")
	assert(diff5[0].before === "console.log('hello')", "first snap should be 'hello'")
	assert(diff5[0].after === "console.log('final')", "current should be 'final'")
	console.log("✅ Full diff correct")

	// Cleanup
	await fs.rm(tmpDir, { recursive: true, force: true })

	console.log("\n🎉 All diff tests passed!")
}

function assert(condition: boolean, message: string) {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`)
	}
}

main().catch(console.error)
