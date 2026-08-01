import assert from "node:assert/strict"
import test from "node:test"
import {
	addBrandLayer,
	addBrandVariation,
	createBrandProject,
	createTheme,
	deleteBrandVariation,
	deleteTheme,
	diffBrandProjectVersions,
	diffKitVersions,
	generateMockups,
	getBrandLayers,
	getBrandProject,
	getBrandProjectVersion,
	getMockupJob,
	getKitHistorySnapshot,
	getKitVersion,
	getMe,
	getProjectContext,
	listBrandProjectComments,
	listBrandProjectVersions,
	listKitHistory,
	listKitVersions,
	listMockupJobs,
	putProjectContext,
	recommendKits,
	remixTheme,
	removeBrandLayer,
	reorderBrandVariations,
	revokeBrandShare,
	searchTrademarks,
	shareBrandProject,
	updateBrandShare,
	updateBrandVariation,
	updateTheme,
} from "./api.js"

// cli/src/mcp.ts has no test coverage, so these assertions on api.ts are the
// only thing standing between a typo in a route path or verb and a silent 404
// at an agent's runtime. Assert the exact URL, method and body of every write.

interface Call {
	url: string
	method: string
	body: string | null
}

async function withStubbedFetch(
	run: () => Promise<void>,
	payload: unknown = { data: {} },
): Promise<Call[]> {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	const calls: Call[] = []
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async (input, init) => {
		calls.push({
			url: String(input),
			method: init?.method ?? "GET",
			body: typeof init?.body === "string" ? init.body : null,
		})
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

test("updateTheme PATCHes the kit in place and carries the stale-write guard", async () => {
	const calls = await withStubbedFetch(async () => {
		await updateTheme({
			slug: "archway bold",
			name: "Archway Bolder",
			overrides: { colors: { primary: "#E4572E" } },
			expectedUpdatedAt: "2026-07-26T10:00:00.000Z",
		})
	})

	assert.equal(calls.length, 1)
	// The slug is a path segment, so it must be encoded, not interpolated raw.
	assert.equal(calls[0].url, "http://api.test/api/v1/kits/archway%20bold")
	assert.equal(calls[0].method, "PATCH")
	// `slug` addresses the kit and must not leak into the body.
	assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
		name: "Archway Bolder",
		overrides: { colors: { primary: "#E4572E" } },
		expectedUpdatedAt: "2026-07-26T10:00:00.000Z",
	})
})

test("updateBrandVariation PATCHes one variation and passes nulls through as clears", async () => {
	const calls = await withStubbedFetch(async () => {
		await updateBrandVariation({
			projectId: "p-1",
			variationId: "v-1",
			kitSlug: "archway-bold",
			label: "Client favourite",
			domain: null,
		})
	})

	assert.equal(calls.length, 1)
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/brand-projects/p-1/variations/v-1",
	)
	assert.equal(calls[0].method, "PATCH")
	// null must survive JSON.stringify: it is how a caller clears a field.
	assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
		kitSlug: "archway-bold",
		label: "Client favourite",
		domain: null,
	})
})

test("deleteBrandVariation DELETEs the variation and sends no body", async () => {
	const calls = await withStubbedFetch(async () => {
		await deleteBrandVariation({ projectId: "p-1", variationId: "v-2" })
	})

	assert.equal(calls.length, 1)
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/brand-projects/p-1/variations/v-2",
	)
	assert.equal(calls[0].method, "DELETE")
	assert.equal(calls[0].body, null)
})

test("reorderBrandVariations PATCHes the reorder route with the full id list", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await reorderBrandVariations({
				projectId: "p-1",
				variationIds: ["v-3", "v-1", "v-2"],
			})
		},
		{ data: [] },
	)

	assert.equal(calls.length, 1)
	// A static `reorder` segment, deliberately not a variation id.
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/brand-projects/p-1/variations/reorder",
	)
	assert.equal(calls[0].method, "PATCH")
	assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
		variationIds: ["v-3", "v-1", "v-2"],
	})
})

// The three writes the CLI now exposes as `brand create`, `brand add-variation`
// and `brand share`. They complete HM5 without an MCP client, so a typo in a
// route here is a broken share loop rather than a broken tool call.

