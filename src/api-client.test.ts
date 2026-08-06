import assert from "node:assert/strict"
import test from "node:test"
import {
	CLI_VERSION,
	getKit,
	setApiClient,
	setDeclaredAgentSource,
} from "./api.js"

async function captureHeaders(
	run: () => Promise<void>,
): Promise<Array<Record<string, string>>> {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	const headers: Array<Record<string, string>> = []
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async (_input, init) => {
		headers.push({ ...(init?.headers as Record<string, string>) })
		return new Response(JSON.stringify({ data: {}, links: {} }))
	}
	try {
		await run()
	} finally {
		globalThis.fetch = originalFetch
		setApiClient()
		setDeclaredAgentSource(null)
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
	}
	return headers
}

// Assert the SHAPE against CLI_VERSION, not a literal version. These once
// hardcoded 0.3.2 and both failed on the 0.3.3 bump, which turns a release into
// a test edit and invites someone to "fix" it by loosening the assertion. What
// matters here is that the client prefix is right and a version is present;
// that the version is the correct one is version.test.ts's job.
test("API requests default to the CLI identity", async () => {
	const [headers] = await captureHeaders(() => getKit("test"))
	assert.equal(headers?.["User-Agent"], `identityforge-cli/${CLI_VERSION}`)
})

test("the caller can declare the MCP identity", async () => {
	const [headers] = await captureHeaders(async () => {
		setApiClient("mcp")
		await getKit("test")
	})
	assert.equal(headers?.["User-Agent"], `identityforge-mcp/${CLI_VERSION}`)
})

// MCP clients name themselves in the initialize handshake, with no convention
// between them: kebab-case, PascalCase, spaces and package names all ship today.
// The API only records `^[a-z][a-z0-9][a-z0-9._-]{0,38}$`, so anything that will
// not survive that has to be dropped here rather than sent and silently ignored.
test("an MCP client name is normalized into the declared-agent header", async () => {
	for (const [reported, expected] of [
		["claude-code", "claude-code"],
		["Visual Studio Code", "visual-studio-code"],
		["Codex", "codex"],
		["com.raycast.macos", "com.raycast.macos"],
	] as const) {
		const [headers] = await captureHeaders(async () => {
			setDeclaredAgentSource(() => reported)
			await getKit("test")
		})
		assert.equal(headers?.["X-Agent-Client"], expected)
	}
})

test("an unusable MCP client name is dropped, not sent", async () => {
	for (const reported of [undefined, "", "  ", "1password", "***", "x"]) {
		const [headers] = await captureHeaders(async () => {
			setDeclaredAgentSource(() => reported)
			await getKit("test")
		})
		assert.equal(headers?.["X-Agent-Client"], undefined)
	}
})

test("first-party requests share one random process reference", async () => {
	const headers = await captureHeaders(async () => {
		await getKit("first")
		await getKit("second")
	})
	const references = headers.map((item) => item["X-IdentityForge-Process"])
	assert.match(
		references[0] ?? "",
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	)
	assert.equal(references[1], references[0])
})

test("process telemetry has a visible environment opt-out", async () => {
	const previous = process.env.IDENTITYFORGE_TELEMETRY
	process.env.IDENTITYFORGE_TELEMETRY = "0"
	try {
		const [headers] = await captureHeaders(async () => {
			setDeclaredAgentSource(() => "claude-code")
			await getKit("test")
		})
		assert.equal(headers?.["X-IdentityForge-Process"], undefined)
		assert.equal(headers?.["X-Agent-Client"], undefined)
	} finally {
		if (previous === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_TELEMETRY")
		else process.env.IDENTITYFORGE_TELEMETRY = previous
	}
})

test("a newer server minimum CLI is warned once without failing requests", async () => {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	const originalWrite = process.stderr.write
	let warnings = ""
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ data: {}, links: {} }), {
			headers: { "x-identityforge-min-cli": "999.0.0" },
		})
	process.stderr.write = ((chunk: string | Uint8Array) => {
		warnings += String(chunk)
		return true
	}) as typeof process.stderr.write
	try {
		await getKit("first")
		await getKit("second")
	} finally {
		globalThis.fetch = originalFetch
		process.stderr.write = originalWrite
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
	}
	assert.equal((warnings.match(/server requires CLI/g) ?? []).length, 1)
	assert.match(warnings, /npm i -g identityforge@latest/)
})
