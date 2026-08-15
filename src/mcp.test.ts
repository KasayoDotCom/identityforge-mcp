import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { buildMcpServer } from "./mcp.js"

// Exercised over the real protocol rather than by calling handlers directly, so
// what these assert is what a connected agent actually receives.

interface TextBlock {
	type: string
	text?: string
}

async function withClient(
	run: (client: Client) => Promise<void>,
): Promise<void> {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair()
	const client = new Client({ name: "test", version: "0" })
	const server = buildMcpServer()
	await Promise.all([
		client.connect(clientTransport),
		server.connect(serverTransport),
	])
	try {
		await run(client)
	} finally {
		await client.close()
		await server.close()
	}
}

/** Serve one canned response to every API call the tool makes. */
function stubApi(
	payload: unknown,
	init: { status?: number; headers?: Record<string, string> } = {},
): () => void {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	const originalKey = process.env.IDENTITYFORGE_API_KEY
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	process.env.IDENTITYFORGE_API_KEY = "ifk_test"
	globalThis.fetch = async () =>
		new Response(JSON.stringify(payload), {
			status: init.status ?? 200,
			headers: { "content-type": "application/json", ...init.headers },
		})
	return () => {
		globalThis.fetch = originalFetch
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
		if (originalKey === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_KEY")
		else process.env.IDENTITYFORGE_API_KEY = originalKey
	}
}

async function callText(
	client: Client,
	name: string,
	args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
	const result = await client.callTool({ name, arguments: args })
	const blocks = result.content as TextBlock[]
	return {
		text: blocks.map((block) => block.text ?? "").join("\n"),
		isError: result.isError === true,
	}
}

test("every registered tool is named in the connect-time instructions, and vice versa", async () => {
	await withClient(async (client) => {
		const instructions = client.getInstructions() ?? ""
		assert.ok(instructions.length > 0, "the server must send instructions")
		assert.match(instructions, /npx --yes identityforge@latest login/)
		assert.match(instructions, /Send verification email/)
		assert.match(instructions, /approve the resumed authorization/)
		assert.match(instructions, /save persistent projects/)
		const { tools } = await client.listTools()
		assert.ok(tools.length > 30)

		// A tool the instructions never name is a tool a model will not reach for,
		// so the two must not drift apart.
		const unnamed = tools
			.map((tool) => tool.name)
			.filter((name) => !instructions.includes(name))
		assert.deepEqual(
			unnamed,
			[],
			`registered but absent from WORKFLOW_INSTRUCTIONS: ${unnamed.join(", ")}`,
		)

		// And the reverse: instructions must not promise a tool that is not there.
		const registered = new Set(tools.map((tool) => tool.name))
		const promised = new Set(
			(instructions.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []).filter(
				(word) => word.includes("_"),
			),
		)
		const missing = [...promised].filter(
			(name) => !registered.has(name) && name.startsWith("get_"),
		)
		assert.deepEqual(
			missing,
			[],
			`named in WORKFLOW_INSTRUCTIONS but not registered: ${missing.join(
				", ",
			)}`,
		)
	})
})

test("irreversible MCP tools require a structural confirm boolean", async () => {
	await withClient(async (client) => {
		const { tools } = await client.listTools()
		const byName = new Map(tools.map((tool) => [tool.name, tool]))
		for (const name of [
			"delete_theme",
			"remove_brand_variation",
			"revoke_brand_share",
			"remove_brand_layer",
		]) {
			const schema = byName.get(name)?.inputSchema as {
				required?: string[]
				properties?: Record<string, { type?: string }>
			}
			assert.ok(
				schema.required?.includes("confirm"),
				`${name} must require confirm`,
			)
			assert.equal(schema.properties?.confirm?.type, "boolean")
		}

		for (const [name, args] of [
			["delete_theme", { slug: "kit-1", confirm: false }],
			[
				"remove_brand_variation",
				{ projectId: "p1", variationId: "v1", confirm: false },
			],
			["revoke_brand_share", { projectId: "p1", confirm: false }],
			[
				"remove_brand_layer",
				{ projectId: "p1", axis: "pageRecipe", recordId: "r1", confirm: false },
			],
		] as const) {
			const result = await callText(client, name, args)
			assert.equal(result.isError, true, `${name} must refuse false`)
			assert.match(result.text, /confirm: true is required/)
			assert.match(result.text, /No change was made/)
		}
	})
})

test("mockup spend needs no confirmation field", async () => {
	await withClient(async (client) => {
		const { tools } = await client.listTools()
		const byName = new Map(tools.map((tool) => [tool.name, tool]))
		for (const name of [
			"generate_mockups",
			"list_mockup_jobs",
			"get_mockup_job",
		]) {
			const tool = byName.get(name)
			assert.ok(tool, name)
			assert.ok(
				!(tool.inputSchema as { properties?: Record<string, unknown> })
					.properties?.confirm,
				`${name} must not require confirmation`,
			)
		}
		assert.match(byName.get("generate_mockups")?.description ?? "", /AI credit/)
	})
})

test("does not advertise automated trademark screening without provider access", async () => {
	await withClient(async (client) => {
		const { tools } = await client.listTools()
		assert.equal(
			tools.some((tool) => tool.name === "search_trademarks"),
			false,
		)
	})
})

test("delete_theme preserves a kit_in_use refusal from the API", async () => {
	const restore = stubApi(
		{
			code: "kit_in_use",
			error:
				'"my-kit" is still in use. Retire or repoint it first, then delete the kit.',
			references: [{ kind: "project-look", projectId: "p1" }],
		},
		{ status: 409 },
	)
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "delete_theme", {
				slug: "my-kit",
				confirm: true,
			})
			assert.equal(isError, true)
			assert.match(text, /still in use\. Retire or repoint it first/)
			assert.match(text, /kit_in_use/)
			assert.match(text, /project-look/)
		})
	} finally {
		restore()
	}
})

