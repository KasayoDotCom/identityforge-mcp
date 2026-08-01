import assert from "node:assert/strict"
import test from "node:test"
import { addNamingCandidates } from "./api.js"

test("addNamingCandidates preserves caller ids and posts to the project candidate collection", async () => {
	const originalFetch = globalThis.fetch
	const originalUrl = process.env.IDENTITYFORGE_API_URL
	const originalKey = process.env.IDENTITYFORGE_API_KEY
	const projectId = "31f8de1f-898b-4582-9afe-f08a6ec649ed"
	const candidateId = "effbb2c7-18eb-4f55-bd89-de32138be697"
	let request: { url: string; init?: RequestInit } | undefined

	process.env.IDENTITYFORGE_API_URL = "https://identity-forge.test/"
	process.env.IDENTITYFORGE_API_KEY = "ifk_test"
	globalThis.fetch = async (input, init) => {
		request = { url: String(input), init }
		return new Response(
			JSON.stringify({
				data: [
					{
						id: candidateId,
						projectId,
						name: "Calivo",
						description: "Warm, accessible, and easy to pronounce.",
						status: "shortlisted",
						rank: 1,
						notes: "Generated with Codex exec.",
						evidence: { source: "codex-exec" },
						recipeId: null,
						generationId: null,
						generationDescription: null,
						createdAt: "2026-07-11T12:00:00.000Z",
						updatedAt: "2026-07-11T12:00:00.000Z",
					},
				],
			}),
			{ status: 201, headers: { "Content-Type": "application/json" } },
		)
	}

	try {
		const result = await addNamingCandidates({
			projectId,
			candidates: [
				{
					candidateId,
					name: "Calivo",
					description: "Warm, accessible, and easy to pronounce.",
					status: "shortlisted",
					rank: 1,
					notes: "Generated with Codex exec.",
					evidence: { source: "codex-exec" },
				},
			],
		})

		assert.equal(result[0]?.id, candidateId)
		assert.equal(
			request?.url,
			`https://identity-forge.test/api/v1/naming/projects/${projectId}/candidates`,
		)
		assert.equal(request?.init?.method, "POST")
		assert.deepEqual(JSON.parse(String(request?.init?.body)), {
			candidates: [
				{
					candidateId,
					name: "Calivo",
					description: "Warm, accessible, and easy to pronounce.",
					status: "shortlisted",
					rank: 1,
					notes: "Generated with Codex exec.",
					evidence: { source: "codex-exec" },
				},
			],
		})
	} finally {
		globalThis.fetch = originalFetch
		if (originalUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalUrl
		if (originalKey === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_KEY")
		else process.env.IDENTITYFORGE_API_KEY = originalKey
	}
})
