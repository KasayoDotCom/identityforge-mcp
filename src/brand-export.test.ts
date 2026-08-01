import assert from "node:assert/strict"
import test from "node:test"
import { ApiError, exportBrandProject } from "./api.js"

// The composed export is the one response here whose meaning lives in HEADERS
// as much as in the body: how many layers went in, which contract shaped the
// document, which kit it was composed on. A body that arrives without them
// still looks like a valid DESIGN.md, so nothing downstream would notice.

interface Stub {
	body?: string
	status?: number
	headers?: Record<string, string>
}

async function withStubbedFetch<T>(
	stub: Stub,
	run: () => Promise<T>,
): Promise<{ result: T | undefined; error: unknown; urls: string[] }> {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	const urls: string[] = []
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async (input) => {
		urls.push(String(input))
		return new Response(stub.body ?? "", {
			status: stub.status ?? 200,
			headers: stub.headers ?? {},
		})
	}
	let result: T | undefined
	let error: unknown
	try {
		result = await run()
	} catch (err) {
		error = err
	} finally {
		globalThis.fetch = originalFetch
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
	}
	return { result, error, urls }
}

const DOC = "---\nkit: ambient-sage\n---\n\n# Northline\n"

test("it asks the owner-scoped route for the one format that route serves", async () => {
	const { urls } = await withStubbedFetch({ body: DOC }, () =>
		exportBrandProject({ projectId: "a b/c" }),
	)
	assert.equal(
		urls[0],
		"http://api.test/api/v1/brand-projects/a%20b%2Fc/export?format=design-md",
	)
})

test("the document comes back verbatim, and its stamp comes off the headers", async () => {
	const { result } = await withStubbedFetch(
		{
			body: DOC,
			headers: {
				"content-type": "text/markdown; charset=utf-8",
				"content-disposition": 'inline; filename="northline-DESIGN.md"',
				"x-identityforge-composed-layers": "3",
				"x-identityforge-composed-contract-version": "1.0",
				"x-identityforge-kit-id": "kit_123",
				"x-identityforge-kit-slug": "ambient-sage",
				"x-identityforge-kit-version": "7",
			},
		},
		() => exportBrandProject({ projectId: "p1" }),
	)
	assert.equal(result?.body, DOC)
	assert.equal(result?.filename, "northline-DESIGN.md")
	assert.equal(result?.layerCount, 3)
	assert.equal(result?.contractVersion, "1.0")
	assert.equal(result?.kitId, "kit_123")
	assert.equal(result?.kitSlug, "ambient-sage")
	assert.equal(result?.kitVersion, "7")
})

test("zero layers is a real answer and never a missing one", async () => {
	// A brand that composes nothing gets its kit's document back. Reporting that
	// as unknown would push the caller to explain an absence that is not there.
	const { result } = await withStubbedFetch(
		{ body: DOC, headers: { "x-identityforge-composed-layers": "0" } },
		() => exportBrandProject({ projectId: "p1" }),
	)
	assert.equal(result?.layerCount, 0)
	assert.equal(result?.contractVersion, null)
})

test("a header that is missing or unparseable does not become NaN", async () => {
	// `Composed NaN layer(s)` is the failure this exists to stop: it reaches the
	// user as a sentence rather than as an error anyone would investigate.
	const cases: Record<string, string>[] = [
		{},
		{ "x-identityforge-composed-layers": "many" },
	]
	for (const headers of cases) {
		const { result } = await withStubbedFetch({ body: DOC, headers }, () =>
			exportBrandProject({ projectId: "p1" }),
		)
		assert.equal(result?.layerCount, 0)
	}
})

test("a brand with no kit surfaces the server's 409, not an empty document", async () => {
	// The dangerous failure mode is a caller writing an empty or partial file
	// into somebody's repo because a refusal was read as a body.
	const { result, error } = await withStubbedFetch(
		{
			status: 409,
			body: JSON.stringify({
				code: "no_kit_chosen",
				error: "This brand has not chosen a design kit yet.",
				links: { kits: "/api/v1/kits" },
			}),
			headers: { "content-type": "application/json" },
		},
		() => exportBrandProject({ projectId: "p1" }),
	)
	assert.equal(result, undefined)
	assert.ok(error instanceof ApiError)
	assert.equal((error as ApiError).status, 409)
	assert.match((error as ApiError).message, /has not chosen a design kit/)
	// The links a caller can still act on survive as absolute urls.
	assert.equal(
		(error as ApiError).details?.links &&
			((error as ApiError).details?.links as Record<string, string>).kits,
		"http://api.test/api/v1/kits",
	)
})

test("the download name is never taken from a hostile Content-Disposition", async () => {
	// IDENTITYFORGE_API_URL is overridable, so the base is not necessarily ours.
	const { result } = await withStubbedFetch(
		{
			body: DOC,
			headers: {
				"content-disposition": 'inline; filename="../../.ssh/authorized_keys"',
			},
		},
		() => exportBrandProject({ projectId: "p1" }),
	)
	assert.equal(result?.filename, "p1.md")
})