test("createBrandProject POSTs the project collection", async () => {
	const calls = await withStubbedFetch(async () => {
		await createBrandProject({ name: "Acme rebrand", brief: "Calm fintech" })
	})

	assert.equal(calls.length, 1)
	assert.equal(calls[0].url, "http://api.test/api/v1/brand-projects")
	assert.equal(calls[0].method, "POST")
	assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
		name: "Acme rebrand",
		brief: "Calm fintech",
	})
})

test("addBrandVariation POSTs to the project's variations and omits the path id from the body", async () => {
	const calls = await withStubbedFetch(async () => {
		await addBrandVariation({
			projectId: "p 1",
			kitSlug: "acid-signal-black",
			brandName: "Acme",
			label: "Direction A",
		})
	})

	assert.equal(calls.length, 1)
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/brand-projects/p%201/variations",
	)
	assert.equal(calls[0].method, "POST")
	// `projectId` addresses the collection and must not leak into the body.
	assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
		kitSlug: "acid-signal-black",
		brandName: "Acme",
		label: "Direction A",
	})
})

test("shareBrandProject POSTs the share route with the password and rotate flags", async () => {
	const calls = await withStubbedFetch(async () => {
		await shareBrandProject({
			projectId: "p-1",
			password: "hunter2",
			rotate: true,
		})
	})

	assert.equal(calls.length, 1)
	assert.equal(calls[0].url, "http://api.test/api/v1/brand-projects/p-1/share")
	assert.equal(calls[0].method, "POST")
	assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
		password: "hunter2",
		rotate: true,
	})
})

test("listBrandProjectComments GETs the comments route", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await listBrandProjectComments("p-1")
		},
		{ data: [] },
	)

	assert.equal(calls.length, 1)
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/brand-projects/p-1/comments",
	)
	assert.equal(calls[0].method, "GET")
	assert.equal(calls[0].body, null)
})

test("generateMockups POSTs the web-action body to the project job collection", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await generateMockups({
				projectId: "p 1",
				variationIds: ["v-1", "v-2"],
				items: [{ templateId: "shirt", sceneId: "front" }],
			})
		},
		{ data: { id: "j-1", status: "queued", pollingUrl: "/poll" } },
	)

	assert.equal(calls[0].method, "POST")
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/brand-projects/p%201/mockups",
	)
	assert.deepEqual(JSON.parse(calls[0].body ?? ""), {
		variationIds: ["v-1", "v-2"],
		items: [{ templateId: "shirt", sceneId: "front" }],
	})
})

test("mockup job reads stay scoped to their project", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await listMockupJobs("p 1")
			await getMockupJob("p 1", "job/1")
		},
		{ data: [] },
	)
	assert.deepEqual(
		calls.map((call) => call.url),
		[
			"http://api.test/api/v1/brand-projects/p%201/mockups",
			"http://api.test/api/v1/brand-projects/p%201/mockups/job%2F1",
		],
	)
})

test("searchTrademarks POSTs every supported EUIPO option", async () => {
	const calls = await withStubbedFetch(async () => {
		await searchTrademarks({
			projectId: "11111111-1111-4111-8111-111111111111",
			nameSuggestionId: "22222222-2222-4222-8222-222222222222",
			query: "Acme",
			niceClasses: ["9", "42"],
		})
	})
	assert.equal(calls[0].url, "http://api.test/api/v1/naming/trademarks/search")
	assert.equal(calls[0].method, "POST")
	assert.deepEqual(JSON.parse(calls[0].body ?? ""), {
		projectId: "11111111-1111-4111-8111-111111111111",
		nameSuggestionId: "22222222-2222-4222-8222-222222222222",
		query: "Acme",
		niceClasses: ["9", "42"],
	})
})

// The versioning READ surface. Same reason as the writes above: mcp.ts has no
// coverage of its own, so these assertions on api.ts are what stands between a
// typo in a route path and an agent getting a 404 at runtime.

test("listKitVersions GETs the timeline and passes the page cursor", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await listKitVersions("archway bold", { limit: 10, before: 7 })
		},
		{ data: [], meta: {} },
	)
	assert.equal(calls.length, 1)
	assert.equal(calls[0].method, "GET")
	// The slug is caller-supplied and reaches a path segment, so it must be
	// encoded rather than pasted in.
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/kits/archway%20bold/versions?limit=10&before=7",
	)
})

