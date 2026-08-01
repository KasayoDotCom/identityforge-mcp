import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo, Server } from "node:net"
import test from "node:test"
import { fileURLToPath } from "node:url"

// The revise half of the client loop: update-variation, remove-variation,
// reorder, themes update. api.ts already has write-parity coverage for the
// helpers these call, so what is untested is everything ABOVE the helper —
// the argv wiring, the guards, and the mapping from flags to a request body.
// That is where these commands can be wrong while every existing test passes.
//
// These drive the real CLI in a subprocess rather than calling an extracted
// helper, because two of the four behaviours under test (Commander's argument
// wiring, and a refusal that must happen before any request leaves) are
// properties of the command as assembled, not of a function it happens to call.

const CLI = fileURLToPath(new URL("./index.ts", import.meta.url))

interface Request {
	method: string
	url: string
	body: string
}

interface Run {
	code: number | null
	stdout: string
	stderr: string
	requests: Request[]
}

/** Run the CLI against a throwaway server that records what it received. */
async function runCli(
	args: string[],
	reply: unknown = { data: {} },
): Promise<Run> {
	const requests: Request[] = []
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = []
		req.on("data", (chunk: Buffer) => chunks.push(chunk))
		req.on("end", () => {
			requests.push({
				method: req.method ?? "",
				url: req.url ?? "",
				body: Buffer.concat(chunks).toString("utf8"),
			})
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify(reply))
		})
	})
	await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
	const { port } = server.address() as AddressInfo
	try {
		return await new Promise<Run>((resolve, reject) => {
			const child = spawn("npx", ["tsx", CLI, ...args], {
				env: {
					...process.env,
					IDENTITYFORGE_API_URL: `http://127.0.0.1:${port}`,
					IDENTITYFORGE_API_KEY: "ifk_test",
				},
			})
			let stdout = ""
			let stderr = ""
			child.stdout.on("data", (d) => {
				stdout += String(d)
			})
			child.stderr.on("data", (d) => {
				stderr += String(d)
			})
			child.on("error", reject)
			child.on("close", (code) => resolve({ code, stdout, stderr, requests }))
		})
	} finally {
		await new Promise<void>((ok) => server.close(() => ok()))
	}
}

test("remove-variation refuses without --yes, and sends nothing", async () => {
	const run = await runCli([
		"brand",
		"remove-variation",
		"--project",
		"p-1",
		"--variation",
		"v-2",
	])
	assert.equal(run.code, 1)
	// The assertion that earns its keep: not merely that it complained, but
	// that it complained BEFORE anything left the process. A guard that prints
	// a warning and deletes anyway is worse than no guard.
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /Nothing was deleted/)
	assert.match(run.stderr, /client comments/)
})

test("remove-variation with --yes DELETEs the variation", async () => {
	const run = await runCli([
		"brand",
		"remove-variation",
		"--project",
		"p-1",
		"--variation",
		"v-2",
		"--yes",
	])
	assert.equal(run.code, 0)
	assert.equal(run.requests.length, 1)
	assert.equal(run.requests[0].method, "DELETE")
	assert.equal(run.requests[0].url, "/api/v1/brand-projects/p-1/variations/v-2")
})

test("themes delete refuses without --yes, and sends nothing", async () => {
	const run = await runCli(["themes", "delete", "my-kit"])
	assert.equal(run.code, 1)
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /Would permanently delete kit "my-kit"/)
	assert.match(run.stderr, /--yes/)
	assert.match(run.stderr, /Nothing was deleted/)
})

test("themes delete with --yes DELETEs the kit", async () => {
	const run = await runCli(["themes", "delete", "my-kit", "--yes"])
	assert.equal(run.code, 0)
	assert.equal(run.requests.length, 1)
	assert.equal(run.requests[0].method, "DELETE")
	assert.equal(run.requests[0].url, "/api/v1/kits/my-kit")
})

test("remove-layer refuses without --yes, and DELETEs with it", async () => {
	const refused = await runCli([
		"brand",
		"remove-layer",
		"--project",
		"p-1",
		"--axis",
		"imageDirection",
		"--record",
		"rec-1",
	])
	assert.equal(refused.code, 1)
	assert.deepEqual(refused.requests, [])
	assert.match(refused.stderr, /Nothing was removed/)

	const run = await runCli([
		"brand",
		"remove-layer",
		"--project",
		"p-1",
		"--axis",
		"imageDirection",
		"--record",
		"rec-1",
		"--yes",
	])
	assert.equal(run.code, 0)
	assert.equal(run.requests.length, 1)
	assert.equal(run.requests[0].method, "DELETE")
	assert.equal(run.requests[0].url, "/api/v1/brand-projects/p-1/layers")
})

test("update-variation sends --clear fields as null and omits untouched ones", async () => {
	const run = await runCli([
		"brand",
		"update-variation",
		"--project",
		"p-1",
		"--variation",
		"v-2",
		"--label",
		"Warmer",
		"--clear",
		"notes,domain",
	])
	assert.equal(run.code, 0)
	const body = JSON.parse(run.requests[0].body) as Record<string, unknown>
	assert.equal(run.requests[0].method, "PATCH")
	assert.equal(body.label, "Warmer")
	// null is the clear instruction the helper documents. An omitted key means
	// "leave it", so these two must not collapse into each other.
	assert.equal(body.notes, null)
	assert.equal(body.domain, null)
	assert.ok(!("brandName" in body), "an untouched field must not be sent")
	assert.ok(!("projectId" in body), "the path id must not leak into the body")
})