test("an API error surfaces every structured field the server sent", async () => {
	// The 409 stale-write marker is the case that matters: update_theme's own
	// description tells the agent to re-read and retry with it, which is
	// impossible if it never arrives.
	const restore = stubApi(
		{
			code: "stale_write",
			error: "The kit changed since you read it.",
			currentUpdatedAt: "2026-07-26T10:30:00.000Z",
		},
		{ status: 409 },
	)
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "update_theme", {
				slug: "acid-signal-black",
				name: "Acid Signal Blacker",
				expectedUpdatedAt: "2026-07-26T09:00:00.000Z",
			})

			assert.equal(isError, true)
			// Human-readable sentence first: that is what the model reads.
			assert.match(text, /^Identity Forge API error \(409\)/)
			assert.match(text, /The kit changed since you read it\./)
			// Then the fields that make the documented retry performable.
			assert.match(text, /currentUpdatedAt/)
			assert.match(text, /2026-07-26T10:30:00\.000Z/)
			assert.match(text, /stale_write/)
		})
	} finally {
		restore()
	}
})

test("a 400 surfaces which field failed validation, not just that something did", async () => {
	const restore = stubApi(
		{
			error: "Request validation failed.",
			issues: [{ path: "colors.0", message: "Expected a CSS color string." }],
		},
		{ status: 400 },
	)
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "match_palette", {
				colors: ["not-a-color"],
			})
			assert.equal(isError, true)
			assert.match(text, /Request validation failed\./)
			assert.match(text, /colors\.0/)
			assert.match(text, /Expected a CSS color string\./)
		})
	} finally {
		restore()
	}
})

test("a 429 surfaces the quota reset time", async () => {
	const restore = stubApi(
		{
			error: "Monthly API quota exhausted.",
			quota: {
				limit: 1000,
				used: 1000,
				remaining: 0,
				resetsAt: "2026-08-01T00:00:00.000Z",
			},
		},
		{ status: 429 },
	)
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "list_themes", {})
			assert.match(text, /Monthly API quota exhausted\./)
			assert.match(text, /resetsAt/)
			assert.match(text, /2026-08-01T00:00:00\.000Z/)
		})
	} finally {
		restore()
	}
})

test("a 403 on a Pro kit surfaces the code and the upgrade URL", async () => {
	const restore = stubApi(
		{
			code: "pro_kit_locked",
			error: "This kit needs Pro.",
			upgradeUrl: "https://identityforge.io/pricing",
		},
		{ status: 403 },
	)
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "get_design_md", {
				slug: "locked-kit",
			})
			assert.match(text, /pro_kit_locked/)
			assert.match(text, /https:\/\/identityforge\.io\/pricing/)
		})
	} finally {
		restore()
	}
})

const GATED_META = {
	count: 2,
	total: 24,
	accessible: 8,
	gated: {
		count: 16,
		reason: "pro",
		unlock: {
			url: "https://identityforge.io/pricing",
			cli: "npx -y identityforge@latest login",
		},
	},
}