test("listKitVersions sends no query at all when unpaged", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await listKitVersions("archway-bold")
		},
		{ data: [], meta: {} },
	)
	// A bare "?" or "?limit=undefined" would both reach the server as input it
	// has to reject.
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/kits/archway-bold/versions",
	)
})

test("getKitVersion GETs one snapshot by number", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await getKitVersion("archway-bold", 3)
		},
		{ data: { version: 3, contentHash: "v1:abc", snapshot: {} } },
	)
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/kits/archway-bold/versions/3",
	)
})

test("diffKitVersions sends from alone, so the server compares against current", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await diffKitVersions("archway-bold", { from: 2 })
		},
		{ data: {}, meta: { toIsCurrent: true } },
	)
	// `to` must be ABSENT, not empty: the endpoint resolves the upper bound to
	// the current version only when it is not supplied, and that is the whole
	// "has this kit moved since I built" question.
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/kits/archway-bold/versions/diff?from=2",
	)
})

test("diffKitVersions pins both ends when both are given", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await diffKitVersions("archway-bold", { from: 2, to: 5 })
		},
		{ data: {}, meta: { toIsCurrent: false } },
	)
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/kits/archway-bold/versions/diff?from=2&to=5",
	)
})

test("the brand-project version routes mirror the kit ones", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await listBrandProjectVersions("p-1", { limit: 5 })
			await getBrandProjectVersion("p-1", 2)
			await diffBrandProjectVersions("p-1", { from: 1 })
		},
		{ data: {}, meta: { toIsCurrent: true } },
	)
	assert.deepEqual(
		calls.map((call) => call.url),
		[
			"http://api.test/api/v1/brand-projects/p-1/versions?limit=5",
			"http://api.test/api/v1/brand-projects/p-1/versions/2",
			"http://api.test/api/v1/brand-projects/p-1/versions/diff?from=1",
		],
	)
})

test("getMe GETs the free entitlement endpoint and unwraps data", async () => {
	const calls = await withStubbedFetch(
		async () => {
			const me = await getMe()
			assert.equal(me.plan.tier, "pro")
		},
		{ data: { plan: { tier: "pro" } }, meta: { cost: 0 } },
	)
	assert.equal(calls[0].url, "http://api.test/api/v1/me")
	assert.equal(calls[0].method, "GET")
})

// The context exchange. The PUT is the one that needs pinning: it is a
// REPLACE, and a client that quietly turned it into a merge would lose a
// caller's data without ever failing.

test("putProjectContext PUTs the whole object and merges nothing in", async () => {
	const calls = await withStubbedFetch(async () => {
		await putProjectContext("p-1", {
			product: "Claims triage console for insurance adjusters",
			surfaces: [{ useCase: "data-dashboard", name: "Adjuster queue" }],
		})
	})
	assert.equal(calls.length, 1)
	// PUT, not PATCH. The verb IS the contract here.
	assert.equal(calls[0].method, "PUT")
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/brand-projects/p-1/context",
	)
	const body = JSON.parse(calls[0].body ?? "") as Record<string, unknown>
	// Exactly what the caller passed, with no locally-added defaults: sending a
	// field the caller omitted would be this client inventing context that ends
	// up in a model prompt.
	assert.deepEqual(Object.keys(body).sort(), ["product", "surfaces"])
	assert.ok(!("projectId" in body), "the path id must not leak into the body")
})

test("getProjectContext returns null for a project with no context", async () => {
	await withStubbedFetch(
		async () => {
			assert.equal(await getProjectContext("p-1"), null)
		},
		{ data: null, meta: { present: false } },
	)
})

test("recommendKits POSTs the project id rather than a re-sent description", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await recommendKits({ projectId: "p-1", limit: 5 })
		},
		{ data: [], meta: { depth: "candidates" } },
	)
	assert.equal(calls[0].method, "POST")
	assert.equal(calls[0].url, "http://api.test/api/v1/recommend")
	const body = JSON.parse(calls[0].body ?? "") as Record<string, unknown>
	assert.deepEqual(body, { projectId: "p-1", limit: 5 })
	// Sending both is a 400 `ambiguous_context`, so the client must never add
	// an inline context of its own alongside the reference.
	assert.ok(
		!("context" in body),
		"context and projectId are mutually exclusive",
	)
})

