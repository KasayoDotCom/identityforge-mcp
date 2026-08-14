import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"

const packageJson = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
)
const child = spawn(process.execPath, ["dist/index.js", "mcp"], {
	cwd: new URL("..", import.meta.url),
	stdio: ["pipe", "pipe", "pipe"],
})

let stdout = ""
let stderr = ""
child.stdout.setEncoding("utf8")
child.stderr.setEncoding("utf8")
child.stdout.on("data", (chunk) => {
	stdout += chunk
})
child.stderr.on("data", (chunk) => {
	stderr += chunk
})

const timeout = setTimeout(() => {
	child.kill()
	throw new Error(`MCP smoke test timed out. stderr: ${stderr}`)
}, 5000)

function send(message) {
	child.stdin.write(`${JSON.stringify(message)}\n`)
}

send({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "prepublish-smoke", version: "1" },
	},
})

while (!stdout.includes('"id":1')) {
	await new Promise((resolve) => setTimeout(resolve, 10))
}
const initialize = JSON.parse(stdout.trim().split("\n")[0])
assert.equal(initialize.result.serverInfo.version, packageJson.version)

send({ jsonrpc: "2.0", method: "notifications/initialized" })
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })

while (!stdout.includes('"id":2')) {
	await new Promise((resolve) => setTimeout(resolve, 10))
}
const messages = stdout
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line))
const tools = messages.find((message) => message.id === 2).result.tools
const names = new Set(tools.map((tool) => tool.name))
assert.ok(names.has("whoami"))
assert.ok(names.has("check_domains"))
assert.ok(names.has("export_brand"))

clearTimeout(timeout)
child.stdin.end()
child.kill()
process.stdout.write(
	`MCP smoke passed: ${packageJson.version}, ${tools.length} tools.\n`,
)
