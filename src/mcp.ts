import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import {
	ApiError,
	CLI_VERSION,
	COLLECTION_EXPORT_FORMATS,
	COLLECTION_LAYER_AXES,
	COLLECTION_SORTS,
	COLLECTION_TIERS,
	type EntitlementMeta,
	FONT_CATEGORIES,
	IMAGE_DIRECTION_FAMILIES,
	IMAGE_DIRECTION_PURPOSES,
	INTERFACE_STYLE_FAMILIES,
	KIT_USE_CASES,
	type KitOverridesInput,
	NAME_RESEARCH_PURPOSES,
	NAMING_CANDIDATE_STATUSES,
	PAGE_RECIPE_GOALS,
	type ProjectContext,
	addBrandLayer,
	addBrandVariation,
	addNamingCandidates,
	checkDomains,
	createBrandProject,
	createNamingProject,
	createTheme,
	deleteBrandVariation,
	deleteTheme,
	diffBrandProjectVersions,
	diffKitVersions,
	exportBrandProject,
	exportKit,
	fontPairings,
	generateMockups,
	generateNamingCandidates,
	getBrandLayers,
	getBrandProject,
	getBrandProjectVersion,
	getImageDirection,
	getInterfaceStyle,
	getKitHistorySnapshot,
	getKitVersion,
	getMe,
	getMockupJob,
	getNamingResearchContext,
	getPageRecipe,
	getProjectContext,
	listBrandProjectComments,
	listBrandProjectVersions,
	listBrandProjects,
	listFonts,
	listImageDirections,
	listInterfaceStyles,
	listKitHistory,
	listKitVersions,
	listKits,
	listMockupJobs,
	listNamingCandidates,
	listNamingGenerations,
	listNamingProjects,
	listNamingRecipes,
	listPageRecipes,
	matchPalette,
	patchNamingCandidates,
	putProjectContext,
	recommendKits,
	remixTheme,
	removeBrandLayer,
	reorderBrandVariations,
	resolveKits,
	revokeBrandShare,
	searchNameEvidence,
	searchTrademarks,
	setApiClient,
	setDeclaredAgentSource,
	shareBrandProject,
	similarFonts,
	similarKits,
	updateBrandShare,
	updateBrandVariation,
	updateTheme,
} from "./api.js"
import { applyTheme, formatApplyResult } from "./apply.js"
import {
	MCP_DOMAIN_INPUT_SCHEMA,
	MCP_DOMAIN_LANGUAGE_SCHEMA,
} from "./domain-schema.js"
import { formatThemeStatus, themeStatus } from "./status.js"

// NOTE: a STDIO MCP server must keep stdout clean for the JSON-RPC stream.
// Everything user-facing goes through tool results; diagnostics go to stderr.

type TextContent = { type: "text"; text: string }
function textResult(text: string): { content: TextContent[] } {
	return { content: [{ type: "text", text }] }
}
function errorResult(err: unknown): {
	content: TextContent[]
	isError: true
} {
	if (err instanceof ApiError) {
		// Sentence first, since that is what the model reads, then every
		// structured field the server sent: `issues` says which input was
		// malformed, `quota.resetsAt` says when to retry, `currentUpdatedAt`
		// makes the documented 409 re-read/retry loop performable, `upgradeUrl`
		// says where to unlock. Dropping them left the agent guessing.
		const text = err.details
			? `Identity Forge API error (${err.status}): ${
					err.message
				}\n\nDetails from the API:\n${JSON.stringify(err.details, null, 2)}`
			: `Identity Forge API error (${err.status}): ${err.message}`
		return { content: [{ type: "text", text }], isError: true }
	}
	const message = err instanceof Error ? err.message : String(err)
	return { content: [{ type: "text", text: message }], isError: true }
}

/**
 * How to name a kit in rendered output. The id is the durable handle and the
 * slug is a mutable public one, so show the id where there is one and keep the
 * slug alongside it: an agent cannot adopt a permanent handle it is never shown.
 */
function kitHandle(kit: { id?: string; slug: string }): string {
	return kit.id ? `${kit.id} (slug ${kit.slug})` : kit.slug
}

/**
 * State how much of a result set this caller can actually use. An agent that
 * says "8 of these you can use, 16 more with Pro" at the moment it lists is
 * worth more than one that discovers the wall on a 403 later.
 */
function entitlementNote(meta: EntitlementMeta): string {
	if (!meta.gated) {
		return `\n\nEntitlement: all ${meta.total} are available to the current key.`
	}
	return `\n\nEntitlement: ${meta.accessible} of ${meta.total} are available to the current key, ${meta.gated.count} need Pro. Unlock: ${meta.gated.unlock.url}, or run \`${meta.gated.unlock.cli}\` with a Pro key.`
}

// Surfaced to the agent at connect time (MCP `initialize.instructions`). Clients
// show this to the model, so it carries the kit-discovery workflow: how to get
// from "I want a look and feel" to an applied design system.
const WORKFLOW_INSTRUCTIONS = `Identity Forge gives you complete, implementation-ready design systems rather than a color and font pair. Each design kit (also called a theme here) carries 28 semantic color tokens across light and dark, typography, layout and spacing, motifs, do's and don'ts, and a DESIGN.md you build the UI from. Tokens export as CSS, Tailwind v3 or v4, a shadcn registry, or DTCG. Use it when what you are building would otherwise ship with framework defaults. Naming and domain research live here too, but they are one stage in the flow rather than the point of it.

Image directions, interface styles, and page recipes are separate collections that answer questions a kit does not. An image direction decides how imagery is presented and repeated, an interface style is a neutral render grammar for surfaces and hierarchy, and a page recipe decides how a page argues its case. When the user supplies a recognizable product, person, or object, treat the approved image as fixed input. Use a reference-preserving image editor to change its setting, supporting elements, composition, light, surfaces, crop, finish, and variation rules. Never recreate an existing product from text or place its cutout over a separately generated background. None of these collections replace the kit: an interface style in particular is not a second source of palettes, fonts, motifs, or brand rules, so apply it through the kit. Each has a list tool returning judgment summaries with no payload and a get tool returning the real export as Markdown by default or JSON on request: list_image_directions and get_image_direction, list_interface_styles and get_interface_style, list_page_recipes and get_page_recipe. Pro records need an entitled key and return 403 without exposing anything.

What to tell the user: this is where you get a real design system for the project. You can browse curated kits, match one against their product and existing brand colors, read its DESIGN.md, and write its tokens into the repo. Free discovery works without an account. To save persistent projects and use authenticated quota, run npx --yes identityforge@latest login. If there is no account yet, tell the human to complete browser signup, select Send verification email, open its link, and approve the resumed authorization; the CLI receives the key automatically. A Pro key unlocks exact Pro payloads.

The primary flow, when the user wants a look and feel for a project:

1. Gather intent. Establish what the product is, who it is for, and the mood it should have, asking if any of that is unclear. For example "fintech dashboard for SMBs, calm and trustworthy" or "techno festival landing page, dark and neon".
2. Get candidates. If the work belongs to a brand project, describe the product ONCE with set_project_context and then call recommend_kits({projectId}): candidates come back grounded in that stored description, each carrying the kit's own evidence and its computed fitness for the surfaces the product actually has, and every later session gets the same grounding without you re-sending prose. get_project_context reads it back, and reading it first is how you edit safely, because set_project_context REPLACES the whole object rather than merging it. recommend_kits costs 3 quota units and needs a key, unlike the rest of discovery. Without a project, there are two direct paths. Use list_themes when the brief maps onto a use case or a search phrase: list_themes({use: "data-dashboard"}) keeps kits whose authored audience or bestFor names that use, then ranks them by a fitness score measured on their own tokens. list_themes({q: "calm fintech dashboard"}) runs a synonym-aware ranked search. Use search_themes when the brief is subtle or cuts across categories: it returns every published kit as a compact summary with no ranking, so you weigh them yourself. If the user already has brand colors, match_palette ranks kits by perceptual color distance.
3. Review. Each summary carries name, summary, moodSummary, vibeTags, tags, audience, a font and color glimpse, and tier. Judge fit from the character of the kit rather than term overlap. Pick one, or put two or three to the user. similar_themes(slug) finds neighbours of a candidate. Call get_design_md(slug) to read the full brief before committing. A kit already names its heading, body and mono faces, so typography is decided by choosing a kit. Reach for the font tools only when it is not: search_fonts browses the Google Fonts catalog by name or category and, with its \`like\` argument, finds faces that resemble one the user already has — that is the way to answer "something a bit more like this". suggest_font_pairings returns the curated heading/body/mono table, or what goes beside a family the user is committed to. Both are metadata: no files, no CSS, and no letterform analysis behind \`like\`, so confirm the look before promising it.
4. Apply. Call apply_theme(slug) with a tokensFormat that matches the stack: tailwind-v4, tailwind-v3, css, shadcn-registry, or dtcg. It writes DESIGN.md, the tokens file, and identityforge.json, a stamp holding the applied kit's id and version and a hash of every file it wrote. apply_theme is not destructive by default: it compares what is on disk against that stamp, and if a file it would overwrite is missing from the stamp or was edited since it was written, it writes nothing at all and returns the conflicting paths. Pass preview: true first when the project might already have a DESIGN.md, show the user the plan, and pass force: true only once they have agreed to lose the content of the named files, which is unrecoverable. Never force by reflex to clear a refusal.
5. Decide the questions the kit does not answer, when the build needs them. list_page_recipes then get_page_recipe when you are building a page that has to argue a case, so the structure comes from a judged communication pattern rather than a guess. list_image_directions then get_image_direction before generating or sourcing any imagery, so the images belong to the same system as the tokens. If the user supplied a reference subject, use its approved image as fixed input, shape a few project-specific presentation routes around it, and ask the user to choose. Apply the selected route with a reference-preserving image editor and compare every result with the source at full resolution. If the current agent cannot perform reference-led editing, save or hand off the source image plus the exported direction instead of substituting text-to-image generation. Identity Forge supplies the direction and brief; it does not render those images. list_interface_styles then get_interface_style when the surface grammar matters, for example a dense tool or a tactile marketing page. Each of the three is optional and independent, all six take the same q, use, tier and sort filters as the kit tools, and each get returns Markdown by default or JSON on request. Apply all of them through the kit; none of them overrides it.
6. Implement. Follow DESIGN.md and wire the tokens into the styling layer, whether that is CSS variables, a Tailwind @theme block, or shadcn. Carry the palette, typography, and surface rules through consistently rather than applying them to one component. Read tokens from that one place and hardcode nothing, because the stamp lets a later apply move the project onto a changed kit only if the kit is wired in once.
7. Later, when returning to a project that already has an identityforge.json. Start with check_applied_theme({dir}), which reads the stamp for you and answers three separate questions in one call: whether the KIT moved to a new version, whether only the rendered DESIGN.md bytes moved (a serializer change, not a design change, and not a reason to touch code), and whether the document's SHAPE moved, meaning a section was added, renamed or removed. It includes the diff when the kit did move, and it hashes the files the last apply wrote against what is on disk, so a hand-edited DESIGN.md is named before anything overwrites it. Reach for diff_kit_versions({slug: <id>, from: <stamped version>}) directly only when you are asking about a kit this project was not built against, or comparing two versions neither of which is the stamped one. list_kit_versions shows the version timeline with the author's note for each version, and get_kit_version returns a whole past snapshot when you need the old values themselves. Saved kits and managed catalog kits accumulate versions; a static catalog fallback stays at version 0 until it is promoted into the managed catalog. list_kit_history is the wider owner-only record for saved kits: it adds every time the kit was applied to a brand, which mints no version and so appears in no version timeline, and get_kit_history_event returns the kit as it stood at one of those entries. Reach for it when the question is whether an owned kit was ever actually used rather than merely edited. Brand projects use list_brand_project_versions, get_brand_project_version, and diff_brand_project_versions; they record the whole brand: its name and domain, its fonts, its pinned layers, its context, and its variations. All version and history reads are read-only; none restores anything, and putting an old state back is an update_theme call you make deliberately.

Notes: identityforge.json belongs to the consuming repo, records what it was built against, and should be committed — that is what makes the next brand change arrive as a diff instead of a re-read. It holds the kit's permanent id and the version the export reported, so re-applying later can say whether the kit moved to a new version or only the rendered file changed. Every kit has an opaque \`id\` and a \`slug\`, and either one addresses get_design_md, get_tokens, apply_theme, similar_themes, remix_theme or update_theme directly, so once you have a kit you can skip discovery. They differ in durability: the id never changes, while the slug is a public handle its owner can rename. A retired slug keeps resolving through an alias, so a rename alone does not break you, but a different kit can later claim that freed slug and the live kit wins, which means a stored slug can quietly start resolving to something else. Store the id when you want a reference that is guaranteed to survive. Call whoami to see the plan, scopes, remaining quota, AI credits and saved-kit slots this key actually has; it is free, is never refused for being over quota, and is the only way to tell the user what is behind Pro before a 403 rather than after. Every list tool also reports how much of its result set your key can pull. Pro kits appear in listings but stay locked for non-members, and pulling one returns 403 with an upgrade path (run \`identityforge login\` with a Pro key, or upgrade). Authenticated calls count against the plan's monthly quota and return 429 once it is exhausted.

You can also build brands programmatically and hand a client a shareable preview. This needs the kits:write scope, so regenerate your key with \`identityforge login\` if a call returns 403 naming it:

1. Compose kits. create_theme authors a private kit, either from a kit JSON or by forking a catalog kit with base plus overrides covering tokens, colors, fonts, and facet presets for shape, elevation, typeVoice, motion, and density. remix_theme copies an existing kit with overrides applied, which is the faster way to spin several variations off one direction. update_theme edits one of your saved kits in place and records a version; delete_theme permanently removes one when nothing still references it. Overrides are the whole mix-and-match surface; structure-level composition is not exposed through the API yet.
2. Call create_brand_project once per client brief, then add_brand_variation four or five times with deliberately contrasting kits, brand names, and domains. A client choosing between near-identical directions cannot tell you much. Each variation needs a kit you can resolve: your own, a catalog kit, or another user's public kit.
3. share_brand_project returns a /p/<token> URL to send the client, optionally password protected. The page is read-only, serves only that project's kits, lets anyone with access cycle the variations, and lets signed-in reviewers comment. list_brand_projects shows your projects and their variation counts; get_brand_project opens one of them and is how you check what is actually on a board, including whether its link is live, protected, and how often the client has opened it. Sharing is reversible in two different ways and they are not interchangeable: update_brand_share pauses the link, resumes it, or adds a password to a link already sent, all without changing the URL, while revoke_brand_share withdraws it permanently and cannot be undone, because sharing again mints a new token and deliberately never the old one. Reach for the pause while work is mid-revision; keep the revoke for a link that leaked or an engagement that has ended. generate_mockups queues photographic outputs for selected variations and spends one AI credit per variation and scene combination; list_mockup_jobs and get_mockup_job poll progress and result URLs.
4. Revise on feedback. list_client_comments reads what the client wrote on each variation, which is the only way to learn it. Then act: update_theme edits a saved kit in place so every consumer of that kit follows the change, update_brand_variation revises one proposal, remove_brand_variation retires a direction permanently, and reorder_brand_variations decides which direction the client meets first. These change live client-visible state; remove_brand_variation additionally requires confirm: true because it cannot be undone, so read the feedback before you act on it. Prefer editing the existing project over building a second one: a client asked to re-review a whole new board loses the thread of what they already decided.

5. Compose the other axes. A brand is a design kit plus an image direction, an interface style and any number of page recipes, and add_brand_layer stores those on the project so they survive a kit swap. get_brand_layers reads them back with the drift, so a record its author has revised since the user pinned it is reported rather than applied behind their back, and it returns a preview image of the composition you can show instead of describing it. remove_brand_layer takes one off.

6. Build from the composed brand. export_brand returns the whole thing as ONE document: the kit's DESIGN.md with every pinned layer written into it, under the precedence rule that says the kit owns identity and a layer owns application. Call it instead of fetching the kit and each layer separately and merging them yourself, because deciding which one wins when they disagree is the part you cannot do from the outside. Use it whenever the brand carries layers; a plain get_design_md is only the kit and will silently omit them.

Those tools cover the entire freelancer loop on their own: build kits, open a project, attach variations, compose the axes, send the link, revise in place as the client responds, then export the agreed brand as one document to build from.

Brand naming and domain research are the secondary flow. If the user needs a name as well as a look and feel, the workflow persists on a project-owned kanban board, so do not leave the shortlist in the chat transcript:

1. Call list_naming_recipes and choose strategies that fit the brief. If there is no existing board, create_naming_project; otherwise use list_naming_projects.
2. Call get_naming_research_context before orchestrating substantial work. It returns the brief, board, existing evidence, capabilities, and a small-task handoff contract. Build semantic territories first. Keep judgement with the orchestrator and delegate bounded questions; do not replace judgement with server scoring or fixed stage gates.
3. Use generate_names for Identity Forge's built-in operator-owned model, with a specific brief, 1-8 recipe ids, and an idempotencyKey so a retry cannot spend twice. Successful names are persisted automatically and spend the API-key owner's AI credits only after the candidate rows commit. If your current agent or another user-authorized offline process proposes names, call add_name_candidates with stable caller-generated UUIDs. Runtime product code must not call paid external LLM APIs. Use list_name_generations to audit provenance.
4. Use search_name_evidence for model-authored exact-name, market, meaning, language, negative-association, or official-register discovery queries. It returns bounded self-hosted SearXNG results without classifying them and spends one account-wide monthly unit per query. Use check_domains for separate DNS, RDAP, and optional domain-SERP evidence: basic research costs one unit per unique domain and SERP adds one more. Attach raw evidence plus your interpretation to candidates; neither tool accepts, rejects, ranks, legally clears, or guarantees a purchase.
5. Call list_name_candidates. Review semantic connection, pronounceability, audience fit, distinctiveness, contradictory evidence, and domain evidence. Use move_name_candidates to progress generated → reviewing → shortlisted → finalist → selected, or reject weak options. Use rank_name_candidates for explicit user-facing priorities. Regenerate from observed failure patterns rather than drifting to arbitrary word combinations.
6. Visit material collision sources. EUIPO automation is coming soon and search_trademarks currently returns 503 without a provider call, so use the official EUIPO interface plus other relevant registers and check the chosen domain with an accredited registrar. Record jurisdiction, query, classes, source URLs, and checkedAt.
7. A project can have only one selected candidate. Selecting it also updates the browser-facing chosen brand name.

Scopes & quota: naming keys need naming:read for reads/domain research and naming:write for projects, generations, and board edits; kits:write covers creating kits/brands. Generation spends AI credits per successfully persisted unique name; ordinary API calls use the separate account-wide monthly API quota shared by all keys. Full agent docs: https://identityforge.io/for-agents.`