test("update-variation refuses --clear on a field it is also setting", async () => {
	const run = await runCli([
		"brand",
		"update-variation",
		"--project",
		"p-1",
		"--variation",
		"v-2",
		"--notes",
		"keep",
		"--clear",
		"notes",
	])
	assert.equal(run.code, 1)
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /contradicts/)
})

test("reorder passes the variadic ids through in the order given", async () => {
	const run = await runCli([
		"brand",
		"reorder",
		"--project",
		"p-1",
		"v-3",
		"v-1",
		"v-2",
	])
	assert.equal(run.code, 0)
	assert.equal(
		run.requests[0].url,
		"/api/v1/brand-projects/p-1/variations/reorder",
	)
	assert.deepEqual(JSON.parse(run.requests[0].body), {
		variationIds: ["v-3", "v-1", "v-2"],
	})
})

test("themes update sends the marker verbatim and never reformats it", async () => {
	// As Postgres actually emits it: space separator, microseconds, offset.
	const marker = "2026-07-26 18:24:11.123456+02"
	const run = await runCli([
		"themes",
		"update",
		"my-kit",
		"--name",
		"Renamed",
		"--expected-updated-at",
		marker,
	])
	assert.equal(run.code, 0)
	assert.equal(run.requests[0].method, "PATCH")
	assert.equal(run.requests[0].url, "/api/v1/kits/my-kit")
	const body = JSON.parse(run.requests[0].body) as Record<string, unknown>
	// Byte for byte. Anything that parses and re-serialises this produces
	// ISO-8601, which never string-matches the stored value, so the guard 409s
	// forever; normalising instead drops the microseconds and can let a
	// genuinely stale write through.
	assert.equal(body.expectedUpdatedAt, marker)
	assert.notEqual(body.expectedUpdatedAt, new Date(marker).toISOString())
})

test("themes update warns on stderr when the write is unguarded", async () => {
	const run = await runCli(["themes", "update", "my-kit", "--name", "Renamed"])
	assert.equal(run.code, 0)
	// The write still goes through: this is a warning, not a second refusal.
	// The guard is opt-in on the server, and refusing here would break every
	// first edit made before a marker exists.
	assert.equal(run.requests.length, 1)
	assert.match(run.stderr, /no --expected-updated-at/)
	assert.match(run.stderr, /themes get --marker/)
})

test("themes update refuses a call with nothing to change", async () => {
	const run = await runCli(["themes", "update", "my-kit"])
	assert.equal(run.code, 1)
	// A metered write that changes nothing should not reach the server.
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /Nothing to update/)
})

// The share pair, which is the sharpest reversible/irreversible split in the
// CLI. Both were MCP-only until now: `brand share` created and rotated a link
// and nothing could pause or withdraw one.

test("revoke-share refuses without --yes, and sends nothing", async () => {
	const run = await runCli(["brand", "revoke-share", "--project", "p-1"])
	assert.equal(run.code, 1)
	assert.deepEqual(run.requests, [], "no request may leave before confirmation")
	// The refusal has to point at the reversible one. An agent that wanted to
	// pause a link and reads only "pass --yes" will pass --yes.
	assert.match(run.stderr, /update-share --disable/)
	assert.match(run.stderr, /Nothing was revoked/)
})

test("revoke-share with --yes DELETEs the share", async () => {
	const run = await runCli([
		"brand",
		"revoke-share",
		"--project",
		"p-1",
		"--yes",
	])
	assert.equal(run.code, 0)
	assert.equal(run.requests.length, 1)
	assert.equal(run.requests[0].method, "DELETE")
	assert.equal(run.requests[0].url, "/api/v1/brand-projects/p-1/share")
})

test("update-share sends --clear-password as null and --disable as false", async () => {
	const run = await runCli([
		"brand",
		"update-share",
		"--project",
		"p-1",
		"--disable",
		"--clear-password",
	])
	assert.equal(run.code, 0)
	assert.equal(run.requests[0].method, "PATCH")
	const body = JSON.parse(run.requests[0].body) as Record<string, unknown>
	assert.deepEqual(body, { enabled: false, password: null })
})

test("update-share refuses contradictory flags before sending", async () => {
	// Whichever one won silently would be the wrong one half the time, and the
	// caller would be told the link is in a state it is not.
	const both = await runCli([
		"brand",
		"update-share",
		"--project",
		"p-1",
		"--disable",
		"--enable",
	])
	assert.equal(both.code, 1)
	assert.deepEqual(both.requests, [])
	assert.match(both.stderr, /contradict/)

	const pw = await runCli([
		"brand",
		"update-share",
		"--project",
		"p-1",
		"--password",
		"hunter2",
		"--clear-password",
	])
	assert.equal(pw.code, 1)
	assert.deepEqual(pw.requests, [])
	assert.match(pw.stderr, /contradict/)
})

test("update-share refuses a call with nothing to change", async () => {
	// A PATCH with an empty body reads as success and changes nothing, which is
	// the failure that leaves someone believing a client link is paused.
	const run = await runCli(["brand", "update-share", "--project", "p-1"])
	assert.equal(run.code, 1)
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /Nothing to change/)
})

test("add-layer refuses an unknown axis before sending", async () => {
	const run = await runCli([
		"brand",
		"add-layer",
		"--project",
		"p-1",
		"--axis",
		"typography",
		"--record",
		"rec-1",
	])
	assert.equal(run.code, 1)
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /imageDirection, interfaceStyle, pageRecipe/)
})

test("themes create refuses when there is nothing to build from", async () => {
	// Neither --base nor --kit means the server would be asked to author a kit
	// from a name alone, which is a 400 the caller cannot act on.
	const run = await runCli(["themes", "create", "--name", "Acme"])
	assert.equal(run.code, 1)
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /--base/)
})