test("a list states how much of itself this caller can use", async () => {
	const restore = stubApi({
		data: [
			{ slug: "flat", name: "Flat", tier: "free" },
			{ slug: "chrome", name: "Chrome", tier: "pro", locked: true },
		],
		meta: GATED_META,
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "list_interface_styles", {})
			// The whole point of the entitlement meta: sayable in someone's chat
			// window before a 403 teaches it the hard way.
			assert.match(text, /8 of 24 are available to the current key/)
			assert.match(text, /16 need Pro/)
			assert.match(text, /https:\/\/identityforge\.io\/pricing/)
			assert.match(text, /identityforge@latest login/)
		})
	} finally {
		restore()
	}
})

test("a fully accessible list says so rather than staying silent", async () => {
	const restore = stubApi({
		data: [{ slug: "flat", name: "Flat", tier: "free" }],
		meta: { count: 1, total: 12, accessible: 12 },
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "list_image_directions", {})
			assert.match(text, /all 12 are available to the current key/)
		})
	} finally {
		restore()
	}
})

test("list_themes reports entitlement, the permanent id, and the ordering it actually got", async () => {
	const restore = stubApi({
		data: [
			{
				id: "kit_01HZY8",
				slug: "acid-signal-black",
				name: "Acid Signal Black",
				summary: "One loud primary.",
			},
		],
		meta: {
			...GATED_META,
			count: 1,
			limit: 12,
			offset: 0,
			// The caller asked for `fit`; without a `use` lane the server applies
			// `featured` instead and reports what it did.
			sort: "featured",
			hasMore: false,
			nextOffset: null,
		},
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "list_themes", { sort: "fit" })
			assert.match(text, /kit_01HZY8/)
			assert.match(text, /slug acid-signal-black/)
			assert.match(text, /sorted by featured, not the requested fit/)
			assert.match(text, /8 of 24 are available to the current key/)
		})
	} finally {
		restore()
	}
})

test("create_theme shows the permanent id, not only the slug", async () => {
	const restore = stubApi({
		data: {
			id: "kit_01HZY9",
			slug: "client-warm",
			name: "Client Warm",
			tier: "free",
			visibility: "private",
			baseSlug: null,
			links: {
				page: "https://identityforge.io/studio/client-warm",
				self: "https://identityforge.io/api/v1/kits/client-warm",
				designMd: "https://identityforge.io/api/v1/kits/client-warm/export",
				registry: "https://identityforge.io/r/client-warm.json",
				studio: "https://identityforge.io/studio/client-warm",
			},
		},
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "create_theme", {
				name: "Client Warm",
			})
			assert.match(text, /id: kit_01HZY9/)
			assert.match(text, /permanent, never reassigned/)
			assert.match(text, /slug: client-warm/)
			// The URL, not just the label. This tool reads `links.page`, and when
			// the wire called that field something else the line still rendered —
			// as `Studio: undefined` — while every assertion above kept passing.
			assert.match(
				text,
				/Studio: https:\/\/identityforge\.io\/studio\/client-warm/,
			)
		})
	} finally {
		restore()
	}
})

test("an empty kit timeline explains why instead of returning nothing", async () => {
	const restore = stubApi({
		data: [],
		meta: { count: 0, currentVersion: 0, hasMore: false, nextBefore: null },
	})
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "list_kit_versions", {
				slug: "sage-slate-editorial",
			})
			assert.equal(isError, false)
			// An empty array is correct but ambiguous, so explain version 0.
			assert.match(text, /no recorded versions/)
			assert.match(text, /current version is 0/)
			assert.match(text, /no version has been minted yet/)
		})
	} finally {
		restore()
	}
})

test("a gated timeline says the author notes are withheld, not that there are none", async () => {
	const restore = stubApi({
		data: [
			{
				version: 2,
				contentHash: "v1:abc",
				actor: { type: "user", label: "Someone" },
				label: null,
				origin: "api",
				operationId: null,
				createdAt: "2026-07-26T10:00:00.000Z",
			},
		],
		meta: {
			count: 1,
			currentVersion: 2,
			hasMore: false,
			nextBefore: null,
			gated: { count: 1, unlock: { url: "https://identityforge.io/pricing" } },
		},
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "list_kit_versions", {
				slug: "locked-kit",
			})
			// `label: null` on its own is indistinguishable from "the author wrote
			// no note", which is the wrong conclusion to leave an agent with.
			assert.match(text, /Author notes are hidden/)
			assert.match(text, /identityforge\.io\/pricing/)
		})
	} finally {
		restore()
	}
})