test("recommendKits omits limit entirely when unset", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await recommendKits({ projectId: "p-1" })
		},
		{ data: [], meta: { depth: "candidates" } },
	)
	assert.deepEqual(JSON.parse(calls[0].body ?? ""), { projectId: "p-1" })
})

// The history LEDGER, which is a different endpoint from the version timeline
// and answers a question the timeline cannot: `kit_history_events.event_type`
// takes create, save and apply-to-brand, and only the first two mint a version.
// A typo sending these to /versions would return plausible-looking rows with
// every apply-to-brand event silently missing, which is worse than a 404.

test("listKitHistory hits /history, not /versions", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await listKitHistory("archway-bold")
		},
		{ data: [], meta: { count: 0, nextCursor: null, slug: "archway-bold" } },
	)
	assert.equal(calls.length, 1)
	assert.equal(calls[0].method, "GET")
	assert.equal(calls[0].url, "http://api.test/api/v1/kits/archway-bold/history")
	assert.ok(
		!calls[0].url.includes("/versions"),
		"the ledger and the version timeline are different records",
	)
})

test("listKitHistory pages by opaque cursor, never by a number", async () => {
	// Real cursors are base64url of (createdAt, id). They carry `-` and `_`,
	// which must survive to the server: re-encoding one is how a valid cursor
	// becomes a 400 the caller cannot explain.
	const cursor = "MjAyNi0wNy0yN1QwMDoxMTo0NC4wMDBa_ab-cd"
	const calls = await withStubbedFetch(
		async () => {
			await listKitHistory("archway bold", { limit: 5, cursor })
		},
		{ data: [], meta: { count: 0, nextCursor: null, slug: "archway bold" } },
	)
	assert.equal(
		calls[0].url,
		`http://api.test/api/v1/kits/archway%20bold/history?limit=5&cursor=${cursor}`,
	)
})

test("listKitHistory sends no query at all when unpaged", async () => {
	const calls = await withStubbedFetch(
		async () => {
			await listKitHistory("archway-bold", {})
		},
		{ data: [], meta: { count: 0, nextCursor: null, slug: "archway-bold" } },
	)
	assert.equal(calls[0].url, "http://api.test/api/v1/kits/archway-bold/history")
})

test("getKitHistorySnapshot encodes the event id as well as the slug", async () => {
	// Both segments are caller-supplied. The event id is a uuid today, but the
	// endpoint treats it as opaque and so must the client.
	const calls = await withStubbedFetch(
		async () => {
			await getKitHistorySnapshot("archway bold", "ev/1")
		},
		{ data: { name: "Archway Bold" }, meta: {}, links: {} },
	)
	assert.equal(
		calls[0].url,
		"http://api.test/api/v1/kits/archway%20bold/history/ev%2F1",
	)
})

test("getKitHistorySnapshot returns the kit itself, unwrapped from data", async () => {
	// The caller wants a design kit to diff or PATCH back, not an envelope.
	let snapshot: Record<string, unknown> | undefined
	await withStubbedFetch(
		async () => {
			snapshot = await getKitHistorySnapshot("archway-bold", "ev-1")
		},
		{ data: { name: "Archway Bold", slug: "archway-bold" }, meta: {} },
	)
	assert.deepEqual(snapshot, { name: "Archway Bold", slug: "archway-bold" })
})

// The MCP/CLI parity commands. Every fetcher below already existed and was
// reachable from `identityforge mcp` alone: an agent driving the CLI could read
// a kit and edit one, and could not author one, fork one, compose layers onto a
// brand, or pause a client link. Assert the exact URL, verb and body, because a
// typo here is a silent 404 at an agent's runtime.

test("createTheme POSTs to the kits collection", async () => {
	const calls = await withStubbedFetch(async () => {
		await createTheme({ name: "Acme", base: "bento-noir" })
	})
	assert.equal(calls[0].method, "POST")
	assert.equal(calls[0].url, "http://api.test/api/v1/kits")
	assert.deepEqual(JSON.parse(calls[0].body ?? ""), {
		name: "Acme",
		base: "bento-noir",
	})
})

