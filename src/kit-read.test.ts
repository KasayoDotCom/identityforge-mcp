import assert from "node:assert/strict"
import test from "node:test"
import { getKit } from "./api.js"

// Reading a kit without writing files, and the stale-write marker that comes
// with it. The marker is the part worth pinning: it crosses the wire as a raw
// Postgres timestamp, the guard compares STRINGS, and every plausible attempt
// to be helpful with it breaks the guard in one of two directions.

/** As Postgres actually emits it: space separator, microseconds, offset. */
const MARKER = "2026-07-26 18:24:11.123456+02"

interface Call {
	url: string
	method: string
}

async function withStubbedFetch(
	run: () => Promise<void>,
	payload: unknown,
): Promise<Call[]> {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	const calls: Call[] = []
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async (input, init) => {
		calls.push({ url: String(input), method: init?.method ?? "GET" })
		return new Response(JSON.stringify(payload))
	}
	try {
		await run()
	} finally {
		globalThis.fetch = originalFetch
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
	}
	return calls
}

test("getKit reads the kit route by id or slug and carries the marker", async () => {
	const calls = await withStubbedFetch(
		async () => {
			const detail = await getKit("acid signal black")
			assert.deepEqual(detail.kit, { slug: "acid-signal-black", tier: "free" })
			assert.equal(detail.updatedAt, MARKER)
		},
		{
			data: { slug: "acid-signal-black", tier: "free" },
			links: { exports: "e", registry: "r", page: "p" },
			meta: { updatedAt: MARKER },
		},
	)

	assert.equal(calls.length, 1)
	// The identifier is a path segment, so it must be encoded, not interpolated.
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/kits/acid%20signal%20black",
	)
	assert.equal(calls[0].method, "GET")
})

test("the marker survives byte for byte, and is not normalised into a Date", async () => {
	await withStubbedFetch(
		async () => {
			const { updatedAt } = await getKit("acid-signal-black")
			assert.equal(updatedAt, MARKER)

			// This is the assertion that earns its keep. If anyone ever "tidies"
			// the marker by parsing it, both failure modes below become live:
			//   - re-serialising never string-matches, so the guard 409s forever;
			//   - Date drops the microseconds, so a normalising comparison can
			//     falsely match and let a genuinely stale write through.
			const parsed = new Date(MARKER).toISOString()
			assert.notEqual(updatedAt, parsed)
			assert.ok(
				updatedAt?.includes(" ") && updatedAt.includes(".123456"),
				"the raw Postgres shape (space separator, microseconds) must survive",
			)
		},
		{ data: {}, links: {}, meta: { updatedAt: MARKER } },
	)
})

test("a curated kit reports no marker rather than inventing one", async () => {
	await withStubbedFetch(
		async () => {
			// A curated static kit has no row, so nothing to guard and nothing to
			// report. null, never a fabricated timestamp.
			assert.equal((await getKit("curated")).updatedAt, null)
		},
		{ data: {}, links: {}, meta: { updatedAt: null } },
	)

	await withStubbedFetch(async () => {
		// And an older server that omits `meta` entirely must not throw.
		assert.equal((await getKit("curated")).updatedAt, null)
	}, {})
})
