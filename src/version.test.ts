import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { CLI_VERSION } from "./api.js"

// CLI_VERSION drives serverInfo.version, `identityforge --version`, and the
// User-Agent. It is hardcoded, so a release that bumps package.json alone would
// ship a server reporting a stale version to clients and to the MCP registry.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const readJson = (file: string): Record<string, unknown> =>
	JSON.parse(readFileSync(join(packageRoot, file), "utf8"))

test("CLI_VERSION matches package.json", () => {
	assert.equal(CLI_VERSION, readJson("package.json").version)
})

test("every CLI start triggers the non-blocking update check", () => {
	const source = readFileSync(join(packageRoot, "src/index.ts"), "utf8")
	assert.match(source, /startUpdateCheck\(CLI_VERSION\)/)
})

test("package-lock.json matches package.json", () => {
	const lock = readJson("package-lock.json") as {
		version: string
		packages: { "": { version: string } }
	}
	assert.equal(lock.version, CLI_VERSION)
	assert.equal(lock.packages[""].version, CLI_VERSION)
})

test("server.json declares the same version as package.json", () => {
	const server = readJson("server.json") as {
		name: string
		version: string
		packages: { version: string }[]
	}
	assert.equal(server.name, readJson("package.json").mcpName)
	assert.equal(server.version, CLI_VERSION)
	assert.equal(server.packages[0].version, CLI_VERSION)
})

// The README tells an agent how many tools it gets the moment it connects. That
// number was hand-written, said 36, and the server registers 56 — an
// independent cold read of the agent-facing surface flagged it as the reason it
// could not trust the inventory until runtime. A count a human maintains beside
// a list a machine generates only ever drifts one way.
test("the README's advertised tool count matches what the server registers", () => {
	const mcpSource = readFileSync(join(packageRoot, "src/mcp.ts"), "utf8")
	// registerTool( is followed by the tool name on the NEXT line.
	const registered = new Set(
		[...mcpSource.matchAll(/registerTool\(\s*\n?\s*"([a-z][a-z0-9_]*)"/g)].map(
			(m) => m[1],
		),
	)
	const readme = readFileSync(join(packageRoot, "README.md"), "utf8")
	const advertised = readme.match(/your agent gets (\d+) tools/)

	assert.ok(
		advertised,
		"README no longer states a tool count in the known form",
	)
	assert.equal(
		Number(advertised[1]),
		registered.size,
		`README advertises ${advertised[1]} tools; src/mcp.ts registers ${registered.size}`,
	)
})

test("public manifests advertise the public source repository", () => {
	assert.deepEqual(readJson("package.json").repository, {
		type: "git",
		url: "git+https://github.com/KasayoDotCom/identityforge-mcp.git",
	})
	assert.deepEqual(readJson("server.json").repository, {
		url: "https://github.com/KasayoDotCom/identityforge-mcp",
		source: "github",
		id: "1318437995",
	})
})
