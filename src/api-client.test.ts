import assert from "node:assert/strict"
import test from "node:test"
import { CLI_VERSION, getKit, setApiClient } from "./api.js"

async function captureUserAgent(run: () => Promise<void>): Promise<string> {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	let userAgent = ""
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async (_input, init) => {
		userAgent = (init?.headers as Record<string, string>)["User-Agent"]
		return new Response(JSON.stringify({ data: {}, links: {} }))
	}
	try {
		await run()
	} finally {
		globalThis.fetch = originalFetch
		setApiClient()
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
	}
	return userAgent
}

// Assert the SHAPE against CLI_VERSION, not a literal version. These once
// hardcoded 0.3.2 and both failed on the 0.3.3 bump, which turns a release into
// a test edit and invites someone to "fix" it by loosening the assertion. What
// matters here is that the client prefix is right and a version is present;
// that the version is the correct one is version.test.ts's job.
test("API requests default to the CLI identity", async () => {
	const userAgent = await captureUserAgent(() => getKit("test"))
	assert.equal(userAgent, `identityforge-cli/${CLI_VERSION}`)
})

test("the caller can declare the MCP identity", async () => {
	const userAgent = await captureUserAgent(async () => {
		setApiClient("mcp")
		await getKit("test")
	})
	assert.equal(userAgent, `identityforge-mcp/${CLI_VERSION}`)
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