test("a redacted diff reports how many values were withheld", async () => {
	const restore = stubApi({
		data: {
			from: 2,
			to: 5,
			summary: "3 changes: 3 token",
			changes: [
				{
					path: "kit.tokens.light.primary",
					kind: "token",
					op: "changed",
					redacted: true,
				},
			],
			counts: { token: 3 },
			redactedChanges: 3,
		},
		meta: { toIsCurrent: false },
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "diff_kit_versions", {
				slug: "locked-kit",
				from: 2,
				to: 5,
			})
			assert.match(text, /3 change\(s\) have their values withheld/)
			assert.match(text, /not entitled/)
		})
	} finally {
		restore()
	}
})

test("a diff with no upper bound is reported as being against current", async () => {
	const restore = stubApi({
		data: {
			from: 2,
			to: 7,
			summary: "1 change: 1 token",
			changes: [],
			counts: { token: 1 },
		},
		meta: { toIsCurrent: true },
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "diff_kit_versions", {
				slug: "my-kit",
				from: 2,
			})
			// The agent asked "what moved since version 2" without naming an upper
			// bound; it needs to know which version it actually got compared to.
			assert.match(text, /2 to current \(7\)/)
		})
	} finally {
		restore()
	}
})

test("whoami reports the limits an agent would otherwise discover by hitting them", async () => {
	const restore = stubApi({
		data: {
			plan: { tier: "free" },
			key: {
				id: "k-1",
				label: "laptop",
				createdAt: "2026-07-01T00:00:00.000Z",
			},
			scopes: {
				granted: ["kits:read"],
				missing: [
					{
						id: "kits:write",
						label: "Write kits",
						description: "Create and edit",
					},
				],
				fix: "Create a key carrying those permissions at /account/api-keys.",
			},
			quota: {
				used: 90,
				limit: 100,
				remaining: 10,
				resetsAt: "2026-08-01T00:00:00.000Z",
			},
			credits: { plan: 0, extra: 0, total: 0, unlimited: false },
			kits: { saved: 3, limit: 3, remaining: 0 },
			links: { page: "/account/api-keys" },
		},
		meta: { cost: 0 },
	})
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "whoami", {})
			assert.equal(isError, false)
			assert.match(text, /Plan: free/)
			// Each of these is a wall the agent would otherwise hit as a 403, a 429
			// or a refused save, which is the entire point of the tool.
			assert.match(text, /Missing scopes: kits:write/)
			assert.match(text, /10 left/)
			assert.match(text, /3 of 3 saved, 0 slot\(s\) left/)
		})
	} finally {
		restore()
	}
})

test("an absent project context tells the agent how to fill it", async () => {
	const restore = stubApi({ data: null, meta: { present: false } })
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "get_project_context", {
				projectId: "p-1",
			})
			assert.equal(isError, false)
			// "null" on its own leaves an agent unsure whether the project is
			// broken, unreachable, or simply not described yet.
			assert.match(text, /no stored context yet/)
			assert.match(text, /set_project_context/)
		})
	} finally {
		restore()
	}
})

test("a candidates-depth recommendation says the order is not a recommendation", async () => {
	const restore = stubApi({
		data: [
			{
				rank: 1,
				reason: null,
				fit: { score: 82, lane: "data-dashboard", byLane: {} },
				evidence: {},
				kit: { slug: "sage-slate-editorial" },
				discovery: {},
			},
		],
		meta: {
			depth: "candidates",
			count: 1,
			limit: 10,
			order:
				"computed lane fitness — evidence for your own ranking, not a recommendation",
			context: { source: "project", projectId: "p-1", surfaces: 2 },
			gated: { count: 9, unlock: { url: "https://identityforge.io/pricing" } },
		},
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "recommend_kits", {
				projectId: "p-1",
			})
			// The free depth returns an ORDER, and an agent that reads a sorted
			// list as a ranking will tell the user the top one was recommended.
			assert.match(text, /not a recommendation/)
			assert.match(text, /9 further candidate\(s\) need Pro/)
		})
	} finally {
		restore()
	}
})

test("a ranked recommendation is reported as model-ranked", async () => {
	const restore = stubApi({
		data: [
			{
				rank: 1,
				reason: "Dense tables suit the adjuster queue.",
				fit: { score: 91, lane: "data-dashboard", byLane: {} },
				evidence: {},
				kit: { slug: "klein-swiss-editorial" },
				discovery: {},
			},
		],
		meta: {
			depth: "ranked",
			count: 1,
			limit: 10,
			order: "model ranking against this product's context",
			context: { source: "project", projectId: "p-1", surfaces: 2 },
		},
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "recommend_kits", {
				projectId: "p-1",
			})
			assert.match(text, /Ranked by a model against this product/)
			assert.doesNotMatch(text, /not a recommendation/)
		})
	} finally {
		restore()
	}
})