test("remixTheme POSTs to the source kit's remix path, not to /kits", async () => {
	// The distinction is the whole point of remix: /kits authors something new,
	// this copies a specific kit and must name it in the path.
	const calls = await withStubbedFetch(async () => {
		await remixTheme({
			slug: "archway bold",
			overrides: { colors: { primary: "#111" } },
		})
	})
	assert.equal(calls[0].method, "POST")
	assert.equal(calls[0].url, "http://api.test/api/v1/kits/archway%20bold/remix")
})

test("deleteTheme DELETEs the addressed kit and sends no body", async () => {
	const calls = await withStubbedFetch(async () => {
		await deleteTheme("archway bold")
	}, { data: { slug: "archway bold", deleted: true }, meta: { savedCount: 2, savedLimit: 3 } })

	assert.equal(calls.length, 1)
	assert.equal(calls[0].url, "http://api.test/api/v1/kits/archway%20bold")
	assert.equal(calls[0].method, "DELETE")
	assert.equal(calls[0].body, null)
})

test("the layer routes agree on one path and differ only in verb", async () => {
	// add and remove are POST and DELETE on the same collection. Sending the
	// remove as a POST would pin a second record instead of dropping one.
	const added = await withStubbedFetch(async () => {
		await addBrandLayer({
			projectId: "p-1",
			axis: "imageDirection",
			recordId: "rec-1",
			replace: true,
		})
	})
	assert.equal(added[0].method, "POST")
	assert.equal(added[0].url, "http://api.test/api/v1/brand-projects/p-1/layers")
	assert.deepEqual(JSON.parse(added[0].body ?? ""), {
		axis: "imageDirection",
		recordId: "rec-1",
		replace: true,
	})

	const removed = await withStubbedFetch(async () => {
		await removeBrandLayer({
			projectId: "p-1",
			axis: "imageDirection",
			recordId: "rec-1",
		})
	})
	assert.equal(removed[0].method, "DELETE")
	assert.equal(
		removed[0].url,
		"http://api.test/api/v1/brand-projects/p-1/layers",
	)

	const read = await withStubbedFetch(async () => {
		await getBrandLayers({ projectId: "p-1" })
	})
	assert.equal(read[0].method, "GET")
	assert.equal(read[0].url, "http://api.test/api/v1/brand-projects/p-1/layers")
})

test("pausing a share is a PATCH and revoking it is a DELETE", async () => {
	// These are the reversible and irreversible halves of one idea, and the
	// difference between them is a client link that comes back and one that
	// never can. Same path, and only the verb says which.
	const paused = await withStubbedFetch(async () => {
		await updateBrandShare({ projectId: "p-1", enabled: false })
	})
	assert.equal(paused[0].method, "PATCH")
	assert.equal(paused[0].url, "http://api.test/api/v1/brand-projects/p-1/share")
	assert.deepEqual(JSON.parse(paused[0].body ?? ""), { enabled: false })

	const revoked = await withStubbedFetch(async () => {
		await revokeBrandShare("p-1")
	})
	assert.equal(revoked[0].method, "DELETE")
	assert.equal(
		revoked[0].url,
		"http://api.test/api/v1/brand-projects/p-1/share",
	)
})

test("clearing a share password sends null, not an omitted key", async () => {
	// `undefined` means "leave it alone" and `null` means "remove it". If the
	// client collapsed them, --clear-password would silently do nothing and the
	// caller would believe a live client link had been opened up.
	const calls = await withStubbedFetch(async () => {
		await updateBrandShare({ projectId: "p-1", password: null })
	})
	const body = JSON.parse(calls[0].body ?? "") as Record<string, unknown>
	assert.ok("password" in body, "the key must be present to mean removal")
	assert.equal(body.password, null)
})

test("getBrandProject reads one project by id", async () => {
	const calls = await withStubbedFetch(async () => {
		await getBrandProject("p-1")
	})
	assert.equal(calls[0].method, "GET")
	assert.equal(calls[0].url, "http://api.test/api/v1/brand-projects/p-1")
})
