import assert from "node:assert/strict"
import test from "node:test"
import {
	COLLECTION_EXPORT_FORMATS,
	COLLECTION_SORTS,
	COLLECTION_TIERS,
	INTERFACE_STYLE_FAMILIES,
	KIT_USE_CASES,
	getInterfaceStyle,
	listInterfaceStyles,
} from "./api.js"

test("Interface Style CLI vocabulary stays aligned with the API contract", () => {
	assert.deepEqual(INTERFACE_STYLE_FAMILIES, [
		"surface-material",
		"system-typographic",
		"era-motif",
		"screen-native",
		"treatment",
	])
	assert.deepEqual(COLLECTION_TIERS, ["free", "pro"])
	assert.deepEqual(COLLECTION_SORTS, ["curated", "az", "free-first"])
	assert.deepEqual(COLLECTION_EXPORT_FORMATS, ["markdown", "json"])
	assert.ok(KIT_USE_CASES.includes("saas-marketing"))
})

test("Interface Style CLI helpers call the versioned routes with canonical filters", async () => {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	const urls: string[] = []
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async (input) => {
		urls.push(String(input))
		return new Response(JSON.stringify({ data: [] }), {
			headers: { "content-disposition": 'inline; filename="flat.json"' },
		})
	}

	try {
		await listInterfaceStyles({
			q: "soft ui",
			use: "saas-marketing",
			family: ["era-motif", "surface-material"],
			tier: ["free", "pro"],
			sort: "az",
		})
		const result = await getInterfaceStyle("flat", "json")

		assert.equal(
			urls[0],
			"http://api.test/api/v1/interface-styles?q=soft+ui&use=saas-marketing&family=era-motif%2Csurface-material&tier=free%2Cpro&sort=az",
		)
		assert.equal(
			urls[1],
			"http://api.test/api/v1/interface-styles/flat/export?format=json",
		)
		assert.equal(result.filename, "flat.json")
	} finally {
		globalThis.fetch = originalFetch
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
	}
})