test("set_project_context refuses a product string too short to ground anything", async () => {
	const restore = stubApi({ data: {}, meta: {} })
	try {
		await withClient(async (client) => {
			const { isError, text } = await callText(client, "set_project_context", {
				projectId: "p-1",
				product: "an app",
			})
			// Refused by the tool's own schema, so a label never reaches the store
			// and grounds a proposal that then reads as specific.
			assert.equal(isError, true)
			assert.match(text, /product/i)
		})
	} finally {
		restore()
	}
})

test("all three composition axes are reachable through one tool, not six", async () => {
	await withClient(async (client) => {
		const { tools } = await client.listTools()
		const byName = new Map(tools.map((tool) => [tool.name, tool]))

		for (const name of [
			"get_brand_layers",
			"add_brand_layer",
			"remove_brand_layer",
		]) {
			assert.ok(byName.has(name), `${name} is not registered`)
		}

		// The axis is an argument rather than three tools per verb: tools/list is
		// loaded into every agent's context on connect, so each tool costs tokens
		// for the whole session.
		for (const name of ["add_brand_layer", "remove_brand_layer"]) {
			const schema = byName.get(name)?.inputSchema as {
				properties?: Record<string, { enum?: string[] }>
			}
			assert.deepEqual(schema.properties?.axis?.enum, [
				"imageDirection",
				"interfaceStyle",
				"pageRecipe",
			])
		}
	})
})

test("reading a composition leads with what drifted and carries the picture", async () => {
	const restore = stubApi({
		data: {
			projectId: "p1",
			imageDirection: {
				state: "set",
				id: "img-1",
				chosenRevision: 2,
				resolved: true,
				name: "Oil impasto",
				revision: 3,
				tier: "free",
				locked: false,
				drift: {
					chosen: 2,
					current: 3,
					note: "Rewrote the lighting guidance.",
				},
			},
			interfaceStyle: null,
			pageRecipes: [],
			links: {
				self: "/api/v1/brand-projects/p1/layers",
				page: "/brand?project=p1",
				project: "/api/v1/brand-projects/p1",
				preview: "/preview/composition?kit=k1&image=img-1",
			},
		},
		meta: { drifted: 1 },
	})
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "get_brand_layers", {
				projectId: "p1",
			})
			assert.equal(isError, false)
			// The count is the thing to act on, so it is stated before the JSON
			// rather than left to be counted out of it.
			assert.match(text, /1 pinned record\(s\) have moved/)
			// Both revisions and the author's note survive to the agent.
			assert.match(text, /"chosen": 2/)
			assert.match(text, /"current": 3/)
			assert.match(text, /Rewrote the lighting guidance\./)
			// And the one artifact you can put in front of a person.
			assert.match(text, /\/preview\/composition\?kit=k1/)
		})
	} finally {
		restore()
	}
})

test("a composition with nothing drifted says so instead of staying quiet", async () => {
	const restore = stubApi({
		data: {
			projectId: "p1",
			imageDirection: null,
			interfaceStyle: null,
			pageRecipes: [],
			links: {
				self: "/api/v1/brand-projects/p1/layers",
				page: "/brand?project=p1",
				project: "/api/v1/brand-projects/p1",
			},
		},
		meta: { drifted: 0 },
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "get_brand_layers", {
				projectId: "p1",
			})
			assert.match(text, /Nothing has drifted\./)
		})
	} finally {
		restore()
	}
})

test("removing a layer that was never composed reports the no-op rather than success", async () => {
	const restore = stubApi({
		data: {
			projectId: "p1",
			imageDirection: null,
			interfaceStyle: null,
			pageRecipes: [],
			links: {
				self: "/api/v1/brand-projects/p1/layers",
				page: "/brand?project=p1",
				project: "/api/v1/brand-projects/p1",
			},
		},
		meta: { changed: false },
	})
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "remove_brand_layer", {
				projectId: "p1",
				axis: "pageRecipe",
				recordId: "rec-404",
				confirm: true,
			})
			assert.equal(isError, false)
			assert.match(text, /Was not composed/)
		})
	} finally {
		restore()
	}
})