export function buildMcpServer(): McpServer {
	setApiClient("mcp")
	const server = new McpServer(
		{
			name: "identityforge",
			version: CLI_VERSION,
		},
		{ instructions: WORKFLOW_INSTRUCTIONS },
	)
	// The host names itself in the initialize handshake, so which product is
	// driving these tool calls arrives without anyone being asked for it.
	setDeclaredAgentSource(() => server.server.getClientVersion()?.name)

	server.registerTool(
		"list_themes",
		{
			title: "List design themes",
			description:
				"Browse the published catalog as compact summaries: slug, name, summary, tags, audience, a font and palette glimpse, tier, and computed discovery facets covering use-case fitness from 0 to 100, moods, and industries. This is the main entry point for finding a design kit. `use` narrows every lane to kits whose authored audience or bestFor names that product use, then ranks the eligible kits by measured fit. Visual tags help search but never establish product fit. `q` runs a synonym-aware ranked search that understands phrases like 'calm fintech dashboard'. Results are paginated and report the total plus the next offset, so page rather than assuming the first response is the whole catalog. Summaries carry no tokens, no DESIGN.md, and no font files; pull one kit with get_design_md or get_tokens, or apply_theme to write it into the project. Prefer search_themes when the brief is too subtle for one lane and you want to weigh the entire catalog yourself. Read-only and free, and it lists Pro kits without exposing their contents.",
			inputSchema: {
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.describe("Page size (1-50, default 12)."),
				offset: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Start index for paging (default 0)."),
				sort: z
					.enum(["featured", "popular", "recent", "name", "fit"])
					.optional()
					.describe(
						"Order: featured (default, curated) | popular (most saved+installed) | recent | name | fit (computed use-case fitness; needs use=).",
					),
				q: z
					.string()
					.optional()
					.describe(
						"Ranked discovery search that understands moods, industries, and use cases via synonyms (e.g. 'calm fintech dashboard').",
					),
				use: z
					.enum(KIT_USE_CASES)
					.optional()
					.describe(
						"Choose the product use case. Every lane first requires authored intent in the kit's audience or bestFor, then ranks eligible kits by measured fit. Visual tags do not establish product fit. The score comes from palette contrast, typography, density, and lane-specific checks. It can rank an eligible kit but cannot make an unrelated kit eligible. `reason` is absent today, so do not invent an explanation from the score. For data lanes, read each kit's `charts` block instead: series separation (`minDeltaE`, `cvdMinDeltaE`), `hueFamilies`, and `severityHeadroom` are measurements you can state to a user.",
					),
			},
		},
		async ({ limit, offset, sort, q, use }) => {
			try {
				const { data, meta } = await listKits({ limit, offset, sort, q, use })
				const lines = data.map((k) => {
					const installs =
						typeof k.installs === "number" && k.installs > 0
							? ` · ${k.installs} installs`
							: ""
					const fit =
						k.fit && typeof k.fit.score === "number"
							? ` · fit ${k.fit.score}/100`
							: ""
					return `- ${kitHandle(k)}: ${k.name}${
						k.summary ? `: ${k.summary}` : ""
					}${fit}${installs}`
				})
				const range =
					meta.total === 0
						? "0"
						: `${meta.offset + 1}-${meta.offset + data.length}`
				// Summaries only (no token payload). Compact JSON keeps a page a few KB;
				// page with offset and pull one kit for the full design system.
				const more = meta.hasMore
					? `\n\nMore: ${
							meta.total - (meta.offset + data.length)
						} not shown. Call list_themes with offset ${
							meta.nextOffset
						} for the next page.`
					: ""
				// `fit` without a `use` lane is silently downgraded server-side, so
				// report the ordering that was APPLIED rather than the one asked for.
				const ordering =
					meta.sort && meta.sort !== sort
						? `\n\nOrdering: sorted by ${meta.sort}, not the requested ${sort} (fit ranking needs a \`use\` lane).`
						: meta.sort
							? `\n\nOrdering: sorted by ${meta.sort}.`
							: ""
				return textResult(
					`Kits ${range} of ${
						meta.total
					} (summaries, listed as id: name. Pull one with get_design_md / get_tokens / apply_theme):\n${lines.join(
						"\n",
					)}${more}${ordering}${entitlementNote(
						meta,
					)}\n\nJSON:\n${JSON.stringify(data)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_image_directions",
		{
			title: "List image directions",
			description:
				"Browse reusable image directions for how a project's photography and illustration should be presented and repeated. Use one when a kit is chosen but the imagery still has no direction, which is where most agent-built pages fall back to stock-looking filler. If the user supplied a product, person, or object, its approved image is fixed input: shortlist suitable foundations, then use a reference-preserving image editor to change the setting, supporting elements, composition, light, surfaces, crop, and finish around that same reference. Never recreate an existing product from text or place its cutout over a separately generated background. Returns judgment summaries with no export payload, so pick a slug and call get_image_direction for the implementable version. A direction sits alongside the design kit and never replaces it; the kit still owns color, type, and brand rules. Read-only and free, and Pro records appear in the list without exposing their contents.",
			inputSchema: {
				q: z
					.string()
					.optional()
					.describe(
						"Search names, aliases, visual signals, fit, and agent tags.",
					),
				use: z
					.enum(IMAGE_DIRECTION_PURPOSES)
					.optional()
					.describe("The website job the image must perform."),
				family: z
					.array(z.enum(IMAGE_DIRECTION_FAMILIES))
					.optional()
					.describe("One or more image-process families."),
				tier: z
					.array(z.enum(COLLECTION_TIERS))
					.optional()
					.describe("Show Free records, Pro records, or both."),
				sort: z
					.enum(COLLECTION_SORTS)
					.optional()
					.describe(
						"Curated order, alphabetical order, or Free records first.",
					),
			},
		},
		async ({ q, use, family, tier, sort }) => {
			try {
				const { data: directions, meta } = await listImageDirections({
					q,
					use,
					family,
					tier,
					sort,
				})
				if (directions.length === 0) {
					return textResult("No image directions match those filters.")
				}
				return textResult(
					`${
						directions.length
					} image directions. These complement the DesignKit; choose one and call get_image_direction for the exact implementation export. Each record carries an opaque id and a hand-bumped editorial revision: pin the id and the revision you built against, and the detail export's revisionNote tells you what moved when it changes.${entitlementNote(
						meta,
					)}\n\nJSON:\n${JSON.stringify(directions, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_image_direction",
		{
			title: "Get an image direction",
			description:
				"Retrieve one image direction's full implementation export, as Markdown for reading and briefing or JSON for programmatic use. Follow it when generating, sourcing, or art-directing imagery, and adapt it into the project's repeatable production brief. For an existing product or other supplied subject, use its approved image as the identity source in a reference-preserving editor, apply the direction to the presentation around it, and compare every result with the source at full resolution. If the current agent cannot perform reference-led image editing, save or hand off the source plus this export instead of substituting text-to-image generation. This pairs with the design kit rather than replacing any of it. Read-only: it returns the text and writes nothing to disk. Free records are public; a Pro record returns 403 with an upgrade path unless the key is entitled, without leaking the payload.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.describe(
						"Opaque id or slug of the record, from list_image_directions. Either addresses it directly. The id never changes; the slug is an editorial handle that can be renamed, and unlike a kit slug it has no alias fallback, so store the id for any reference you keep.",
					),
				format: z
					.enum(COLLECTION_EXPORT_FORMATS)
					.optional()
					.describe("Export representation: markdown (default) or json."),
			},
		},
		async ({ slug, format }) => {
			try {
				const result = await getImageDirection(slug, format ?? "markdown")
				return textResult(result.body)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_interface_styles",
		{
			title: "List interface styles",
			description:
				"Browse interface styles, which decide how surfaces and hierarchy render: how panels stack, how density and depth read, how structure is expressed. A style is a neutral render grammar you apply through a design kit, not a second source of palettes, fonts, or brand rules, so it answers how the UI is built rather than what it looks like. Use one when the kit is settled but the layout still defaults to generic cards on a grid. Returns judgment summaries with no export payload; pick a slug and call get_interface_style for the implementable version. Read-only and free, and Pro records appear in the list without exposing their contents.",
			inputSchema: {
				q: z
					.string()
					.optional()
					.describe(
						"Search names, aliases, visual signals, fit, and agent tags.",
					),
				use: z
					.enum(KIT_USE_CASES)
					.optional()
					.describe("The product/use-case lane the interface must support."),
				family: z
					.array(z.enum(INTERFACE_STYLE_FAMILIES))
					.optional()
					.describe("One or more interface render-grammar families."),
				tier: z
					.array(z.enum(COLLECTION_TIERS))
					.optional()
					.describe("Show Free records, Pro records, or both."),
				sort: z
					.enum(COLLECTION_SORTS)
					.optional()
					.describe(
						"Curated order, alphabetical order, or Free records first.",
					),
			},
		},
		async ({ q, use, family, tier, sort }) => {
			try {
				const { data: styles, meta } = await listInterfaceStyles({
					q,
					use,
					family,
					tier,
					sort,
				})
				if (styles.length === 0) {
					return textResult("No interface styles match those filters.")
				}
				return textResult(
					`${
						styles.length
					} interface styles. They complement the DesignKit; choose one and call get_interface_style for the exact implementation export. Each record carries an opaque id and a hand-bumped editorial revision: pin the id and the revision you built against, and the detail export's revisionNote tells you what moved when it changes.${entitlementNote(
						meta,
					)}\n\nJSON:\n${JSON.stringify(styles, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_interface_style",
		{
			title: "Get an interface style",
			description:
				"Retrieve one interface style's full implementation export, as Markdown for reading or JSON for programmatic use. The export holds render-grammar rules only, so combine it with a design kit's tokens, typography, motifs, and brand rules; on its own it will not give the UI an identity. Read-only: it returns the text and writes nothing to disk. Free records are public; a Pro record returns 403 with an upgrade path unless the key is entitled, without leaking the payload.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.describe(
						"Opaque id or slug of the record, from list_interface_styles. Either addresses it directly. The id never changes; the slug is an editorial handle that can be renamed, and unlike a kit slug it has no alias fallback, so store the id for any reference you keep.",
					),
				format: z
					.enum(COLLECTION_EXPORT_FORMATS)
					.optional()
					.describe("Export representation: markdown (default) or json."),
			},
		},
		async ({ slug, format }) => {
			try {
				const result = await getInterfaceStyle(slug, format ?? "markdown")
				return textResult(result.body)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_page_recipes",
		{
			title: "List page recipes",
			description:
				"Browse page recipes, which decide how a page argues its case: what it leads with, in what order it earns belief, and what the reader should walk away knowing. Use one when you know what a page must achieve but not how to sequence it, which is the gap that produces hero-features-pricing pages by default. Returns judgment summaries with no export payload; pick a slug and call get_page_recipe for the implementable version. Each record carries a model field: most are legacy-sequence, which prescribes a section order, while communication-idea records state the argument and leave the sequencing to you. Read the model before following a record, since the two ask different things of you. This covers structure and argument, not visuals; the design kit still owns those. Read-only and free.",
			inputSchema: {
				q: z
					.string()
					.optional()
					.describe(
						"Search names, codes, audience, communication ideas, examples, legacy sections, and agent tags.",
					),
				goal: z
					.enum(PAGE_RECIPE_GOALS)
					.optional()
					.describe("The communication job the page must perform."),
				tier: z
					.array(z.enum(COLLECTION_TIERS))
					.optional()
					.describe("Show Free records, Pro records, or both."),
				sort: z
					.enum(COLLECTION_SORTS)
					.optional()
					.describe(
						"Curated order, alphabetical order, or Free records first.",
					),
			},
		},
		async ({ q, goal, tier, sort }) => {
			try {
				const { data: recipes, meta } = await listPageRecipes({
					q,
					goal,
					tier,
					sort,
				})
				if (recipes.length === 0) {
					return textResult("No page recipes match those filters.")
				}
				return textResult(
					`${
						recipes.length
					} page recipes. These complement the DesignKit. Choose a communication idea or an explicitly labeled legacy record, then call get_page_recipe for its machine-ready export. Each record carries an opaque id and a hand-bumped editorial revision: pin the id and the revision you built against, and the detail export's revisionNote tells you what moved when it changes.${entitlementNote(
						meta,
					)}\n\nJSON:\n${JSON.stringify(recipes, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_page_recipe",
		{
			title: "Get a page recipe",
			description:
				"Retrieve one page recipe's full implementation export, as Markdown for reading or JSON for programmatic use. This is what you build the page's structure and argument from, and it pairs with a design kit, which still supplies the visual and interaction rules. Read-only: it returns the text and writes nothing to disk. Free records are public; a Pro record returns 403 with an upgrade path unless the key is entitled, without leaking the payload.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.describe(
						"Opaque id or slug of the record, from list_page_recipes. Either addresses it directly. The id never changes; the slug is an editorial handle that can be renamed, and unlike a kit slug it has no alias fallback, so store the id for any reference you keep.",
					),
				format: z
					.enum(COLLECTION_EXPORT_FORMATS)
					.optional()
					.describe("Export representation: markdown (default) or json."),
			},
		},
		async ({ slug, format }) => {
			try {
				const result = await getPageRecipe(slug, format ?? "markdown")
				return textResult(result.body)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"search_themes",
		{
			title: "Get themes to rank for a product",
			description:
				"Return the entire catalog at once, unranked, as compact summaries carrying each kit's moodSummary, vibeTags, tags, audience, and a font and palette glimpse, so you can judge fit yourself. Despite the name it runs no server-side search: `query` is echoed back to keep your brief in context, and the ordering is neutral. Use it when the brief is subtle or cuts across categories and you would rather weigh every option than trust a ranking. Prefer list_themes when the brief maps cleanly onto a use case or search phrase, since it narrows and ranks the catalog for you and pages rather than returning everything. Read the summaries, pick one to three, then get_design_md to read the full brief or apply_theme to write it into the project. Read-only and free.",
			inputSchema: {
				query: z
					.string()
					.describe(
						"Your brief: the product, its audience, and the intended mood, e.g. 'fintech dashboard for SMBs, calm and trustworthy'. It frames your own ranking and is not sent to a matcher.",
					),
			},
		},
		async ({ query }) => {
			try {
				const { data: matches, meta } = await resolveKits(query)
				if (matches.length === 0) {
					return textResult("No published themes are available.")
				}
				// The full catalog as compact summaries (no token payload). The agent
				// ranks these against the brief from each kit's moodSummary/vibeTags/tags.
				return textResult(
					`${
						matches.length
					} kits (the full catalog, neutral order). Rank them against your brief, "${query}", using each kit's moodSummary, vibeTags, and tags; there is no server-side ranking. Pick the best fit(s), then get_design_md(id or slug) to read a brief or apply_theme(id or slug) to apply.${entitlementNote(
						meta,
					)}\n\nJSON:\n${JSON.stringify(matches)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"similar_themes",
		{
			title: "Find similar themes",
			description:
				"Find published kits close to one you already have, ranked by palette proximity, shared tags, and audience. Use it when the user likes a direction but wants options, or when a candidate is nearly right and you want neighbours to compare. It needs an existing slug, so start from list_themes or search_themes if you do not have one yet. Returns compact summaries with a similarity score; judge the actual fit yourself, since proximity in palette and tags is a starting point rather than a verdict. Read-only and free, and it lists Pro kits without exposing their contents.",
			inputSchema: {
				slug: z
					.string()
					.describe(
						"Permanent id or slug of the kit to find neighbours for. Prefer the id: it never moves, while a slug can be renamed and a retired slug keeps resolving through an alias.",
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(10)
					.optional()
					.describe("How many to return, 1-10, default 4."),
			},
		},
		async ({ slug, limit }) => {
			try {
				const { data: matches, meta } = await similarKits(slug, limit ?? 4)
				if (matches.length === 0) {
					return textResult(`No themes found similar to "${slug}".`)
				}
				const lines = matches.map(
					(m) =>
						`- ${kitHandle(m.kit)} (similarity ${m.similarity}): ${m.kit.name}`,
				)
				return textResult(
					`Themes similar to "${slug}":\n${lines.join("\n")}${entitlementNote(
						meta,
					)}\n\nNext: get_design_md(id or slug) to read a brief, or apply_theme(id or slug) to apply.\n\nJSON:\n${JSON.stringify(
						matches,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"match_palette",
		{
			title: "Match themes to brand colors",
			description:
				"Rank published kits by how close their palette sits to colors the user already owns, using perceptual color distance rather than string matching. Use it when a brand has existing colors that the design system has to live with, such as an established logo. This ranks on color alone and ignores mood, audience, and use case, so treat the result as a shortlist and check the rest of the fit with get_design_md before committing. When the user has no fixed colors, list_themes or search_themes will serve them better. Read-only and free.",
			inputSchema: {
				colors: z
					.array(z.string())
					.min(1)
					.describe(
						"One or more brand colors as CSS strings, hex, oklch, or rgb, e.g. ['#0A84FF', '#1C1C1E'].",
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(10)
					.optional()
					.describe("How many to return, 1-10, default 4."),
			},
		},
		async ({ colors, limit }) => {
			try {
				const { data: matches, meta } = await matchPalette(colors, limit ?? 4)
				if (matches.length === 0) {
					return textResult("No themes matched those colors.")
				}
				const lines = matches.map(
					(m) => `- ${kitHandle(m.kit)} (match ${m.match}): ${m.kit.name}`,
				)
				return textResult(
					`Themes closest to your colors:\n${lines.join("\n")}${entitlementNote(
						meta,
					)}\n\nNext: get_design_md(id or slug) to read a brief, or apply_theme(id or slug) to apply.\n\nJSON:\n${JSON.stringify(
						matches,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"search_fonts",
		{
			title: "Search fonts",
			description:
				"Search the Google Fonts catalog by name or category, or ask for fonts that resemble one you already have. `like` is the way to find a font by resemblance: pass a family you know and get back neighbours ranked by category, popularity, the partners they share in the curated pairing table, and whether published kits use them together, each with a `why` naming the signals that placed it. Nothing here reads a letterform, so `like` is a shortlist to confirm visually, not a verdict on how a face looks. Results are compact metadata — name, family, category, designer, popularity rank, available weights, license — and carry no font files, no CSS and no specimen. Fonts do not stand alone: use suggest_font_pairings for what to set beside one, and remember a design kit already ships a chosen heading, body and mono. Read-only and free, no key needed.",
			inputSchema: {
				query: z
					.string()
					.optional()
					.describe("Match on font name, e.g. 'grotesk' or 'Playfair'."),
				category: z
					.enum(FONT_CATEGORIES)
					.optional()
					.describe("Narrow to one Google Fonts category."),
				like: z
					.string()
					.optional()
					.describe(
						"A font family you already have, e.g. 'Inter'. Returns fonts that resemble it instead of running a name search; `query` and `category` are ignored when this is set.",
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.describe("How many to return, 1-50, default 12."),
			},
		},
		async ({ query, category, like, limit }) => {
			try {
				if (like) {
					const { data } = await similarFonts(like, limit ?? 12)
					if (data.length === 0) {
						return textResult(
							`No fonts in the catalog resemble "${like}" on category, popularity, pairing partners, or kit co-usage. Check the spelling of the family name, or search by name with query instead.`,
						)
					}
					const lines = data.map((f) => `- ${f.family} (${f.score}): ${f.why}`)
					return textResult(
						`Fonts like "${like}", ranked by category, popularity proximity, shared pairing partners, and co-usage in published kits. No letterform analysis, so confirm the look yourself:\n${lines.join(
							"\n",
						)}\n\nNext: suggest_font_pairings(family) for what to set beside one.\n\nJSON:\n${JSON.stringify(
							data,
						)}`,
					)
				}
				const { data, meta } = await listFonts({
					search: query,
					category,
					pageSize: limit ?? 12,
				})
				if (data.length === 0) {
					return textResult(
						`No fonts matched${query ? ` "${query}"` : ""}${
							category ? ` in ${category}` : ""
						}.`,
					)
				}
				const lines = data.map(
					(f) =>
						`- ${f.family} (${f.category ?? "uncategorized"}, rank ${
							f.popularityRank ?? "?"
						}): weights ${f.weights.join("/") || "unknown"}`,
				)
				const more = meta.hasMore
					? `\n\nMore: ${
							meta.total - data.length
						} others match; raise limit or narrow the query.`
					: ""
				return textResult(
					`${data.length} of ${
						meta.total
					} fonts (metadata only, no files):\n${lines.join(
						"\n",
					)}${more}\n\nNext: search_fonts({like: <family>}) for resemblance, or suggest_font_pairings(family).\n\nJSON:\n${JSON.stringify(
						data,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"suggest_font_pairings",
		{
			title: "Suggest font pairings",
			description:
				"Heading, body and mono faces that work together. Called with no arguments it returns the curated table, each entry carrying the label a person would recognise it by, such as 'Modern tech' or 'Quiet luxury'. Called with a family it answers what goes beside that one: the curated entries naming it, then category-contrast suggestions for the cases the table does not cover. `role` says which slot the family occupies; omit it and both are searched. The suggestions are contrast rules and are not ranked by quality, so read them as candidates. A design kit already carries a chosen trio, so reach for this when composing typography outside a kit or when a user has one fixed face. Read-only and free, no key needed.",
			inputSchema: {
				family: z
					.string()
					.optional()
					.describe(
						"A font family the user is committed to, e.g. 'Fraunces'. Omit for the whole curated table.",
					),
				role: z
					.enum(["heading", "body"])
					.optional()
					.describe("Which slot `family` occupies. Ignored without a family."),
			},
		},
		async ({ family, role }) => {
			try {
				const { data } = await fontPairings({ family, role })
				if (Array.isArray(data)) {
					const lines = data.map(
						(p) =>
							`- ${p.label ?? "Pairing"}: ${p.heading} / ${p.body}${
								p.mono ? ` / ${p.mono}` : ""
							}`,
					)
					return textResult(
						`${
							data.length
						} curated pairings (heading / body / mono):\n${lines.join(
							"\n",
						)}\n\nJSON:\n${JSON.stringify(data)}`,
					)
				}
				const curated = data.curated.map(
					(p) =>
						`- curated${p.label ? ` (${p.label})` : ""}: ${p.heading} / ${
							p.body
						}${p.mono ? ` / ${p.mono}` : ""}`,
				)
				const suggested = data.suggested.map(
					(p) => `- suggested: ${p.heading} / ${p.body} — ${p.why}`,
				)
				return textResult(
					`Pairings for ${data.family}${
						curated.length
							? ""
							: " (nothing curated names it, so these are contrast rules only)"
					}:\n${[...curated, ...suggested].join(
						"\n",
					)}\n\nJSON:\n${JSON.stringify(data)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_design_md",
		{
			title: "Get DESIGN.md for a theme",
			description:
				"Fetch the complete DESIGN.md brief for one design kit (theme) by slug: the palette in prose, typography, layout and surface rules, elevation and shape, distinctive motifs, iconography, imagery direction, and explicit do's and don'ts. This is the document you design from. Read it before implementing a kit, or when the user wants to review a direction before committing to it. Read-only: it returns the text and writes nothing to disk (apply_theme is the tool that writes it into a project). Free kits are public; a Pro kit returns 403 with an upgrade path unless the key is entitled, without leaking the brief.",
			inputSchema: {
				slug: z
					.string()
					.describe(
						"Permanent id or slug of the kit, from list_themes / search_themes. Prefer the id: it never moves, while a slug can be renamed and a retired slug keeps resolving through an alias.",
					),
			},
		},
		async ({ slug }) => {
			try {
				const { body } = await exportKit(slug, "design-md")
				return textResult(body)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_tokens",
		{
			title: "Get design tokens for a theme",
			description:
				"Fetch one design kit's machine-readable tokens in the format that matches the target stack. It covers all 28 semantic color roles in both light and dark, plus typography and spacing. Use it to wire a kit into an existing styling layer when you do not need the written brief; pair it with get_design_md when you also need the rules. Read-only: it returns the file contents as text and writes nothing to disk. apply_theme writes tokens and DESIGN.md into a project in one step. Free kits are public; a Pro kit returns 403 unless the key is entitled.",
			inputSchema: {
				slug: z
					.string()
					.describe(
						"Permanent id or slug of the kit, from list_themes / search_themes. Prefer the id: it never moves, while a slug can be renamed and a retired slug keeps resolving through an alias.",
					),
				format: z
					.enum([
						"dtcg",
						"css",
						"tailwind-v3",
						"tailwind-v4",
						"shadcn-registry",
						"json",
					])
					.optional()
					.describe(
						"Token format, default dtcg: dtcg (W3C design-token JSON) | css (custom properties on :root and .dark) | tailwind-v3 (config object) | tailwind-v4 (@theme block) | shadcn-registry (registry item) | json (the raw kit).",
					),
			},
		},
		async ({ slug, format }) => {
			try {
				const { body } = await exportKit(slug, format ?? "dtcg")
				return textResult(body)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"apply_theme",
		{
			title: "Apply a theme to the current project",
			description:
				"Write a design kit into a project on disk: DESIGN.md, a tokens file named for the chosen format, and identityforge.json, a stamp recording the applied kit and a hash of every file written. This is the only tool here that touches the filesystem. It reads the stamp before writing, so it can tell its own output from the user's work. A file that already exists but is not recorded in the stamp, or one whose content changed since it was written, is a CONFLICT: by default the tool then writes NOTHING, names every conflicting file, and returns an error, so a hand-written DESIGN.md survives. Files whose content already matches the kit are left untouched. Set preview to plan without writing anything at all, and force to overwrite conflicting files, which destroys their current content permanently with no recovery path. Everything is computed before the first write, so a failed fetch cannot half-apply. Call it once the user has settled on a kit; get_design_md and get_tokens inspect a kit without writing. The stamp also records the kit's permanent id and its version as the export reported them, which is what a later apply diffs against: re-applying tells you whether the kit itself moved to a new version, or whether only the rendered file changed. A version of null means the export did not report one, and must never be read as version 0. Free kits are public, and a Pro kit returns 403 unless the key is entitled.",
			inputSchema: {
				slug: z
					.string()
					.describe(
						"Permanent id or slug of the kit to apply, from list_themes / search_themes. Prefer the id: it never moves, while a slug can be renamed and a retired slug keeps resolving through an alias.",
					),
				dir: z
					.string()
					.optional()
					.describe(
						"Target directory to write into, absolute or relative to the server's working directory. Default: the MCP server's working directory. The stamp identityforge.json is written at its root.",
					),
				tokensFormat: z
					.enum([
						"dtcg",
						"css",
						"tailwind-v3",
						"tailwind-v4",
						"shadcn-registry",
					])
					.optional()
					.describe(
						"Token file format to write: dtcg (W3C JSON) | css (variables) | tailwind-v3 (config) | tailwind-v4 (@theme) | shadcn-registry. Default dtcg. Match it to the project's styling layer.",
					),
				preview: z
					.boolean()
					.optional()
					.describe(
						"Dry run. Default false. When true nothing is written at all, not even the stamp, and the result is the plan: which files would be created, which overwritten, which are already identical, and which conflict. Use it before applying into a project that may already have a DESIGN.md, and to show the user what would change.",
					),
				force: z
					.boolean()
					.optional()
					.describe(
						"Apply despite conflicts. Default false. DESTRUCTIVE: it overwrites files this tool did not write or that were edited after it wrote them, their current content is gone permanently, and the result names each one. Only pass it after the user has seen the conflicting files and agreed to lose them.",
					),
				tokensEntry: z
					.string()
					.optional()
					.describe(
						"Advisory note for the stamp: the project-relative path where the tokens file gets wired in, e.g. 'src/app/globals.css'. Recorded for the next agent, nothing is written to it. Carried forward from the previous stamp when omitted.",
					),
			},
		},
		async ({ slug, dir, tokensFormat, preview, force, tokensEntry }) => {
			try {
				const result = await applyTheme({
					slug,
					dir: dir ?? process.cwd(),
					tokensFormat: tokensFormat ?? "dtcg",
					preview,
					force,
					tokensEntry,
				})
				const text = formatApplyResult(result)
				// A refusal is not a completed apply. Flag it so the agent reports
				// the conflict to the user instead of moving on as if it applied.
				return result.mode === "refused"
					? {
							content: [{ type: "text" as const, text }],
							isError: true as const,
						}
					: textResult(text)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"check_applied_theme",
		{
			title: "Has the applied kit moved since this repo was built?",
			description:
				"Read the identityforge.json stamp in a project on disk and report what has moved since apply_theme wrote it. Takes no kit and no version: the stamp holds both, which is what makes this the tool to reach for when returning to a project rather than reconstructing the arguments for diff_kit_versions by hand. It reports THREE independent movements and never conflates them. kitMoved: the server's own version count differs, so the design itself changed and the brief is worth re-reading. documentMoved: the rendered DESIGN.md bytes differ, which a serializer change alone does to every kit at once and is not by itself a reason to touch code. contractMoved: designMdContract differs, so the document's SHAPE changed and a section was added, renamed or removed. Each is null rather than false when one side cannot answer, with a note saying which. When the kit did move and both versions are numbers, the diff_kit_versions result is included, so one call answers both what moved and how. It also hashes every artifact the stamp recorded against what is on disk, so a DESIGN.md edited by hand shows as modified before anything overwrites it. Read-only: it writes nothing and touches no file, so it is safe to call at the start of any session. Losing a key or hitting a Pro gate degrades it to a local-only report with a note rather than failing.",
			inputSchema: {
				dir: z
					.string()
					.optional()
					.describe(
						"Project directory holding identityforge.json, absolute or relative to the server's working directory. Default: the MCP server's working directory. Same meaning as apply_theme's dir.",
					),
			},
		},
		async ({ dir }) => {
			try {
				const status = await themeStatus({ dir })
				return textResult(
					`${formatThemeStatus(status)}\n\nJSON:\n${JSON.stringify(
						status,
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_naming_recipes",
		{
			title: "Discover naming recipes",
			description:
				"List every public naming strategy Identity Forge can generate from, with each recipe's id, intent, generation instruction, and settings. Call it before generate_names so you pick 1-8 recipe ids that genuinely fit the brief instead of guessing at strategy names. Recipe ids are stable, so you can skip this once you already know the ones you want. Read-only, free, and needs no arguments.",
			inputSchema: {},
		},
		async () => {
			try {
				return textResult(JSON.stringify(await listNamingRecipes(), null, 2))
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_naming_projects",
		{
			title: "List naming projects",
			description:
				"List the persistent naming boards owned by the connected key, with each project's id, name, brief, researched TLDs, chosen name, and candidate counts. Start here to recover the projectId for an existing brief, since every other naming tool needs one, and only call create_naming_project when nothing here fits. Read-only, paginated, and free. Requires the naming:read scope.",
			inputSchema: {
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Page size, 1-100."),
				offset: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Start index for paging, default 0."),
			},
		},
		async ({ limit, offset }) => {
			try {
				return textResult(
					JSON.stringify(await listNamingProjects({ limit, offset }), null, 2),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"create_naming_project",
		{
			title: "Create a naming project",
			description:
				"Create one durable, project-owned naming board and return its id. Do this ONCE per real naming brief, never once per generation run: every other naming tool takes the resulting projectId, and the board persists the candidate kanban, research evidence, and generation ledger across sessions so the shortlist never lives only in chat. Call list_naming_projects first and reuse an existing board rather than creating a near-duplicate. Write the real brief into `description`, because generation quality depends on it. Requires the naming:write scope; creating a board spends no AI credits.",
			inputSchema: {
				name: z
					.string()
					.min(1)
					.max(120)
					.describe("Human-readable project name, e.g. the product or client."),
				description: z
					.string()
					.max(2000)
					.optional()
					.describe(
						"Product, audience, market, constraints, and desired character.",
					),
				selectedTlds: z
					.array(z.string())
					.min(1)
					.max(20)
					.optional()
					.describe("TLDs to research, default com/io/co."),
			},
		},
		async ({ name, description, selectedTlds }) => {
			try {
				return textResult(
					JSON.stringify(
						await createNamingProject({ name, description, selectedTlds }),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"generate_names",
		{
			title: "Generate and persist brand names",
			description:
				"Generate brand names with Identity Forge's own operator-owned model and persist them to the project board's `generated` column with full model, prompt-version, and credit provenance. SPENDS the key owner's AI credits, one per uniquely persisted name, charged only after the rows commit, so a failed run costs nothing. Always pass a stable idempotencyKey so a retry after a timeout cannot bill twice. Use it when you want Identity Forge to author the names; if your own agent or an offline process produced them, use add_name_candidates instead, which is free. Requires the naming:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.uuid()
					.describe("Owned naming project id from list_naming_projects."),
				description: z
					.string()
					.min(2)
					.max(2000)
					.describe(
						"The specific brief for this run: product, audience, market, and desired character. Output quality tracks this directly, so do not pass a bare product name.",
					),
				recipeIds: z
					.array(z.string())
					.min(1)
					.max(8)
					.describe("1-8 recipe ids returned by list_naming_recipes."),
				count: z
					.number()
					.int()
					.min(1)
					.max(30)
					.optional()
					.describe(
						"How many names to generate, 1-30. Each uniquely persisted name spends one AI credit.",
					),
				frequencyPenalty: z
					.number()
					.min(-2)
					.max(2)
					.optional()
					.describe(
						"Model frequency penalty, -2 to 2. Raise it when a previous run returned repetitive stems.",
					),
				idempotencyKey: z
					.string()
					.min(8)
					.max(128)
					.optional()
					.describe(
						"Stable unique key for this exact request. Reusing it returns the original result instead of generating and charging again. Always set it.",
					),
				styleOptions: z
					.object({
						selectedPrefixes: z
							.array(z.string())
							.max(8)
							.optional()
							.describe("Up to 8 prefixes the model should build on."),
						selectedSuffixes: z
							.array(z.string())
							.max(8)
							.optional()
							.describe("Up to 8 suffixes the model should build on."),
						allowMisspellings: z
							.boolean()
							.optional()
							.describe(
								"Allow deliberate respellings (e.g. Lyft, Flickr). Default false.",
							),
					})
					.optional()
					.describe("Optional constraints on the shape of generated names."),
			},
		},
		async ({ projectId, ...request }) => {
			try {
				return textResult(
					JSON.stringify(
						await generateNamingCandidates({ projectId, ...request }),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_name_candidates",
		{
			title: "Read a naming kanban board",
			description:
				"Read one project's candidate kanban. Returns each persisted name with its status, rank, notes, attached research evidence, originating recipe, generation provenance, and an updatedAt timestamp you pass back to move_name_candidates or rank_name_candidates to guard against stale writes. Filter by status to review a single column, such as just the shortlisted or finalist names. Read-only, paginated, and free. Requires the naming:read scope.",
			inputSchema: {
				projectId: z
					.string()
					.uuid()
					.describe("Owned naming project id from list_naming_projects."),
				statuses: z
					.enum(NAMING_CANDIDATE_STATUSES)
					.array()
					.max(6)
					.optional()
					.describe(
						"Return only these kanban columns. Omit for the whole board.",
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Page size, 1-100."),
				offset: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Start index for paging, default 0."),
			},
		},
		async ({ projectId, statuses, limit, offset }) => {
			try {
				return textResult(
					JSON.stringify(
						await listNamingCandidates({
							projectId,
							statuses,
							limit,
							offset,
						}),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"add_name_candidates",
		{
			title: "Persist externally researched name candidates",
			description:
				"Persist 1-50 names your own agent, another model, or manual research produced onto the durable project board, so a shortlist never lives only in the chat transcript. This is the free counterpart to generate_names: it stores names rather than authoring them, and spends no AI credits. Each item needs a caller-generated UUID, which makes retries safe. Sending identical data again returns the same row; reusing an id with changed data returns a conflict instead of silently overwriting. Requires the naming:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.uuid()
					.describe("Owned naming project id from list_naming_projects."),
				candidates: z
					.array(
						z.object({
							candidateId: z
								.string()
								.uuid()
								.describe(
									"Caller-generated UUID that makes this insert idempotent. Reuse it verbatim when retrying.",
								),
							name: z.string().min(1).max(80).describe("The candidate name."),
							description: z
								.string()
								.max(500)
								.nullable()
								.optional()
								.describe("Short rationale for the name."),
							status: z
								.enum(NAMING_CANDIDATE_STATUSES)
								.optional()
								.describe("Starting kanban column, default generated."),
							rank: z
								.number()
								.int()
								.min(1)
								.max(1_000_000)
								.nullable()
								.optional()
								.describe("Optional priority, 1 = highest."),
							notes: z
								.string()
								.max(4000)
								.nullable()
								.optional()
								.describe("Working notes for the review pass."),
							evidence: z
								.record(z.string(), z.unknown())
								.optional()
								.describe(
									"Raw research findings to attach, keyed however your workflow needs.",
								),
						}),
					)
					.min(1)
					.max(50)
					.describe("1-50 candidates to persist."),
			},
		},
		async ({ projectId, candidates }) => {
			try {
				return textResult(
					JSON.stringify(
						await addNamingCandidates({ projectId, candidates }),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_name_generations",
		{
			title: "Read naming generation provenance",
			description:
				"Read the generation ledger for one project: every generate_names run with its request fingerprint, recipes and settings, model, prompt version, how many names it produced, how many credits it reserved and actually consumed, final status, and timestamps. Use it to answer where a given set of names came from, or to check whether a run that appeared to fail actually charged anything before retrying. Read-only, paginated, and free. Requires the naming:read scope.",
			inputSchema: {
				projectId: z
					.string()
					.uuid()
					.describe("Owned naming project id from list_naming_projects."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Page size, 1-100."),
				offset: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Start index for paging, default 0."),
			},
		},
		async ({ projectId, limit, offset }) => {
			try {
				return textResult(
					JSON.stringify(
						await listNamingGenerations({ projectId, limit, offset }),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"move_name_candidates",
		{
			title: "Move or annotate naming candidates",
			description:
				"Progress up to 100 candidates through the kanban in one atomic write, and optionally replace their notes and evidence at the same time. Columns run generated, reviewing, shortlisted, finalist, selected, and rejected. This is the tool for recording a decision and why you made it; rank_name_candidates only reorders and leaves status alone. A project can hold exactly one selected candidate, and selecting one also sets the project's chosen brand name, so treat that move as the final call. Pass expectedUpdatedAt from list_name_candidates to reject a write when the row changed underneath you. Requires the naming:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.uuid()
					.describe("Owned naming project id from list_naming_projects."),
				operations: z
					.array(
						z.object({
							candidateId: z
								.string()
								.uuid()
								.describe("Candidate id from list_name_candidates."),
							status: z
								.enum(NAMING_CANDIDATE_STATUSES)
								.optional()
								.describe(
									"Target column. Omit to edit notes or evidence without moving the candidate.",
								),
							notes: z
								.string()
								.max(4000)
								.nullable()
								.optional()
								.describe(
									"Replaces the existing notes. Pass null to clear them.",
								),
							evidence: z
								.record(z.string(), z.unknown())
								.optional()
								.describe("Replaces the attached research evidence."),
							expectedUpdatedAt: z
								.string()
								.optional()
								.describe(
									"The candidate's updatedAt from list_name_candidates. Pass it to reject the write if the row changed meanwhile.",
								),
						}),
					)
					.min(1)
					.max(100)
					.describe("1-100 operations, applied atomically."),
			},
		},
		async ({ projectId, operations }) => {
			try {
				return textResult(
					JSON.stringify(
						await patchNamingCandidates({ projectId, operations }),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"rank_name_candidates",
		{
			title: "Rank naming candidates",
			description:
				"Assign explicit user-facing priority ranks to up to 100 candidates on one naming board in a single atomic write, so every ranking applies or none does. Rank 1 is the highest priority and ties are allowed. This changes ONLY the rank field: kanban status, notes, and evidence are left untouched, so use move_name_candidates when you want to progress a candidate or record a decision. Use it to express a deliberate shortlist order for the user, not to record research. Requires the naming:write scope; it spends no AI credits.",
			inputSchema: {
				projectId: z
					.string()
					.uuid()
					.describe("Owned naming project id from list_naming_projects."),
				rankings: z
					.array(
						z.object({
							candidateId: z
								.string()
								.uuid()
								.describe("Candidate id from list_name_candidates."),
							rank: z
								.number()
								.int()
								.min(1)
								.max(1_000_000)
								.describe("Positive priority, 1 = highest. Ties are allowed."),
							expectedUpdatedAt: z
								.string()
								.optional()
								.describe(
									"The candidate's updatedAt from list_name_candidates. Pass it to reject the write if the row changed meanwhile.",
								),
						}),
					)
					.min(1)
					.max(100)
					.describe("1-100 ranking operations, applied atomically."),
			},
		},
		async ({ projectId, rankings }) => {
			try {
				return textResult(
					JSON.stringify(
						await patchNamingCandidates({
							projectId,
							operations: rankings,
						}),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_naming_research_context",
		{
			title: "Prepare a naming research handoff",
			description:
				"Load everything you need to plan naming research in one call: the project brief, up to 100 candidates with the evidence already attached to them, which factual checks are available, workflow guidance, and a template for handing bounded questions to sub-tasks. Call it before orchestrating substantial research so you do not re-run checks that already exist on the board. It deliberately does not rank candidates, score them, or tell you which model to delegate to, because that judgement stays with you. Read-only and free. Requires the naming:read scope.",
			inputSchema: {
				projectId: z
					.string()
					.uuid()
					.describe("Owned naming project id from list_naming_projects."),
			},
		},
		async ({ projectId }) => {
			try {
				return textResult(
					JSON.stringify(await getNamingResearchContext(projectId), null, 2),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"search_name_evidence",
		{
			title: "Run model-authored name searches",
			description:
				"Run up to 20 web searches you author yourself against a candidate name through Identity Forge's self-hosted SearXNG. Each query spends one account-wide monthly API unit. Returns dated raw results and nothing else: it does not score, rank, decide whether a collision is real, or constitute trademark clearance. Attach evidence and interpretation with move_name_candidates. For domain registration and DNS evidence use check_domains. Requires naming:read.",
			inputSchema: {
				tasks: z
					.array(
						z.object({
							taskId: z
								.string()
								.min(1)
								.max(100)
								.describe(
									"Your own id for this query, echoed back so you can match results to tasks.",
								),
							candidateId: z
								.string()
								.uuid()
								.optional()
								.describe(
									"Board candidate this query is about, when it maps to one.",
								),
							candidateName: z
								.string()
								.min(1)
								.max(80)
								.describe("The name being researched."),
							query: z
								.string()
								.min(2)
								.max(500)
								.describe(
									"The search string. Write it for the specific risk you are testing, not a generic name lookup.",
								),
							purpose: z
								.enum(NAME_RESEARCH_PURPOSES)
								.describe("What kind of risk this query is probing."),
							language: MCP_DOMAIN_LANGUAGE_SCHEMA.optional().describe(
								"Search language tag, e.g. de-DE. Set it when checking how a name reads in a specific market.",
							),
						}),
					)
					.min(1)
					.max(20)
					.describe("1-20 independent search tasks."),
			},
		},
		async ({ tasks }) => {
			try {
				return textResult(
					JSON.stringify(await searchNameEvidence({ tasks }), null, 2),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"search_trademarks",
		{
			title: "Search EUIPO trademarks",
			description:
				"Coming soon. Until EUIPO production access is verified and explicitly enabled, this returns 503 without calling the provider. Preliminary screening only, not legal clearance. Requires naming:read.",
			inputSchema: {
				projectId: z
					.string()
					.uuid()
					.describe("Owned naming project id from list_naming_projects."),
				nameSuggestionId: z
					.string()
					.uuid()
					.describe("Candidate id from list_name_candidates."),
				query: z
					.string()
					.trim()
					.min(1)
					.max(120)
					.describe("Verbal element to search."),
				niceClasses: z
					.array(z.string())
					.max(10)
					.optional()
					.describe(
						"Nice class numbers relevant to the product, e.g. 9 and 42.",
					),
			},
		},
		async ({ projectId, nameSuggestionId, query, niceClasses }) => {
			try {
				return textResult(
					JSON.stringify(
						await searchTrademarks({
							projectId,
							nameSuggestionId,
							query,
							niceClasses,
						}),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"check_domains",
		{
			title: "Check domain evidence",
			description:
				"Check up to 20 bare domains and return separate RDAP, DNS, Cloudflare Registrar, and optional self-hosted SERP evidence. Basic research spends one account-wide monthly API unit per unique domain; SERP adds one more. Results are a snapshot and reserve nothing. Use search_name_evidence for broader name research. Requires naming:read.",
			inputSchema: {
				domains: z
					.array(MCP_DOMAIN_INPUT_SCHEMA)
					.min(1)
					.max(20)
					.describe(
						"1-20 bare domains including the TLD, e.g. 'example.com'. No scheme or path.",
					),
				includeSerp: z
					.boolean()
					.optional()
					.describe("Default false. Enable for finalist collision research."),
				includeRegistrar: z
					.boolean()
					.optional()
					.describe(
						"Default true. Disable only when registrar checks are not needed.",
					),
				market: z
					.string()
					.max(120)
					.optional()
					.describe(
						"Market context for SERP results, e.g. Germany heating retail.",
					),
				language: MCP_DOMAIN_LANGUAGE_SCHEMA.optional().describe(
					"Search language tag, e.g. de-DE.",
				),
			},
		},
		async ({ domains, includeSerp, includeRegistrar, market, language }) => {
			try {
				return textResult(
					JSON.stringify(
						await checkDomains({
							domains,
							includeSerp,
							includeRegistrar,
							market,
							language,
						}),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	// ── Brand authoring (kits:write) ──────────────────────────────────────────
	// Overrides = the mix-and-match surface (tokens/colors/fonts/facet presets),
	// validated loosely here; the server skips unknown roles/presets with a warning.
	const overridesSchema = z
		.object({
			tokens: z
				.object({
					light: z.record(z.string(), z.string()).optional(),
					dark: z.record(z.string(), z.string()).optional(),
				})
				.optional()
				.describe(
					"Per-mode semantic token writes (28 shadcn roles), hex values.",
				),
			colors: z
				.record(z.string(), z.string())
				.optional()
				.describe(
					"Brand colors as role→hex, applied to BOTH light and dark (e.g. {primary:'#E4572E'}).",
				),
			fonts: z
				.object({
					heading: z
						.object({ family: z.string(), name: z.string().optional() })
						.optional(),
					body: z
						.object({ family: z.string(), name: z.string().optional() })
						.optional(),
					mono: z
						.object({ family: z.string(), name: z.string().optional() })
						.optional(),
				})
				.optional()
				.describe("Font family swaps by role."),
			facets: z
				.record(z.string(), z.string())
				.optional()
				.describe(
					"Named facet presets per group: shape | elevation | typeVoice | motion | density (e.g. {shape:'sharp'}).",
				),
		})
		.describe(
			"Mix-and-match overrides applied on top of the base kit. Structure-level composition is not available via the API.",
		)

	function createdKitText(
		kit: Awaited<ReturnType<typeof createTheme>>,
	): string {
		const warn = kit.warnings?.length
			? `\n\nWarnings (skipped overrides):\n- ${kit.warnings.join("\n- ")}`
			: ""
		return `Created private kit "${kit.name}" (${kit.tier}).\nid: ${
			kit.id
		} (permanent, never reassigned. Store this one and address the kit by it.)\nslug: ${
			kit.slug
		} (public handle, mutable)\nStudio: ${kit.links.page}\nDESIGN.md: ${
			kit.links.designMd
		}${warn}\n\nJSON:\n${JSON.stringify(kit)}`
	}

	server.registerTool(
		"create_theme",
		{
			title: "Create a design kit (theme)",
			description:
				"Author a new design kit, either from scratch by passing a `kit` JSON or by forking a published catalog kit with `base` and applying `overrides` for tokens, colors, fonts, and facet presets. Use `base` whenever a catalog kit is close to what you want, since a fork inherits a complete, coherent system and you only state the differences. Authoring from scratch means supplying the whole thing. The result is always PRIVATE and visible only to your key until you publish it from the web Studio; this tool cannot publish. Forking a Pro catalog kit needs an entitled key. Use remix_theme instead when you want several quick variations off one direction. Requires the kits:write scope, so regenerate your key with `identityforge login` if you get a 403 naming it.",
			inputSchema: {
				name: z
					.string()
					.min(1)
					.max(120)
					.describe("Display name for the new kit."),
				base: z
					.string()
					.min(1)
					.max(80)
					.optional()
					.describe("Catalog slug to fork (omit to author from `kit`)."),
				kit: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(
						"A kit JSON to author from scratch (merged over a renderable skeleton). Omit when `base` is set.",
					),
				overrides: overridesSchema.optional(),
			},
		},
		async ({ name, base, kit, overrides }) => {
			try {
				const created = await createTheme({
					name,
					base,
					kit,
					overrides: overrides as KitOverridesInput | undefined,
				})
				return textResult(createdKitText(created))
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"remix_theme",
		{
			title: "Remix a design kit",
			description:
				"Copy an existing kit into a new private kit with `overrides` applied. The source can be your own kit, a catalog kit, or another user's public kit. This is the fast path when you want three or four variations on one direction: call it repeatedly against the same source with different overrides. The original is never modified. Reach for create_theme instead when you are authoring a kit rather than varying one. A Pro-tier source needs an entitled key, and the copy is private until you publish it from the web Studio. Requires the kits:write scope.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.max(100)
					.describe(
						"Permanent id or slug of the kit to copy: your own, a catalog kit, or a public user kit. Prefer the id: it never moves, while a slug can be renamed and a retired slug keeps resolving through an alias.",
					),
				name: z
					.string()
					.min(1)
					.max(120)
					.optional()
					.describe(
						"Name for the copy. Defaults to the source name with a variation suffix.",
					),
				overrides: overridesSchema,
			},
		},
		async ({ slug, name, overrides }) => {
			try {
				const created = await remixTheme({
					slug,
					name,
					overrides: overrides as KitOverridesInput,
				})
				return textResult(createdKitText(created))
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"create_brand_project",
		{
			title: "Create a brand project",
			description:
				"Create the container that holds brand variations and the client share link. Do this once per client brief, then attach several directions with add_brand_variation and send the client a link with share_brand_project. Creating a project on its own shows the client nothing, so it is only the first of those three steps. Call list_brand_projects first to avoid making a second project for a client who already has one. Requires the kits:write scope.",
			inputSchema: {
				name: z
					.string()
					.min(1)
					.max(120)
					.describe("Project name, usually the client or the product."),
				brief: z
					.string()
					.max(2000)
					.optional()
					.describe(
						"What is being built: audience, market, and the character the brand should have.",
					),
			},
		},
		async ({ name, brief }) => {
			try {
				const project = await createBrandProject({ name, brief })
				return textResult(
					`Created brand project "${project.name}" (id ${
						project.project_id
					}). Add variations with add_brand_variation, then share_brand_project.\n\nJSON:\n${JSON.stringify(
						project,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"add_brand_variation",
		{
			title: "Add a brand variation",
			description:
				"Attach one brand proposal to a project: a kit plus an optional brand name, domain, label, and notes. Call it four or five times per project with deliberately contrasting kits, because a client choosing between similar directions cannot tell you much. The kit must be one you can resolve, meaning your own, a catalog kit, or another user's public kit, and a Pro catalog kit needs an entitled key. Variations become visible to the client only once you call share_brand_project. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				kitSlug: z
					.string()
					.min(1)
					.max(100)
					.describe("Slug of the kit this proposal shows."),
				brandName: z
					.string()
					.max(120)
					.optional()
					.describe("Proposed brand name to display with this direction."),
				domain: z
					.string()
					.max(255)
					.optional()
					.describe("Proposed domain to display, e.g. 'example.com'."),
				label: z
					.string()
					.max(120)
					.optional()
					.describe(
						"Short label the client sees, e.g. 'Bold direction'. Helps them talk about the options.",
					),
				notes: z
					.string()
					.max(2000)
					.optional()
					.describe("Rationale for this direction, shown alongside it."),
			},
		},
		async ({ projectId, kitSlug, brandName, domain, label, notes }) => {
			try {
				const variation = await addBrandVariation({
					projectId,
					kitSlug,
					brandName,
					domain,
					label,
					notes,
				})
				return textResult(
					`Added variation ${variation.id} (kit ${
						variation.kit_slug
					}) to project ${projectId}.\n\nJSON:\n${JSON.stringify(variation)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"share_brand_project",
		{
			title: "Share a brand project",
			description:
				"Publish a project to a client and return the full /p/<token> URL to send them. The page is read-only, serves only this project's kits, and lets the client cycle the variations and leave comments without an account. Anyone holding the link can open it, so set a password for sensitive work. Calling it again returns the existing link unchanged unless you pass rotate, which mints a new token and permanently breaks any link already sent. Add the variations before sharing, since the client sees whatever is attached at the moment they open it. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				password: z
					.string()
					.min(1)
					.max(200)
					.optional()
					.describe(
						"Password the client must enter. Set one when the work is confidential.",
					),
				rotate: z
					.boolean()
					.optional()
					.describe(
						"Mint a new token, invalidating the previous link. Use it when a link leaked, not to fetch the existing URL.",
					),
			},
		},
		async ({ projectId, password, rotate }) => {
			try {
				const share = await shareBrandProject({ projectId, password, rotate })
				return textResult(
					`Share ready: ${share.url}${
						share.hasPassword ? " (password protected)" : ""
					}\n\nJSON:\n${JSON.stringify(share)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_brand_project",
		{
			title: "Read one brand project",
			description:
				"Read one board in full: every variation with its kit, brand name, domain, label and notes, plus the state of the client share and a URL for each direction. list_brand_projects gives you summaries and a variation COUNT; this is how you see what is actually on the board. Use it to check your own work after attaching variations, to answer 'what did we send them' without keeping notes of your own, and to read the share state before you change it — whether a link exists, whether it is still serving, whether it has a password, and how many times the client opened it. A project that is not yours, and an id that could never be one, both answer 404 alike, so this cannot be used to find out what exists for somebody else. Read-only and free. Requires the kits:read scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
			},
		},
		async ({ projectId }) => {
			try {
				const project = await getBrandProject(projectId)
				return textResult(JSON.stringify(project, null, 2))
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"update_brand_share",
		{
			title: "Pause, resume or password-protect a share",
			description:
				"Change an existing client link WITHOUT reissuing it. `enabled: false` pauses it, so the client sees nothing until you resume; `password` sets one after the fact, and `null` removes it. The token is untouched, so a link already with the client starts working again the moment you resume. This is the tool to reach for when work is mid-revision and the client should not be looking yet, or when you shared something before realising it was confidential. It takes effect immediately for anyone holding the URL, including a client with the page already open. A project with no share yet answers 404: create one with share_brand_project first. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				enabled: z
					.boolean()
					.optional()
					.describe(
						"false pauses the link, true resumes it. Omit to leave it as it is.",
					),
				password: z
					.string()
					.min(1)
					.max(200)
					.nullable()
					.optional()
					.describe(
						"Set the client's password, or null to remove the protection entirely. Omit to leave it as it is.",
					),
			},
		},
		async ({ projectId, enabled, password }) => {
			try {
				const share = await updateBrandShare({ projectId, enabled, password })
				return textResult(
					`Share ${share.enabled ? "is live" : "is paused"}${
						share.hasPassword ? ", password protected" : ""
					}: ${share.url}\n\nJSON:\n${JSON.stringify(share)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"revoke_brand_share",
		{
			title: "Revoke a client share link",
			description:
				"Withdraw the client's access permanently. The /p/<token> URL stops resolving wherever it was pasted, including in an email already sent. NOT UNDOABLE: sharing again mints a new token and deliberately never the old one, so a withdrawn link can not be brought back to life. This tool requires `confirm: true`; without it nothing changes. Reach for update_brand_share with `enabled: false` instead when the client should see it again later — that is the reversible one, and it is almost always what is wanted. Revoking is for a link that leaked or an engagement that ended. The project, its variations and the comments the client already left all survive; only the access is withdrawn. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				confirm: z
					.boolean()
					.describe(
						"Must be exactly true. Required because revoking is permanent.",
					),
			},
		},
		async ({ projectId, confirm }) => {
			try {
				if (confirm !== true) {
					return errorResult(
						"This permanently revokes the share link and cannot be undone. confirm: true is required. No change was made.",
					)
				}
				const share = await revokeBrandShare(projectId)
				return textResult(
					`Share revoked. The link no longer resolves and cannot be restored; share_brand_project would mint a new token.\n\nJSON:\n${JSON.stringify(
						share,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"delete_theme",
		{
			title: "Delete a saved design kit",
			description:
				"Permanently delete one of your saved design kits. This cannot be undone, so pass `confirm: true` only after you are sure. A kit referenced by a brand project is refused with 409 `kit_in_use`; retire or repoint those references before trying again. Requires the kits:write scope.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.max(100)
					.describe("Permanent id or slug of a kit saved under your own key."),
				confirm: z
					.boolean()
					.describe(
						"Must be exactly true. Required because deletion is permanent.",
					),
			},
		},
		async ({ slug, confirm }) => {
			try {
				if (confirm !== true) {
					return errorResult(
						"This permanently deletes the kit and cannot be undone. confirm: true is required. No change was made.",
					)
				}
				const kit = await deleteTheme(slug)
				return textResult(
					`Deleted kit "${kit.slug}" permanently.\n\nJSON:\n${JSON.stringify(
						kit,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_brand_projects",
		{
			title: "List brand projects",
			description:
				"List every brand project owned by the connected key, each with its name, brief, variation count, and whether a client share link already exists. Start here to find a projectId before add_brand_variation or share_brand_project, and to check whether a board for this client already exists instead of creating a duplicate. Read-only and free: it takes no arguments, returns all projects at once (no pagination), and changes nothing. Requires the kits:read scope.",
			inputSchema: {},
		},
		async () => {
			try {
				const projects = await listBrandProjects()
				return textResult(JSON.stringify(projects, null, 2))
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"generate_mockups",
		{
			title: "Generate brand mockups",
			description:
				"Queue photographic mockups for selected variations and template scenes. This spends one AI credit for every variation and scene combination after the server resolves the selected kits; failed enqueue attempts are refunded. The response contains the job id and polling URL. Requires kits:write.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				variationIds: z
					.array(z.string())
					.min(1)
					.describe("Variation ids from get_brand_project."),
				items: z
					.array(
						z.object({
							templateId: z.string().min(1),
							sceneId: z.string().min(1),
						}),
					)
					.min(1)
					.describe("Template and scene pairs to render for every variation."),
				idempotencyKey: z
					.string()
					.optional()
					.describe(
						"Stable key for a retry that must not spend credits twice.",
					),
			},
		},
		async ({ projectId, variationIds, items, idempotencyKey }) => {
			try {
				return textResult(
					JSON.stringify(
						await generateMockups({
							projectId,
							variationIds,
							items,
							idempotencyKey,
						}),
						null,
						2,
					),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_mockup_jobs",
		{
			title: "List brand mockup jobs",
			description:
				"List one brand project's mockup jobs newest first, including status, progress, errors, and completed result URLs. Read-only. Requires kits:read.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
			},
		},
		async ({ projectId }) => {
			try {
				return textResult(
					JSON.stringify(await listMockupJobs(projectId), null, 2),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_mockup_job",
		{
			title: "Get a brand mockup job",
			description:
				"Poll one mockup job in its project for status, completed count, errors, and result URLs. Read-only. Requires kits:read.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				jobId: z
					.string()
					.describe("Job id from generate_mockups or list_mockup_jobs."),
			},
		},
		async ({ projectId, jobId }) => {
			try {
				return textResult(
					JSON.stringify(await getMockupJob(projectId, jobId), null, 2),
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"update_theme",
		{
			title: "Update a saved design kit",
			description:
				"Edit a design kit you already saved, in place. This OVERWRITES the stored kit without asking: the slug, id and publication state all stay the same, so everything already pointing at that kit follows the edit, including brand variations that reference it, any client share link that serves it, and a repo that installed its registry entry. The overwrite itself has no undo, but it is recorded: every save mints a version, so the state you replaced stays readable through list_kit_versions and get_kit_version, and diff_kit_versions shows exactly what your edit moved. Reach for remix_theme instead when you want the original left alone, which is usually the right call while you are still exploring directions; use this one when the kit is the brand and the brand has genuinely changed. It only edits kits saved under your key. A catalog kit, another user's kit, or an unknown slug all return 404 alike. `kit` is deep merged over the stored payload, so you state only what moves and everything else survives, and `overrides` applies on top of that merge. The one thing you cannot change is the slug itself: it is the kit's public handle and moving it would break every link already using it, so a payload carrying a different slug is rejected with 400 rather than quietly ignored. Pass `expectedUpdatedAt` from the last read to get a 409 instead of silently overwriting a change someone else made in between; the 409 body carries the current marker so you can re-read, reapply and retry. Requires the kits:write scope.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.max(100)
					.describe(
						"Permanent id or slug of a kit saved under your own key. Catalog and other users' kits are not editable.",
					),
				name: z
					.string()
					.min(1)
					.max(120)
					.optional()
					.describe("New display name. Omit to leave the name unchanged."),
				kit: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(
						"Partial kit JSON, deep merged over the stored kit. Unmentioned fields are kept. A `slug` different from the kit's own is rejected.",
					),
				overrides: overridesSchema
					.optional()
					.describe(
						"Token, color, font and facet writes applied on top of the merged kit.",
					),
				expectedUpdatedAt: z
					.string()
					.optional()
					.describe(
						"The updatedAt you last read for this kit. Pass it to reject the write with 409 if the kit changed meanwhile.",
					),
			},
		},
		async ({ slug, name, kit, overrides, expectedUpdatedAt }) => {
			try {
				const updated = await updateTheme({
					slug,
					name,
					kit,
					overrides: overrides as KitOverridesInput | undefined,
					expectedUpdatedAt,
				})
				const warn = updated.warnings?.length
					? `\n\nWarnings (skipped overrides):\n- ${updated.warnings.join(
							"\n- ",
						)}`
					: ""
				return textResult(
					`Updated kit "${updated.slug}" (${updated.name}, ${
						updated.tier
					}) in place.\nStudio: ${updated.links.page}\nDESIGN.md: ${
						updated.links.designMd
					}\nPass expectedUpdatedAt: ${
						updated.updatedAt
					} on your next edit.${warn}\n\nJSON:\n${JSON.stringify(updated)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"update_brand_variation",
		{
			title: "Update a brand variation",
			description:
				"Edit one brand proposal already attached to a project, in place. This OVERWRITES the stored variation, and the client sees the new version the moment they next load the share link, including a client who has the page open right now, so treat it as publishing rather than drafting. Send only the fields that move; passing null for brandName, domain, label or notes clears that field rather than leaving it. Changing kitSlug repoints the proposal at a different design kit, which re-checks that you can resolve that kit and that a Pro kit has an entitled key behind it. Use it to act on client feedback from list_client_comments without making the client re-review a whole new set of directions. Add a new direction with add_brand_variation instead when the old one should stay on the board. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				variationId: z
					.string()
					.describe(
						"Id of a variation in that project, as returned by add_brand_variation or reorder_brand_variations.",
					),
				kitSlug: z
					.string()
					.min(1)
					.max(100)
					.optional()
					.describe(
						"Repoint the proposal at this kit: your own, a catalog kit, or another user's public kit.",
					),
				brandName: z
					.string()
					.max(120)
					.nullable()
					.optional()
					.describe("New brand name to display, or null to clear it."),
				domain: z
					.string()
					.max(255)
					.nullable()
					.optional()
					.describe("New domain to display, or null to clear it."),
				label: z
					.string()
					.max(120)
					.nullable()
					.optional()
					.describe(
						"New short label the client sees, e.g. 'Bold direction', or null to clear it.",
					),
				notes: z
					.string()
					.max(2000)
					.nullable()
					.optional()
					.describe("New rationale shown alongside it, or null to clear it."),
			},
		},
		async ({
			projectId,
			variationId,
			kitSlug,
			brandName,
			domain,
			label,
			notes,
		}) => {
			try {
				const variation = await updateBrandVariation({
					projectId,
					variationId,
					kitSlug,
					brandName,
					domain,
					label,
					notes,
				})
				return textResult(
					`Updated variation ${variation.id} (kit ${
						variation.kit_slug
					}) in project ${projectId}.\n\nJSON:\n${JSON.stringify(variation)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"remove_brand_variation",
		{
			title: "Remove a brand variation",
			description:
				"Permanently DELETE one brand proposal from a project. The client stops seeing that direction on their next share view, and the comments they left on it go with it. This cannot be undone, there is no archive, and `confirm: true` is required, so read list_client_comments first if the feedback on that direction still matters. The surviving variations keep the positions they already had, which leaves a gap in the sequence rather than closing it, so follow with reorder_brand_variations when the order the client meets them in matters. Use update_brand_variation instead when the direction should be revised rather than retired. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				variationId: z
					.string()
					.describe("Id of the variation in that project to delete."),
				confirm: z
					.boolean()
					.describe(
						"Must be exactly true. Required because deletion is permanent.",
					),
			},
		},
		async ({ projectId, variationId, confirm }) => {
			try {
				if (confirm !== true) {
					return errorResult(
						"This permanently deletes the variation and its comments. confirm: true is required. No change was made.",
					)
				}
				const result = await deleteBrandVariation({ projectId, variationId })
				return textResult(
					`Deleted variation ${
						result.id
					} from project ${projectId}. This is permanent.\n\nJSON:\n${JSON.stringify(
						result,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"reorder_brand_variations",
		{
			title: "Reorder brand variations",
			description:
				"Set the order the client meets the directions in. The share page walks the variations in this order, so the first id is the direction the client sees first, which is worth deciding deliberately rather than leaving on the order you happened to attach them in. This OVERWRITES the stored order of the whole project and takes effect on the client's next view. You must list every variation in the project exactly once: a partial list is rejected with 400 and the expected id set, because writing positions for only some of them would collide with the ones left behind. Get the current ids from the response of add_brand_variation, or from a previous call to this tool, which returns the variations in their new order. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				variationIds: z
					.array(z.string())
					.min(1)
					.max(100)
					.describe(
						"Every variation id in the project, exactly once, in the order the client should see them.",
					),
			},
		},
		async ({ projectId, variationIds }) => {
			try {
				const variations = await reorderBrandVariations({
					projectId,
					variationIds,
				})
				return textResult(
					`Reordered ${
						variations.length
					} variations in project ${projectId}.\n\nJSON:\n${JSON.stringify(
						variations,
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_client_comments",
		{
			title: "Read client feedback",
			description:
				"Read what the client wrote on a project's variations through the share link, oldest first, with the variation each comment is attached to and the author's display name. This is the return leg of the share loop: without it you can build a brand project, attach directions and send the link, but never learn what the client actually said about them. Call it before revising, then act on it with update_brand_variation, update_theme, or remove_brand_variation. Anonymous commenters appear as 'Guest' rather than an id, and deleted comments are omitted. Read-only, changes nothing, takes no pagination. Requires the kits:read scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
			},
		},
		async ({ projectId }) => {
			try {
				const comments = await listBrandProjectComments(projectId)
				if (comments.length === 0) {
					return textResult(
						`No client comments on project ${projectId} yet. The client leaves them on the /p/<token> share page.`,
					)
				}
				return textResult(
					`${
						comments.length
					} comment(s) on project ${projectId}:\n${JSON.stringify(
						comments,
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	// The versioning surface, read-only. Nothing here restores or rewrites: a
	// version is a record of what was, and putting it back is a WRITE that
	// belongs behind update_theme where the overwrite rules already live.

	server.registerTool(
		"list_kit_versions",
		{
			title: "List a kit's versions",
			description:
				"The kit's VERSION timeline, newest first: which version, when, by whom, and the author's note. Use it to ask whether a repo's applied kit has moved. Saved kits and managed catalog kits accumulate versions; static catalog fallbacks remain at version 0 until they are promoted into the managed catalog. This is not the wider usage ledger: applying an owned kit to a brand appears in list_kit_history, not here. Metadata only; get_kit_version returns a snapshot and diff_kit_versions returns changed fields. For an unentitled Pro kit, rows remain visible but author labels are withheld. Paginated through meta.nextBefore. Needs kits:read.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.max(100)
					.describe("Permanent kit id or slug, the same as any other read."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(200)
					.optional()
					.describe("Rows per page, newest first. Default 50."),
				before: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe(
						"Return versions BELOW this number. Pass meta.nextBefore from the previous page.",
					),
			},
		},
		async ({ slug, limit, before }) => {
			try {
				const { data, meta } = await listKitVersions(slug, { limit, before })
				if (data.length === 0) {
					return textResult(
						`"${slug}" has no recorded versions. Its current version is ${meta.currentVersion}; 0 means no version has been minted yet.`,
					)
				}
				const gated = meta.gated
					? ` Author notes are hidden on this kit: it is Pro and this key is not entitled (${meta.gated.unlock.url}).`
					: ""
				return textResult(
					`${
						data.length
					} version(s) of "${slug}", newest first. Current version: ${
						meta.currentVersion
					}.${
						meta.hasMore
							? ` More available, pass before=${meta.nextBefore}.`
							: ""
					}${gated}\n\nJSON:\n${JSON.stringify(data, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_kit_version",
		{
			title: "Read one stored kit version",
			description:
				"The full snapshot a given version recorded, as it was at that moment. Reach for this when you need the old values themselves, for example to see what a token was before an edit replaced it; diff_kit_versions is the cheaper answer when you only need to know what moved. The response is a whole design kit, so it is large. A version number is permanent: version 3 is version 3 forever. This returns the entire payload, so it is gated exactly like an export, and a Pro kit without an entitled key answers 403 rather than a redacted body. Needs kits:read.",
			inputSchema: {
				slug: z.string().min(1).max(100).describe("Permanent kit id or slug."),
				version: z
					.number()
					.int()
					.min(1)
					.describe(
						"Version number from list_kit_versions. Positive integer; version 0 is never a stored row, it is the marker for a kit that has never been versioned.",
					),
			},
		},
		async ({ slug, version }) => {
			try {
				const stored = await getKitVersion(slug, version)
				return textResult(
					`Version ${stored.version} of "${slug}" (contentHash ${
						stored.contentHash
					}).\n\nJSON:\n${JSON.stringify(stored.snapshot, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"diff_kit_versions",
		{
			title: "Diff two kit versions",
			description:
				"What changed between two versions of a kit: a list of paths with the old and new value, the CSS custom property a token change drives, and a mechanical summary. This is the tool for taking a brand change into a codebase, because it tells you the handful of things to update rather than making you re-read a whole DESIGN.md. Pass `from` alone to compare against the current version, which is the usual question: `from` is the version your repo recorded in identityforge.json. Pass both to pin a range. It reports what moved and does not judge how big the change is; whether a token shift matters to your UI is your call, not a number we invent. For a Pro kit you are not entitled to, every change comes back with `redacted: true` carrying the path, kind and CSS variable but no before or after, and `redactedChanges` counts them, so you can still see the shape of the change and know exactly what is withheld. Needs kits:read.",
			inputSchema: {
				slug: z.string().min(1).max(100).describe("Permanent kit id or slug."),
				from: z
					.number()
					.int()
					.min(0)
					.describe(
						"Required lower bound, usually the version in identityforge.json. Use 0 for the first recorded state.",
					),
				to: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe(
						"Upper bound. Omit to compare against the kit's current version, which is what you want when asking whether it moved since you built.",
					),
			},
		},
		async ({ slug, from, to }) => {
			try {
				const { data, meta } = await diffKitVersions(slug, { from, to })
				const scope = meta.toIsCurrent
					? `${data.from ?? "creation"} to current (${data.to})`
					: `${data.from ?? "creation"} to ${data.to}`
				const withheld = data.redactedChanges
					? ` ${data.redactedChanges} change(s) have their values withheld: this kit is Pro and the key is not entitled.`
					: ""
				return textResult(
					`"${slug}" ${scope}: ${
						data.summary
					}.${withheld}\n\nJSON:\n${JSON.stringify(data, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	// The ledger, which is a WIDER record than the version timeline above and not
	// a second name for it. `kit_history_events.event_type` takes create, save and
	// apply-to-brand; only the first two mint a version. So "when was this kit
	// actually put on a brand" is answerable here and nowhere else, and an agent
	// given only list_kit_versions sees an edit log with the applications missing.

	server.registerTool(
		"list_kit_history",
		{
			title: "List a kit's history ledger",
			description:
				"Everything that has happened to one of your saved kits, newest first: its creation, every save, and every time it was applied to a brand. Wider than list_kit_versions, which only sees the events that minted a version — an apply-to-brand event appears here and nowhere else, so this is the tool that answers whether a kit was ever actually used rather than merely edited. Each row carries an event id; pass it to get_kit_history_event for the full kit as it stood at that moment. Metadata only, so no tokens come back here. Only kits saved under an API key have a ledger: a curated catalog kit is shipped rather than edited, and asking for one answers 404 rather than an empty list, because you do not own it. Paged by an OPAQUE cursor, not by a number — hand meta.nextCursor back unchanged rather than constructing one, and a cursor this endpoint did not issue is rejected rather than silently restarting from the top. Free to call, needs kits:read.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.max(100)
					.describe("Permanent kit id or slug of a kit you own."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.describe("Rows per page, newest first. Default 20, max 50."),
				cursor: z
					.string()
					.optional()
					.describe(
						"Next page. meta.nextCursor from the previous response, passed back byte for byte. Opaque: it is not a number, a date or an id you can build.",
					),
			},
		},
		async ({ slug, limit, cursor }) => {
			try {
				const { data, meta } = await listKitHistory(slug, { limit, cursor })
				if (data.length === 0) {
					return textResult(
						`"${slug}" has no recorded history. Only kits saved under your own key accumulate one.`,
					)
				}
				// Say what the ledger holds, because the counts are the whole reason
				// this tool exists next to list_kit_versions.
				const applies = data.filter(
					(e) => e.eventType === "apply-to-brand",
				).length
				const shape = applies
					? ` ${applies} of them ${
							applies === 1 ? "is an" : "are"
						} apply-to-brand event${
							applies === 1 ? "" : "s"
						}, which list_kit_versions cannot show you.`
					: ""
				return textResult(
					`${data.length} history entr${
						data.length === 1 ? "y" : "ies"
					} for "${slug}", newest first.${shape}${
						meta.nextCursor
							? ` More available, pass cursor=${meta.nextCursor}.`
							: ""
					}\n\nJSON:\n${JSON.stringify(data, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_kit_history_event",
		{
			title: "Read the kit as it stood at one history entry",
			description:
				"The full kit recorded at one line of the ledger, which is what makes the timeline useful rather than decorative: with it you can diff a past state against the current kit, or PATCH the payload back through update_theme to restore it. The response is a whole design kit, so it is large — call list_kit_history first and fetch only the entry you want. Knowing an event id is never sufficient on its own: the event must be yours AND on a kit you still own, and either test failing answers 404 identically, so a 404 here does not tell you which of the two it was. Needs kits:read.",
			inputSchema: {
				slug: z
					.string()
					.min(1)
					.max(100)
					.describe("Permanent kit id or slug of a kit you own."),
				eventId: z
					.string()
					.min(1)
					.describe("Entry id from list_kit_history, not a version number."),
			},
		},
		async ({ slug, eventId }) => {
			try {
				const snapshot = await getKitHistorySnapshot(slug, eventId)
				return textResult(
					`"${slug}" as it stood at history entry ${eventId}.\n\nJSON:\n${JSON.stringify(
						snapshot,
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"list_brand_project_versions",
		{
			title: "List a brand project's versions",
			description:
				"The brand project's history, newest first: what changed, when, and by whom. Owner-scoped, so a project you do not own answers 404 exactly as a missing one does, and there is no tier gate. The timeline records the whole brand: its name and domain, its fonts, its pinned layers, its project context, and its variations, including a reorder. Sharing is deliberately absent, because who may see a brand is not what the brand is. An empty timeline means the project has not been written since versioning was wired, not that nothing has happened to it. Free to call, needs kits:read.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(200)
					.optional()
					.describe("Rows per page, newest first. Default 50."),
				before: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe("Return versions BELOW this number, for paging."),
			},
		},
		async ({ projectId, limit, before }) => {
			try {
				const { data, meta } = await listBrandProjectVersions(projectId, {
					limit,
					before,
				})
				if (data.length === 0) {
					return textResult(
						`Project ${projectId} has no recorded versions. Its current version is ${meta.currentVersion}; 0 means no version has been minted yet.`,
					)
				}
				return textResult(
					`${
						data.length
					} version(s) of project ${projectId}, newest first. Current version: ${
						meta.currentVersion
					}.${
						meta.hasMore
							? ` More available, pass before=${meta.nextBefore}.`
							: ""
					}\n\nJSON:\n${JSON.stringify(data, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_brand_project_version",
		{
			title: "Read one stored brand project version",
			description:
				"The full snapshot a given version of a brand project recorded. Owner-scoped, like the rest of the brand-project surface. A brand snapshot references its kit rather than embedding it, so this never hands back a Pro kit's tokens by another door. Needs kits:read.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				version: z
					.number()
					.int()
					.min(1)
					.describe("Version number from list_brand_project_versions."),
			},
		},
		async ({ projectId, version }) => {
			try {
				const stored = await getBrandProjectVersion(projectId, version)
				return textResult(
					`Version ${stored.version} of project ${projectId} (contentHash ${
						stored.contentHash
					}).\n\nJSON:\n${JSON.stringify(stored.snapshot, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"diff_brand_project_versions",
		{
			title: "Diff two brand project versions",
			description:
				"What changed between two versions of a brand project. Pass `from` alone to compare against the current version. Owner-scoped, so nothing is redacted: you are reading your own brand. Variation edits appear here as `variations.<id>.<field>` rather than as a wholesale swap, because a variation is identified by id and can be followed across a reorder. Needs kits:read.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				from: z
					.number()
					.int()
					.min(0)
					.describe(
						"Required lower bound. Use 0 for the first recorded state.",
					),
				to: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe(
						"Upper bound. Omit to compare against the project's current version.",
					),
			},
		},
		async ({ projectId, from, to }) => {
			try {
				const { data, meta } = await diffBrandProjectVersions(projectId, {
					from,
					to,
				})
				const scope = meta.toIsCurrent
					? `${data.from ?? "creation"} to current (${data.to})`
					: `${data.from ?? "creation"} to ${data.to}`
				return textResult(
					`Project ${projectId} ${scope}: ${
						data.summary
					}.\n\nJSON:\n${JSON.stringify(data, null, 2)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"whoami",
		{
			title: "What this API key can do",
			description:
				"Your plan, the scopes this key holds and the ones it lacks, how much of the monthly quota is left, your AI credit balance, and how many saved-kit slots remain. Call it before promising a user something the key cannot deliver: every one of these limits is otherwise discoverable only by hitting it, as a 403 for a missing scope or a locked Pro kit, a 429 for quota, a 402 for credits, or a refused save at the free tier's kit cap. This call is free. It spends no quota units and no AI credits, and it is deliberately never refused for being over quota, so it still answers after a 429 has already happened and is safe to call first. Any valid key may read its own entitlements, whatever scopes it holds.",
			inputSchema: {},
		},
		async () => {
			try {
				const me = await getMe()
				const quota =
					me.quota.limit == null
						? `${me.quota.used} units used (unmetered account)`
						: `${me.quota.used} of ${me.quota.limit} units used, ${me.quota.remaining} left, resets ${me.quota.resetsAt}`
				const kits =
					me.kits.limit == null
						? `${me.kits.saved} saved (no limit)`
						: `${me.kits.saved} of ${me.kits.limit} saved, ${me.kits.remaining} slot(s) left`
				const credits = me.credits.unlimited
					? "unlimited"
					: String(me.credits.total)
				const missing = me.scopes.missing.length
					? `\nMissing scopes: ${me.scopes.missing
							.map((scope) => scope.id)
							.join(", ")}. Calls needing them return 403.`
					: ""
				return textResult(
					`Plan: ${me.plan.tier}\nScopes: ${
						me.scopes.granted.join(", ") || "(none)"
					}${missing}\nQuota: ${quota}\nAI credits: ${credits}\nSaved kits: ${kits}\n\nJSON:\n${JSON.stringify(
						me,
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	// The context exchange: describe the product once as a durable object, then
	// ask for proposals grounded in it. The alternative it replaces is re-sending
	// a paragraph of prose on every call and getting a differently-grounded
	// answer each time.

	server.registerTool(
		"get_project_context",
		{
			title: "Read a project's stored context",
			description:
				"What this brand project's product actually is: what it does, who it is for, what the design must respect, what has already been ruled out, which screens it has, and what it is built on. Read it before proposing anything for an existing project, and read it before set_project_context, because that call replaces rather than merges. A project that exists but has no context yet answers null, which is a different fact from a project that does not exist; that one is a 404. Free, needs kits:read.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
			},
		},
		async ({ projectId }) => {
			try {
				const context = await getProjectContext(projectId)
				if (!context) {
					return textResult(
						`Project ${projectId} has no stored context yet. Write one with set_project_context so later recommendations are grounded in it.`,
					)
				}
				return textResult(
					`Context for project ${projectId}:\n\n${JSON.stringify(
						context,
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"set_project_context",
		{
			title: "Replace a project's context",
			description:
				"Store what the product is, so every later proposal is grounded in it and you never re-send a paragraph of prose. This REPLACES the whole context: nothing is merged, so any field you leave out is deleted, not kept. That is deliberate — a merging update would let you drop a surface from the list and silently keep the old one — but it means the safe way to edit is get_project_context first, then send the whole object back with your change applied. `product` is the only required field and must be a real sentence rather than a label; a description under 12 characters is refused, because a proposal built on one reads as grounded while being generic. Every string is bounded and an over-long field is refused by name rather than truncated, so nothing is silently cut. Requires the kits:write scope; reading needs only kits:read.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				product: z
					.string()
					.min(12)
					.max(2000)
					.describe(
						"What the product does, in a sentence or two. The one field a proposal cannot be specific without.",
					),
				audience: z.string().max(500).optional().describe("Who uses it."),
				constraints: z
					.string()
					.max(1000)
					.optional()
					.describe(
						"What the design must respect: an accessibility target, a parent brand, an existing component library, a locale, a regulator.",
					),
				avoid: z
					.string()
					.max(500)
					.optional()
					.describe(
						'Directions already ruled out, in the user\'s own words. "We tried playful and customers hated it" is worth more here than any other field.',
					),
				industry: z
					.string()
					.optional()
					.describe("Industry id from the discovery vocabulary."),
				moods: z
					.array(z.string())
					.max(6)
					.optional()
					.describe(
						"Mood ids from the discovery vocabulary; the feel being aimed at.",
					),
				surfaces: z
					.array(
						z.object({
							useCase: z
								.string()
								.describe(
									`Judged lane this screen is, one of: ${KIT_USE_CASES.join(
										", ",
									)}.`,
								),
							name: z
								.string()
								.max(120)
								.describe('What the team calls it, e.g. "Billing settings".'),
							notes: z
								.string()
								.max(300)
								.optional()
								.describe(
									'What this surface does to a design, e.g. "40-column table, always dense".',
								),
						}),
					)
					.max(24)
					.optional()
					.describe(
						"The screens the product has. This is what narrows candidates: a kit judged unfit for every surface is not a candidate. An empty list is honest and common early on.",
					),
				stack: z
					.object({
						framework: z.string().max(80).optional(),
						styling: z.string().max(80).optional(),
						components: z.string().max(80).optional(),
						notes: z.string().max(300).optional(),
					})
					.optional()
					.describe(
						"What the brand has to be implemented in. Free text, so an unrecognised stack is read by the model rather than rejected.",
					),
			},
		},
		async ({ projectId, ...context }) => {
			try {
				const stored = await putProjectContext(
					projectId,
					context as ProjectContext,
				)
				return textResult(
					`Replaced the context for project ${projectId}. Recommendations for it are now grounded in this.\n\nJSON:\n${JSON.stringify(
						stored,
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"recommend_kits",
		{
			title: "Recommend kits for a project",
			description:
				"Kit candidates for a specific product, grounded in the context stored on its project rather than in a description you re-send. Each candidate comes back with the kit's own case for itself — what it is for, its motifs, its do's and don'ts, its moods and industries, and its computed fitness for the surfaces this product actually has — so you can rank them yourself. With a Pro account and a kits:write key you also get a model-authored ranking with a reason per candidate written against this product; meta.depth says which you got, `ranked` or `candidates`, and meta.order says plainly that the free ordering is computed lane fitness and not a recommendation. Two things that differ from the rest of discovery: this costs 3 quota units where list_themes and search_themes cost 1, and it requires an API key where every other discovery route works anonymously. Call set_project_context first: a project with no stored context returns 400 rather than guessing. Creates nothing.",
			inputSchema: {
				projectId: z
					.string()
					.describe(
						"Owned brand project id whose stored context grounds the proposal. Write it with set_project_context first.",
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(25)
					.optional()
					.describe("How many candidates to return."),
			},
		},
		async ({ projectId, limit }) => {
			try {
				const { data, meta } = await recommendKits({ projectId, limit })
				if (data.length === 0) {
					return textResult(
						`No kit in the catalogue is a candidate for project ${projectId}'s surfaces. Widen the surfaces on its context, or browse with list_themes.`,
					)
				}
				const depth =
					meta.depth === "ranked"
						? "Ranked by a model against this product."
						: `Ordered by ${meta.order}. A Pro account with a kits:write key adds a model ranking with a reason per candidate.`
				const gated = meta.gated
					? ` ${meta.gated.count} further candidate(s) need Pro: ${meta.gated.unlock.url}.`
					: ""
				return textResult(
					`${
						data.length
					} candidate(s) for project ${projectId}. ${depth}${gated}\n\nJSON:\n${JSON.stringify(
						data,
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	/* ── Composition: the axes a brand carries on top of its kit ───────────── */

	server.registerTool(
		"export_brand",
		{
			title: "Get the whole brand as one document",
			description:
				"The brand as ONE document, ready to build from: its design kit's DESIGN.md with every catalogue layer the user pinned written into it. Use this instead of assembling get_design_md plus get_image_direction plus get_interface_style plus get_page_recipe yourself, because merging those four is the part you cannot do correctly — when an interface style asks for translucent panels and the kit specifies flat opaque cards, only we know which wins. The rule is stated in the document itself: the kit owns IDENTITY (its colour tokens, typefaces, spacing and motifs, which nothing below overrides) and a layer owns APPLICATION (what a panel is made of, how a photograph is treated, how a page orders its argument). Follow it rather than re-deciding it, and where a layer would need a kit token changed, keep the token and say so. A brand with nothing pinned returns its kit's DESIGN.md unchanged, which is the honest answer and not an error. A layer this key cannot open is NAMED with its judgment page and an upgrade path, and only its implementation is withheld: build what the kit and the present layers give you and do not invent the missing one, because a guessed implementation looks finished and is not. A brand that has not chosen a kit answers 409 — there is no design system yet, and the placeholder the workspace shows is nobody's choice. Owner-scoped, so the key must own the project; read-only, mints no version, writes nothing. Requires the kits:read scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
			},
		},
		async ({ projectId }) => {
			try {
				const result = await exportBrandProject({ projectId })
				// The stamp goes ABOVE the document rather than into it: the body is
				// the file the user gets, and a line we prepended to it would end up
				// committed to their repo as if the kit had authored it.
				const kit = result.kitSlug
					? `kit ${result.kitSlug}${
							result.kitVersion ? ` v${result.kitVersion}` : ""
						}`
					: "its kit"
				const layers =
					result.layerCount === 0
						? "This brand composes no catalogue layers yet, so this is the kit's own document."
						: `${result.layerCount} catalogue layer(s) are composed into it.`
				return textResult(
					`Brand ${projectId} composed on ${kit}. ${layers}\n\n${result.body}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"get_brand_layers",
		{
			title: "Read a brand's composition",
			description:
				"What a brand project is composed of on top of its design kit: its image direction, its interface style, and its page recipes. Read this BEFORE changing any of them, because it is the only place that tells you what the user already chose and whether it still says what it said. Every reference resolves to the revision the catalogue serves now and carries both numbers — `revision` is current, `chosenRevision` is what the project pinned — and `drift` appears only when they differ, carrying the author's note for what moved. `meta.drifted` counts them, so a brand with nothing to report answers 0 and you can stop. A record withdrawn from the catalogue since it was pinned comes back with `resolved: false` rather than vanishing, because a brand must not quietly forget what it points at, and a Pro layer this key cannot open still returns its name, tier and revision with `locked: true`. `links.preview` is that exact composition rendered as an image, which is the one thing you can put in front of a person who is not going to read a JSON object. Reading changes nothing: it mints no version and never moves a pin, so accepting a drifted revision stays a decision the user makes through add_brand_layer. Requires the kits:read scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
			},
		},
		async ({ projectId }) => {
			try {
				const { data, meta } = await getBrandLayers({ projectId })
				const drift =
					meta.drifted > 0
						? `${meta.drifted} pinned record(s) have moved since they were chosen.`
						: "Nothing has drifted."
				return textResult(
					`Composition of project ${projectId}. ${drift}\n\nJSON:\n${JSON.stringify(
						{ data, meta },
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"add_brand_layer",
		{
			title: "Compose a layer onto a brand",
			description:
				"Put one catalogue record onto a brand project alongside its design kit, so the choice is stored on the user's brand rather than living in this conversation. One tool for all three axes: pass `axis` to say which. The layers belong to the PROJECT and not to the kit, so swapping the kit later leaves them alone — that independence is the whole point of composing axes separately. The pin records the revision the record is at right now, which is what lets get_brand_layers later report that it moved instead of silently applying someone else's edit to the user's brand. `recordId` is the record's permanent id from list_image_directions, list_interface_styles or list_page_recipes, never a slug: slugs are mutable handles and a pin keyed on one could come to mean a different record. imageDirection and interfaceStyle hold ONE each, so composing a second is refused with 409 unless you pass `replace: true` — which is also how you accept a drifted revision after the user has seen what changed. Page recipes are a list and simply accumulate. A Pro record on a key without Pro is refused with 403 and an upgrade path; that is not a conflict and replace will not help. This overwrites live brand state without asking and mints a version recording that your key did it. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				axis: z
					.enum(COLLECTION_LAYER_AXES)
					.describe(
						"Which axis this record belongs to. imageDirection and interfaceStyle hold one each; pageRecipe holds any number.",
					),
				recordId: z
					.string()
					.min(1)
					.describe(
						"The record's permanent id (the `id` field), not its slug. From list_image_directions, list_interface_styles or list_page_recipes.",
					),
				replace: z
					.boolean()
					.optional()
					.describe(
						"Replace what is already on a single-value axis, or accept a revision that has drifted. Ignored for pageRecipe, which is a list. Default false, so a clash is reported rather than overwritten.",
					),
			},
		},
		async ({ projectId, axis, recordId, replace }) => {
			try {
				const { data, meta } = await addBrandLayer({
					projectId,
					axis,
					recordId,
					replace,
				})
				return textResult(
					`${
						meta.changed ? "Composed" : "Already composed"
					}: ${axis} ${recordId} on project ${projectId}.\n\nJSON:\n${JSON.stringify(
						{ data, meta },
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	server.registerTool(
		"remove_brand_layer",
		{
			title: "Take a layer off a brand",
			description:
				"Remove one composed record from a brand project. The brand keeps its design kit and every other axis; only this reference goes. Name the record rather than just the axis, so a stale view of the brand cannot clear a layer it never saw — pass the id you read from get_brand_layers rather than one you remember. Safe to repeat: an id that is not composed answers `changed: false`, changes nothing and mints no version. When the intent is to swap rather than to clear, call add_brand_layer with `replace: true` instead; removing first leaves the brand briefly without that axis and takes two versions to say one thing. This takes effect on the user's brand immediately and requires `confirm: true`; without it nothing changes. Requires the kits:write scope.",
			inputSchema: {
				projectId: z
					.string()
					.describe("Owned brand project id from list_brand_projects."),
				axis: z
					.enum(COLLECTION_LAYER_AXES)
					.describe("Which axis the record sits on."),
				recordId: z
					.string()
					.min(1)
					.describe(
						"Permanent id of the composed record, as reported by get_brand_layers.",
					),
				confirm: z
					.boolean()
					.describe(
						"Must be exactly true. Required because removal is permanent.",
					),
			},
		},
		async ({ projectId, axis, recordId, confirm }) => {
			try {
				if (confirm !== true) {
					return errorResult(
						"This permanently removes the composed layer reference. confirm: true is required. No change was made.",
					)
				}
				const { data, meta } = await removeBrandLayer({
					projectId,
					axis,
					recordId,
				})
				return textResult(
					`${
						meta.changed ? "Removed" : "Was not composed"
					}: ${axis} ${recordId} on project ${projectId}.\n\nJSON:\n${JSON.stringify(
						{ data, meta },
						null,
						2,
					)}`,
				)
			} catch (err) {
				return errorResult(err)
			}
		},
	)

	return server
}

export async function runMcp(): Promise<void> {
	const server = buildMcpServer()
	const transport = new StdioServerTransport()
	await server.connect(transport)
	// The transport owns stdin/stdout; the process stays alive until the
	// client disconnects (closing stdin), at which point connect() resolves.
}
