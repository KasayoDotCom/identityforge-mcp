import assert from "node:assert/strict"
import test from "node:test"
import { inspectCurrentMcp } from "./doctor.js"

test("doctor initializes the MCP server and finds every product capability", async () => {
	const diagnostic = await inspectCurrentMcp()
	assert.ok(diagnostic.toolCount > 30)
	assert.deepEqual(diagnostic.missingRequiredTools, [])
	assert.deepEqual(diagnostic.capabilities, {
		designSystems: true,
		brandDelivery: true,
		naming: true,
		domains: true,
	})
})