/**
 * The API emits `links` as paths — `"page": "/kits/bento-noir"` — which is the
 * right REST contract and the wrong thing to hand a model, because it has no
 * base to join them to. Measured over this same protocol before the fix,
 * create_theme returned `Studio: /kits/bento-noir`: the one link that exists so
 * an agent can SHOW a person the kit rather than describe it was not openable,
 * and could not be passed on.
 */
test("every link an agent is handed is openable, in the sentence and the JSON", async () => {
	const restore = stubApi({
		data: {
			id: "kit_1",
			slug: "bento-noir",
			name: "Bento Noir",
			tier: "pro",
			links: {
				page: "/kits/bento-noir",
				designMd: "/api/v1/kits/bento-noir/export?format=design-md",
				poster: "/kits/bento-noir/poster-image",
				// Already absolute: resolving must be idempotent, or a server that
				// starts emitting absolute urls gets them prefixed a second time.
				snapshot: "https://cdn.example.com/x.png",
			},
		},
	})
	try {
		await withClient(async (client) => {
			const { text } = await callText(client, "create_theme", {
				name: "Bento Noir",
			})
			assert.match(text, /Studio: http:\/\/api\.test\/kits\/bento-noir\n/)
			assert.match(
				text,
				/DESIGN\.md: http:\/\/api\.test\/api\/v1\/kits\/bento-noir\/export/,
			)
			// The JSON block too: one url spelled two ways in one tool result is
			// worse than either spelling alone.
			assert.ok(
				!/"(page|designMd|poster)":"\//.test(text),
				`a relative link survived into the JSON: ${text}`,
			)
			assert.ok(text.includes('"snapshot":"https://cdn.example.com/x.png"'))
			// Only values under `links` are rewritten. A blanket path-shaped
			// rewrite would corrupt content — a slug, a token, a DESIGN.md body.
			assert.ok(text.includes('"slug":"bento-noir"'))
		})
	} finally {
		restore()
	}
})

test("a Pro refusal's links are openable too", async () => {
	const restore = stubApi(
		{
			code: "pro_kit_requires_membership",
			error: '"bento-noir" is part of Identity Forge Pro.',
			upgradeUrl: "https://identityforge.io/pricing",
			links: {
				page: "/kits/bento-noir",
				poster: "/kits/bento-noir/poster-image",
			},
		},
		{ status: 403 },
	)
	try {
		await withClient(async (client) => {
			const { text, isError } = await callText(client, "get_design_md", {
				slug: "bento-noir",
			})
			assert.equal(isError, true)
			// The caller who hits this is the one deciding whether to buy, so the
			// poster is exactly what they need and it must be fetchable.
			assert.match(
				text,
				/"poster": "http:\/\/api\.test\/kits\/bento-noir\/poster-image"/,
			)
			assert.match(text, /"page": "http:\/\/api\.test\/kits\/bento-noir"/)
		})
	} finally {
		restore()
	}
})

// The whole point of this one is that nobody was asked. An MCP host names itself
// in the initialize handshake, so a tool call can be attributed to a product
// without a header ask, a prompt, or anything an agent had to decide to do.
//
// Asserted over a real handshake rather than against the setter, because the
// failure mode here is silence: if the name is read at the wrong moment, or the
// source is never registered, every unit test on the normalizer still passes
// while the header is absent from every request for the whole session.
test("a tool call carries the MCP host's own name to the API", async () => {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	const originalKey = process.env.IDENTITYFORGE_API_KEY
	const sent: Array<Record<string, string>> = []
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	process.env.IDENTITYFORGE_API_KEY = "ifk_test"
	globalThis.fetch = async (_input, init) => {
		sent.push({ ...(init?.headers as Record<string, string>) })
		return new Response(JSON.stringify({ data: [], links: {} }), {
			headers: { "content-type": "application/json" },
		})
	}
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair()
	// A real client name from the wild, and deliberately one that needs
	// normalizing: the API would reject the spaces verbatim.
	const client = new Client({ name: "Visual Studio Code", version: "1.0.0" })
	const server = buildMcpServer()
	await Promise.all([
		client.connect(clientTransport),
		server.connect(serverTransport),
	])
	try {
		await callText(client, "list_themes", {})
	} finally {
		await client.close()
		await server.close()
		globalThis.fetch = originalFetch
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
		if (originalKey === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_KEY")
		else process.env.IDENTITYFORGE_API_KEY = originalKey
	}
	assert.ok(sent.length > 0, "the tool call must have reached the API")
	assert.equal(sent[0]?.["X-Agent-Client"], "visual-studio-code")
})
