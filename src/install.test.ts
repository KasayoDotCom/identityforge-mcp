import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { inspectClientConfig, installClient } from "./install.js"

function fixtureRoot(name: string): string {
	const root = join(tmpdir(), `identityforge-install-${process.pid}-${name}`)
	mkdirSync(root, { recursive: true })
	return root
}

test("Codex install is verified and leaves unrelated TOML intact", () => {
	const homeDir = fixtureRoot("codex-current")
	const file = join(homeDir, ".codex", "config.toml")
	mkdirSync(join(homeDir, ".codex"), { recursive: true })
	writeFileSync(file, 'model = "gpt-5"\n', "utf8")

	assert.equal(installClient("codex", { homeDir }), file)
	assert.match(readFileSync(file, "utf8"), /^model = "gpt-5"/)
	assert.deepEqual(inspectClientConfig("codex", { homeDir }), {
		client: "codex",
		file,
		configured: true,
		current: true,
	})
})

test("Codex install refuses to silently accept or overwrite a stale entry", () => {
	const homeDir = fixtureRoot("codex-stale")
	const file = join(homeDir, ".codex", "config.toml")
	mkdirSync(join(homeDir, ".codex"), { recursive: true })
	const stale =
		'[mcp_servers.identityforge]\ncommand = "npx"\nargs = ["-y", "identityforge@0.4.1", "mcp"]\n'
	writeFileSync(file, stale, "utf8")

	assert.throws(() => installClient("codex", { homeDir }), /does not run/)
	assert.equal(readFileSync(file, "utf8"), stale)
	assert.equal(inspectClientConfig("codex", { homeDir }).current, false)
})

test("JSON client install preserves other servers and verifies Identity Forge", () => {
	const cwd = fixtureRoot("cursor")
	const file = join(cwd, ".cursor", "mcp.json")
	mkdirSync(join(cwd, ".cursor"), { recursive: true })
	writeFileSync(
		file,
		JSON.stringify({ mcpServers: { other: { command: "other" } } }),
		"utf8",
	)

	installClient("cursor", { cwd })
	const config = JSON.parse(readFileSync(file, "utf8")) as {
		mcpServers: Record<string, unknown>
	}
	assert.deepEqual(config.mcpServers.other, { command: "other" })
	assert.equal(inspectClientConfig("cursor", { cwd }).current, true)
})
