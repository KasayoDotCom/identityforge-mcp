import { randomUUID } from "node:crypto"

import { resolveApiKey, resolveApiUrl } from "./config.js"
import { isVersionGreater } from "./updateCheck.js"

export const CLI_VERSION = "0.4.5"

export type ApiClient = "cli" | "mcp"

let apiClient: ApiClient = "cli"
const clientProcessReference = randomUUID()
let readDeclaredAgent: (() => string | undefined) | null = null

/** Select the client identity used by subsequent API requests. */
export function setApiClient(client: ApiClient = "cli"): void {
	apiClient = client
}

/**
 * Register how to find out which product is driving this process, so API
 * requests can say so.
 *
 * MCP clients send an `Implementation` in the initialize handshake, so when we
 * run as an MCP server the name arrives unasked: `claude-code`, `cursor-vscode`,
 * `Codex`, `gemini-cli-mcp-client`.
 *
 * This takes a function rather than a value on purpose. The name is only
 * readable once the handshake has completed, and the obvious push — set it from
 * the `initialized` notification — silently sends nothing for the whole session
 * if a client never sends that notification. Reading per request has no such
 * timing to get wrong: a request can only happen after the handshake.
 */
export function setDeclaredAgentSource(
	read: (() => string | undefined) | null,
): void {
	readDeclaredAgent = read
}

/**
 * There is no naming convention across MCP clients — kebab-case, PascalCase,
 * space-separated and package names all ship today — and the API only records
 * `^[a-z][a-z0-9][a-z0-9._-]{0,38}$`. Anything that will not survive that is
 * dropped here rather than sent and silently ignored at the other end.
 */
function declaredAgentToken(): string | null {
	const token = (readDeclaredAgent?.() ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
	return /^[a-z][a-z0-9][a-z0-9._-]*$/.test(token) ? token : null
}

export const EXPORT_FORMATS = [
	"design-md",
	"dtcg",
	"css",
	"tailwind-v3",
	"tailwind-v4",
	"shadcn-registry",
	"json",
] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export interface KitSummary {
	/** Permanent opaque id. The slug is a mutable public handle and can be
	 *  reclaimed by a different kit; this never moves. Prefer it for anything
	 *  stored or repeated. */
	id?: string
	slug: string
	name: string
	shortName?: string
	summary?: string
	audience?: string
	bestFor?: string[]
	tags?: string[]
	/** Short "how it feels" blurb — the agent's main vibe signal. */
	moodSummary?: string
	/** Mood/feel adjectives to rank against the brief. */
	vibeTags?: string[]
	frameworkTargets?: string[]
	tier?: "free" | "pro"
	locked?: boolean
	/** Selection glimpse only — names, not full font objects. */
	fonts?: { heading?: string; body?: string; mono?: string }
	/** Four-swatch palette glimpse from the kit's light token set. */
	colors?: {
		background?: string
		foreground?: string
		primary?: string
		accent?: string
	}
	/**
	 * Measured chart-series capability for the mode the kit ships in — the block
	 * to read when the job is dense data, instead of the fitness score.
	 *
	 * `series` is withheld for a locked Pro kit; the measurements are not, so a
	 * locked kit can still be shortlisted and recommended for unlocking.
	 * `severityHeadroom` is how close any series comes to
	 * destructive/warning/success: 0 means a category color IS a status color.
	 * `designed: false` means the kit defines no chart1..5 and these five were
	 * cycled from its brand roles, so they are not a categorical scale.
	 */
	charts?: {
		mode?: "light" | "dark"
		series?: string[]
		designed?: boolean
		minDeltaE?: number | null
		cvdMinDeltaE?: number | null
		distinct?: number
		hueFamilies?: number
		severityHeadroom?: number | null
		sequentialReady?: boolean
		contrastOnCard?: number | null
	}
	/** Popularity signals (saves + successful installs); ~0 at cold-start. */
	saved?: number
	installs?: number
	popularity?: number
	/** Discovery facets: authored use-case eligibility followed by measured
	 *  fitness 0-100, plus moods and industries.
	 *
	 *  `fitReasons` is `{}` for every kit today and `fit.reason` is absent, so
	 *  the score arrives without prose explaining it. Both stay in the shape
	 *  because the server still types them and will fill them on re-enrichment;
	 *  neither may be described to a user as something we provide. */
	discovery?: {
		style?: string
		styleLabel?: string
		moods?: string[]
		industries?: string[]
		useCases?: { useCase: string; fit: number }[]
		fitReasons?: Record<string, string>
	}
	/** Present when the list was filtered by `use`: this kit's computed fit. */
	fit?: { useCase: string; score: number; reason?: string }
	/** Present when the list was searched with `q`: ranked relevance. */
	relevance?: number
	[key: string]: unknown
}

/** Use-case lane ids accepted by `use` (mirrors the server taxonomy —
 *  src/data/styleCategories.ts USE_CASES; keep in sync). */
export const KIT_USE_CASES = [
	"data-dashboard",
	"admin-internal-tool",
	"saas-marketing",
	"landing-page",
	"ecommerce-store",
	"portfolio",
	"editorial-blog",
	"docs-knowledge-base",
	"mobile-app",
	"business-services",
	"community-social",
	"ai-agent-chat",
] as const
export type KitUseCase = (typeof KIT_USE_CASES)[number]

export interface ResolveMatch {
	kit: KitSummary
	links: {
		page: string
		/** The machine read of the same kit. */
		self: string
		designMd: string
		registry: string
	}
}

export interface SimilarMatch {
	/** 0..1 blended similarity (palette + tags + audience). */
	similarity: number
	kit: KitSummary
	links: {
		page: string
		/** The machine read of the same kit. */
		self: string
		designMd: string
		registry: string
	}
}

export interface PaletteMatch {
	/** 0..1 closeness (1 = identical palette). */
	match: number
	/** Raw CIEDE2000 palette distance (lower = closer), or null if unknown. */
	distance: number | null
	kit: KitSummary
	links: {
		page: string
		/** The machine read of the same kit. */
		self: string
		designMd: string
		registry: string
	}
}

export interface ExportResult {
	body: string
	filename: string
	contentType: string
}

export const COLLECTION_TIERS = ["free", "pro"] as const
export type CollectionTier = (typeof COLLECTION_TIERS)[number]

export const COLLECTION_SORTS = ["curated", "az", "free-first"] as const
export type CollectionSort = (typeof COLLECTION_SORTS)[number]

export const COLLECTION_EXPORT_FORMATS = ["markdown", "json"] as const
export type CollectionExportFormat = (typeof COLLECTION_EXPORT_FORMATS)[number]

export const IMAGE_DIRECTION_PURPOSES = [
	"hero",
	"product",
	"editorial",
	"explainer",
	"background",
	"campaign",
] as const
export type ImageDirectionPurpose = (typeof IMAGE_DIRECTION_PURPOSES)[number]

export const IMAGE_DIRECTION_FAMILIES = [
	"illustration-editorial",
	"drawing-linework",
	"painting-painterly",
	"print-poster",
	"photography",
	"collage-mixed-media",
	"rendering-3d",
	"animation-comics-sequential",
	"era-movement",
	"graphic-typographic-sign",
	"digital-generative-abstract",
	"sculpture-physical",
	"screen-native-game-interface",
] as const
export type ImageDirectionFamily = (typeof IMAGE_DIRECTION_FAMILIES)[number]

export const PAGE_RECIPE_GOALS = [
	"first-action",
	"show-the-work",
	"earn-trust",
	"map-the-breadth",
] as const
export type PageRecipeGoal = (typeof PAGE_RECIPE_GOALS)[number]

export const INTERFACE_STYLE_FAMILIES = [
	"surface-material",
	"system-typographic",
	"era-motif",
	"screen-native",
	"treatment",
] as const
export type InterfaceStyleFamily = (typeof INTERFACE_STYLE_FAMILIES)[number]

/**
 * The identity every collection record carries (mirrors the server's
 * `CollectionRecordIdentity` — src/lib/collections/types.ts; keep in sync).
 *
 * `revision` is editorial and hand-bumped, not derived from the content: the
 * author decides when a change is material enough to announce to consumers who
 * pinned the last one, and `revisionNote` is what they read to learn what moved.
 * Shipping the number without the reason would keep the trigger and discard the
 * meaning, so both travel together.
 */
export interface CollectionRecordIdentity {
	/** Opaque and permanent. Generated once, never regenerated, never reused.
	 *  Unlike the slug there is no alias fallback for these, so store the id. */
	id: string
	/** Editorial revision, hand-bumped, starting at 1. */
	revision: number
}

export interface ImageDirectionSummary extends CollectionRecordIdentity {
	slug: string
	researchId: string
	name: string
	aliases: string[]
	family: ImageDirectionFamily
	medium: string
	purposes: ImageDirectionPurpose[]
	control: "prompt" | "prompt-plus-reference" | "reference-led"
	summary: string
	visualSignals: string[]
	bestFor: string[]
	agentTags: string[]
	tier: CollectionTier
}

export interface ImageDirectionDetail extends ImageDirectionSummary {
	/** What moved in this revision, for an agent that pinned the previous one.
	 *  Detail projections only, and absent until an author writes one. */
	revisionNote?: string
	worksBecause: string[]
	avoidWhen: string[]
	accessibility: string[]
	compatibility: {
		pairsWith: string[]
		tensionWith: string[]
		note: string
	}
	specimenNote: string
}

export interface PageRecipeSection {
	role: "orient" | "act" | "demonstrate" | "prove" | "navigate" | "convert"
	label: string
	note: string
	weight: 1 | 2 | 3
}

interface PageRecipeSummaryBase extends CollectionRecordIdentity {
	slug: string
	code: string
	name: string
	goal: PageRecipeGoal
	summary: string
	audience: string
	productFit: string
	agentTags: string[]
	tier: CollectionTier
}

export interface CommunicationPageRecipeSummary extends PageRecipeSummaryBase {
	model: "communication-idea"
	idea: string
	useWhen: string[]
	avoidWhen: string[]
}

export interface LegacyPageRecipeSummary extends PageRecipeSummaryBase {
	model: "legacy-sequence"
	migrationStatus: "awaiting-communication-review"
	sections: PageRecipeSection[]
}

export type PageRecipeSummary =
	| CommunicationPageRecipeSummary
	| LegacyPageRecipeSummary

export interface PageRecipeSource {
	id: string
	product: string
	url: string
	faviconUrl: string
	observedOn: string
	observation: string
	contribution: string
	difference: string
	screenshot?: {
		url: string
		capturedOn: string
		width: number
		height: number
		alt: string
	}
}

export interface CommunicationPageRecipeDetail
	extends CommunicationPageRecipeSummary {
	/** What moved in this revision, for an agent that pinned the previous one.
	 *  Detail projections only, and absent until an author writes one. */
	revisionNote?: string
	updatedOn: string
	whyItWorks: string
	whatItControls: string
	whatTheDesignKitControls: string
	sharedPattern: string
	sources: PageRecipeSource[]
	expressions: Array<{ name: string; description: string }>
	requiredInputs: string[]
	guardrails: string[]
	successChecks: string[]
	agentHandoff: string
}

export interface LegacyPageRecipeDetail extends LegacyPageRecipeSummary {
	/** What moved in this revision, for an agent that pinned the previous one.
	 *  Detail projections only, and absent until an author writes one. */
	revisionNote?: string
	notFor: string
	narrative: string[]
	evidenceStrategy: string[]
	ctaStrategy: {
		primary: string
		secondary: string
		placement: string
	}
	responsive: string[]
	antiPatterns: string[]
}

export type PageRecipeDetail =
	| CommunicationPageRecipeDetail
	| LegacyPageRecipeDetail

export interface InterfaceStyleSummary extends CollectionRecordIdentity {
	slug: string
	name: string
	aliases: string[]
	family: InterfaceStyleFamily
	designKitStyleId: string | null
	useCases: KitUseCase[]
	summary: string
	visualSignals: string[]
	bestFor: string[]
	previewId: string
	agentTags: string[]
	tier: CollectionTier
}

export const NAMING_CANDIDATE_STATUSES = [
	"generated",
	"reviewing",
	"shortlisted",
	"finalist",
	"selected",
	"rejected",
] as const
export type NamingCandidateStatus = (typeof NAMING_CANDIDATE_STATUSES)[number]

export interface NamingRecipe {
	id: string
	label: string
	description: string
	instruction: string
	settings: Array<Record<string, unknown>>
}

export interface NamingProject {
	id: string
	name: string
	description: string | null
	selectedTlds: string[]
	selectedName: string | null
	selectedDomain: string | null
	createdAt: string | null
	updatedAt: string | null
}

export interface NamingCandidate {
	id: string
	projectId: string
	name: string
	description: string | null
	status: NamingCandidateStatus
	rank: number | null
	notes: string | null
	evidence: Record<string, unknown>
	recipeId: string | null
	generationId: string | null
	generationDescription: string | null
	createdAt: string | null
	updatedAt: string | null
}

/**
 * A candidate researched outside Identity Forge (for example by Codex exec or
 * another model). The caller owns `candidateId`, which makes an exact retry
 * idempotent and a changed retry conflict instead of silently overwriting data.
 */
export interface NamingCandidateCreateInput {
	candidateId: string
	name: string
	description?: string | null
	status?: NamingCandidateStatus
	rank?: number | null
	notes?: string | null
	evidence?: Record<string, unknown>
}

export interface NamingGeneration {
	id: string
	projectId: string
	status: "running" | "succeeded" | "failed"
	description: string
	recipeIds: string[]
	styleOptions: Record<string, unknown>
	frequencyPenalty: number
	requestedCount: number
	generatedCount: number
	model: { provider: string; id: string }
	promptVersion: string
	requestFingerprint: string
	creditReservationId: string | null
	creditsConsumed: number | null
	createdAt: string
	completedAt: string | null
}

export interface DomainEvidence {
	kind:
		| "iana_bootstrap"
		| "rdap"
		| "dns"
		| "serp"
		| "registrar"
		| "landing_page"
	source: string
	checkedAt: string
	outcome: string
	httpStatus?: number
	detail?: string
}

export interface DomainCheckResult {
	input: string
	normalized: { ascii: string; unicode: string; tld: string }
	registration: {
		status: "registered" | "unregistered" | "unknown"
		checkedAt: string
		reason?: string
		evidence: DomainEvidence[]
	}
	dns: {
		status: "records_present" | "no_records" | "unknown" | "not_requested"
		recordTypes: string[]
		checkedAt: string
		evidence: DomainEvidence[]
	}
	serp: {
		status: "signals_found" | "no_signals" | "unknown" | "not_requested"
		query: string | null
		resultCount: number | null
		directDomainMatches: string[]
		results: Array<{
			title: string
			url: string
			engine?: string
			matchedBy?: string[]
		}>
		checkedAt: string
		evidence: DomainEvidence[]
	}
	registrar: {
		status:
			| "registrable"
			| "unavailable"
			| "premium"
			| "unsupported"
			| "unknown"
			| "not_requested"
		provider: "cloudflare_registrar" | null
		reason: string
		tier: "standard" | "premium" | null
		pricing: {
			currency: string
			registrationCost: string
			renewalCost: string
		} | null
		checkedAt: string
		evidence: DomainEvidence[]
	}
	aftermarket: {
		status:
			| "listing_observed"
			| "no_listing_signal_observed"
			| "unknown"
			| "not_requested"
		siteUse:
			| "sale_landing_page_observed"
			| "reserved_page_observed"
			| "site_observed"
			| "unreachable"
			| "unknown"
			| "not_requested"
		checkedAt: string
		url: string | null
		title: string | null
		marketplace: string | null
		priceTexts: string[]
		statement: string
		evidence: DomainEvidence[]
	}
	availabilityHint: {
		status: "might_be_available" | "likely_unavailable_or_in_use" | "unknown"
		basis: "dns_and_rdap_proxy_only"
		statement: string
		nextSteps: ["visit_url", "check_registrar"]
	}
	registrationAvailability: {
		status: "available" | "unavailable" | "unknown"
		reason: string
		statement: string
		pricing?: {
			currency: string
			registrationCost: string
			renewalCost: string
		}
	}
	purchaseAvailability: DomainCheckResult["registrationAvailability"]
	acquisition: {
		intent: "new_registration" | "aftermarket" | "either"
		status:
			| "registration_available"
			| "aftermarket_listing_observed"
			| "no_new_registration_path"
			| "no_aftermarket_listing_observed"
			| "unknown"
		statement: string
	}
	cache: {
		registration: boolean
		dns: boolean
		registrar: boolean
		aftermarket: boolean
	}
	cautions?: string[]
}

export interface DomainCheckBatch {
	data: DomainCheckResult[]
	errors: Array<{ index?: number; input: string; code?: string; error: string }>
	meta: {
		requested: number
		count: number
		errorCount?: number
		checkedAt: string
		registrationSemantics: string
		registrationAvailability: "not_assessed" | "assessed"
		aftermarketAvailability: "not_assessed" | "assessed"
		purchaseAvailability: "not_assessed" | "assessed"
		cacheHits: {
			registration: number
			dns: number
			registrar: number
			aftermarket: number
		}
		usageUnits?: number
		billing?: {
			nominalUnits: number
			chargedUnits: number
			reason: "new_request" | "recent_exact_repeat"
			repeatWindowSeconds: number
		}
	}
}

export const NAME_RESEARCH_PURPOSES = [
	"exact_name",
	"market_collision",
	"meaning_origin",
	"negative_association",
	"official_register_discovery",
	"custom",
] as const
export type NameResearchPurpose = (typeof NAME_RESEARCH_PURPOSES)[number]

export interface NameResearchTask {
	taskId: string
	candidateId?: string
	candidateName: string
	query: string
	purpose: NameResearchPurpose
	language?: string
}

export interface NameSearchResult {
	taskId: string
	candidateId?: string
	candidateName: string
	purpose: NameResearchPurpose
	query: string
	status: "results" | "no_results" | "unknown"
	resultCount: number | null
	results: Array<{
		title: string
		url: string
		snippet?: string
		engine?: string
	}>
	checkedAt: string
	source: string
	detail?: string
}

export interface NamingResearchContext {
	project: NamingProject
	candidates: NamingCandidate[]
	research: {
		capabilities: Array<Record<string, unknown>>
		instructions: string[]
		evidenceContract: Record<string, string>
	}
	trademarkScreening: {
		asOf: string
		semantics: string
		providers: Array<Record<string, unknown>>
		recordEvidenceAs: Record<string, unknown>
		handoff: string
	}
	taskTemplate: Record<string, unknown>
}

/**
 * Error carrying the HTTP status so callers can special-case 401/429, plus
 * every other field the API sent alongside the message.
 *
 * `details` is deliberately unschema'd: the server decides what an error
 * carries (`code`, `issues`, `quota`, `currentUpdatedAt`, `upgradeUrl`, …) and
 * this passes it through verbatim. Dropping it made documented retry loops
 * impossible to perform, because the 409 stale-write marker never reached the
 * caller.
 */
export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public path?: string,
		public details?: Record<string, unknown>,
	) {
		super(message)
		this.name = "ApiError"
	}
}

function authHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		"User-Agent": `identityforge-${apiClient}/${CLI_VERSION}`,
	}
	if (process.env.IDENTITYFORGE_TELEMETRY !== "0") {
		headers["X-IdentityForge-Process"] = clientProcessReference
		const agent = declaredAgentToken()
		if (agent) headers["X-Agent-Client"] = agent
	}
	const key = resolveApiKey()
	if (key) headers.Authorization = `Bearer ${key}`
	return headers
}

/**
 * Rewrite every `links` value in a parsed response body to an absolute URL.
 *
 * The API emits paths — `"page": "/kits/bento-noir"` — which is the right REST
 * contract, because a client that knows its own base can resolve them and the
 * server must never guess its origin from a caller-supplied header. It is the
 * wrong thing to hand an agent. Over the real MCP protocol, `create_theme`
 * returned `Studio: /kits/bento-noir` in its sentence and the same path again
 * in its JSON, and a model has no base to join those to: the one link that
 * exists so it can show a person the kit instead of describing it was not
 * openable, and could not be passed on.
 *
 * This client is where the base is known, so it resolves them once, here, for
 * both the sentence and the JSON. Doing it at the render sites instead would
 * put two spellings of one url in the same tool result.
 *
 * Scoped to values under a key named `links`, and only those starting with `/`.
 * A blanket "looks like a path" rewrite would corrupt real content — a slug, a
 * DESIGN.md body, a token value. Already-absolute urls survive unchanged, so a
 * server that starts emitting them is not double-prefixed. Mutates the freshly
 * parsed body in place; nothing else holds a reference to it yet.
 */
function absolutizeLinks(value: unknown, base: string): void {
	if (!value || typeof value !== "object") return
	if (Array.isArray(value)) {
		for (const item of value) absolutizeLinks(item, base)
		return
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (key === "links" && child && typeof child === "object") {
			for (const [name, link] of Object.entries(
				child as Record<string, unknown>,
			)) {
				if (typeof link === "string" && link.startsWith("/")) {
					;(child as Record<string, unknown>)[name] = new URL(
						link,
						base,
					).toString()
				}
			}
		}
		absolutizeLinks(child, base)
	}
}

async function readError(res: Response, path: string): Promise<ApiError> {
	const text = await res.text().catch(() => "")
	let message = text || res.statusText
	let details: Record<string, unknown> | undefined
	try {
		const json = JSON.parse(text) as unknown
		if (json && typeof json === "object" && !Array.isArray(json)) {
			const fields = { ...(json as Record<string, unknown>) }
			// Whichever key supplied the sentence is spent; everything else the
			// server chose to send survives as structured detail.
			for (const key of ["error", "message"] as const) {
				if (typeof fields[key] === "string" && fields[key]) {
					message = fields[key] as string
					delete fields[key]
					break
				}
			}
			// The 403 for a locked Pro record carries the two links the caller CAN
			// still open; they are as useless relative as any other.
			absolutizeLinks(fields, resolveApiUrl())
			if (Object.keys(fields).length > 0) details = fields
		}
	} catch {
		// non-JSON body; keep raw text
	}
	return new ApiError(res.status, message, path, details)
}

let minimumCliWarningPrinted = false

function noteMinimumCliVersion(res: Response): void {
	if (minimumCliWarningPrinted) return
	const minimum = res.headers.get("x-identityforge-min-cli")
	if (!minimum || !isVersionGreater(minimum, CLI_VERSION)) return
	minimumCliWarningPrinted = true
	process.stderr.write(
		`Identity Forge server requires CLI ${minimum} or newer; installed CLI is ${CLI_VERSION}. Update with npm i -g identityforge@latest.\n`,
	)
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${resolveApiUrl()}${path}`, {
		...init,
		headers: { ...authHeaders(), ...(init?.headers as Record<string, string>) },
	})
	noteMinimumCliVersion(res)
	if (!res.ok) throw await readError(res, path)
	const body = (await res.json()) as T
	absolutizeLinks(body, resolveApiUrl())
	return body
}

export interface CliTokenResult {
	apiKey: string
	account?: string | null
}

/** PKCE token exchange for `login`: trade the loopback `code` + verifier for a key. */
export async function exchangeCliToken(
	code: string,
	codeVerifier: string,
): Promise<CliTokenResult> {
	return requestJson<CliTokenResult>("/api/cli/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code, code_verifier: codeVerifier }),
	})
}

/**
 * How much of a result set this caller can actually use (mirrors the server's
 * `EntitlementMeta` — src/lib/entitlementMeta.ts; keep in sync). Every list
 * endpoint carries it, so an agent can tell its user "20 of these you can use,
 * 60 more with Pro" before it collects a 403 from an export route.
 */
export interface EntitlementMeta {
	/** Records carried by THIS response (one page of `total`). */
	count: number
	/** Records in the caller's whole result set, before paging. */
	total: number
	/** Of `total`, how many this caller may pull in full. */
	accessible: number
	/** Omitted entirely when the caller can reach everything. */
	gated?: {
		count: number
		reason: string
		unlock: { url: string; cli: string }
	}
}

/** Entitlement counts plus the pagination envelope, for a page of kits. */
export interface KitListMeta extends EntitlementMeta {
	limit: number
	offset: number
	/** The ordering the server APPLIED, which is not always the one asked for:
	 *  `fit` without a `use` lane is silently downgraded to `featured`. */
	sort?: string
	hasMore: boolean
	nextOffset: number | null
	formats?: string[]
}

/** One page of the catalog. Pass `offset` (and optional `limit`) to page.
 *  `use` narrows to authored use-case fits and ranks them by measured fitness;
 *  `q` is ranked, synonym-aware discovery search. */
export async function listKits(
	opts: {
		limit?: number
		offset?: number
		sort?: "featured" | "popular" | "recent" | "name" | "fit"
		q?: string
		use?: KitUseCase
		mood?: string[]
		industry?: string[]
	} = {},
): Promise<{ data: KitSummary[]; meta: KitListMeta }> {
	const qs = new URLSearchParams()
	if (opts.limit != null) qs.set("limit", String(opts.limit))
	if (opts.offset != null) qs.set("offset", String(opts.offset))
	if (opts.sort) qs.set("sort", opts.sort)
	if (opts.q) qs.set("q", opts.q)
	if (opts.use) qs.set("use", opts.use)
	if (opts.mood?.length) qs.set("mood", opts.mood.join(","))
	if (opts.industry?.length) qs.set("industry", opts.industry.join(","))
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson<{ data: KitSummary[]; meta: KitListMeta }>(
		`/api/v1/kits${suffix}`,
	)
}

/** Page through the entire catalog — for human listings that want everything. */
export async function listAllKits(): Promise<KitSummary[]> {
	const all: KitSummary[] = []
	let offset = 0
	// Defensive bound; the catalog is small and pages are large.
	for (let i = 0; i < 100; i++) {
		const { data, meta } = await listKits({ limit: 50, offset })
		all.push(...data)
		if (!meta.hasMore || data.length === 0) break
		offset = meta.nextOffset ?? offset + data.length
	}
	return all
}

/**
 * The full published catalog as vibe-rich summaries for the agent to rank
 * against `prompt`. No server-side keyword matching — the prompt is carried for
 * the caller's context only. Returns every kit (neutral curated order).
 */
export async function resolveKits(
	prompt: string,
): Promise<{ data: ResolveMatch[]; meta: EntitlementMeta }> {
	return requestJson<{ data: ResolveMatch[]; meta: EntitlementMeta }>(
		"/api/v1/kits/resolve",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt }),
		},
	)
}

export async function similarKits(
	slug: string,
	limit = 4,
): Promise<{ data: SimilarMatch[]; meta: EntitlementMeta }> {
	return requestJson<{ data: SimilarMatch[]; meta: EntitlementMeta }>(
		`/api/v1/kits/${encodeURIComponent(slug)}/similar?limit=${limit}`,
	)
}

/** Rank kits by how closely their palette matches the given brand colors. */
export async function matchPalette(
	colors: string[],
	limit = 4,
): Promise<{ data: PaletteMatch[]; meta: EntitlementMeta }> {
	return requestJson<{ data: PaletteMatch[]; meta: EntitlementMeta }>(
		"/api/v1/kits/match",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ colors, limit }),
		},
	)
}

/**
 * A `Content-Disposition` filename is server-controlled input that both writers
 * turn into a path, and `IDENTITYFORGE_API_URL` is overridable by env and by
 * config file, so the API base is not necessarily ours. Anything that is not a
 * plain single-segment name is untrustworthy: no separator, no `.`/`..`, no
 * control bytes or NUL. The write path enforces containment as well; this is
 * the first wall, not the only one.
 */
export function isSafeExportFilename(name: string): boolean {
	return (
		name.length > 0 &&
		name !== "." &&
		name !== ".." &&
		!name.includes("/") &&
		!name.includes("\\") &&
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control bytes are exactly what this predicate exists to keep out of a path
		!/[\u0000-\u001f\u007f]/.test(name)
	)
}

export function filenameFromDisposition(
	header: string | null,
	slug: string,
	format: ExportFormat | CollectionExportFormat,
): string {
	const match = header?.match(/filename="?([^"]+)"?/i)
	const proposed = match?.[1]?.trim()
	// A hostile or misconfigured base must not choose where we write. Fall back
	// to the slug-derived default rather than trusting an unusable name.
	if (proposed && isSafeExportFilename(proposed)) return proposed
	const ext =
		format === "design-md" || format === "markdown"
			? "md"
			: format === "css" || format === "tailwind-v4"
				? "css"
				: format === "tailwind-v3"
					? "js"
					: "json"
	return `${slug}.${ext}`
}

export interface KitDetail {
	/** The full kit payload. */
	kit: Record<string, unknown>
	links: { exports: string; registry: string; page: string }
	/**
	 * OPAQUE concurrency marker for `expectedUpdatedAt`, or null for a curated
	 * static kit, which has no row and cannot be patched.
	 *
	 * Never parse this. It crosses the wire as a raw Postgres timestamp rather
	 * than ISO-8601 and the guard compares STRINGS, so a client that parses it
	 * to a Date and serialises back never matches and 409s forever. Parsing also
	 * drops the microseconds, so a normalising comparison could falsely match
	 * and let a stale write through. Echo it back byte for byte.
	 */
	updatedAt: string | null
}

/**
 * Read one kit whole, by permanent id or slug, without writing anything. This
 * is also the only place to obtain the stale-write marker before a FIRST edit:
 * every other source is a previous PATCH response or a 409 body.
 */
export async function getKit(identifier: string): Promise<KitDetail> {
	const json = await requestJson<{
		data: Record<string, unknown>
		links: KitDetail["links"]
		meta?: { updatedAt?: string | null }
	}>(`/api/v1/kits/${encodeURIComponent(identifier)}`)
	return {
		kit: json.data,
		links: json.links,
		updatedAt: json.meta?.updatedAt ?? null,
	}
}

export async function exportKit(
	slug: string,
	format: ExportFormat,
	params?: Record<string, string | undefined>,
): Promise<ExportResult> {
	const qs = new URLSearchParams({ format })
	for (const [key, value] of Object.entries(params ?? {})) {
		if (value) qs.set(key, value)
	}
	const path = `/api/v1/kits/${encodeURIComponent(
		slug,
	)}/export?${qs.toString()}`
	const res = await fetch(`${resolveApiUrl()}${path}`, {
		headers: authHeaders(),
	})
	noteMinimumCliVersion(res)
	if (!res.ok) throw await readError(res, path)
	return {
		body: await res.text(),
		filename: filenameFromDisposition(
			res.headers.get("content-disposition"),
			slug,
			format,
		),
		contentType: res.headers.get("content-type") ?? "text/plain",
	}
}

export type ImplementationOutcome =
	| {
			outcome: "files_written"
			tokensFormat:
				| "dtcg"
				| "css"
				| "tailwind-v3"
				| "tailwind-v4"
				| "shadcn-registry"
			artifactCount: number
			unchangedCount: number
			overwrittenCount: number
	  }
	| {
			outcome: "artifacts_current"
			tokensFormat:
				| "dtcg"
				| "css"
				| "tailwind-v3"
				| "tailwind-v4"
				| "shadcn-registry"
			artifactCount: number
	  }
	| { outcome: "refused"; reason: "conflict"; conflictCount: number }
	| {
			outcome: "failed"
			stage: "fetch" | "plan" | "write"
			reason: "network" | "api" | "invalid_artifact" | "filesystem" | "unknown"
			artifactCount: number
	  }

/**
 * Record the bounded local result without sending paths, filenames, file
 * contents, or exception prose. Analytics remains best-effort and cannot
 * change the command's result.
 */
export async function recordImplementationOutcome(
	identifier: string,
	outcome: ImplementationOutcome,
): Promise<void> {
	if (process.env.IDENTITYFORGE_TELEMETRY === "0") return
	try {
		await fetch(
			`${resolveApiUrl()}/api/v1/kits/${encodeURIComponent(
				identifier,
			)}/implementation-outcome`,
			{
				method: "POST",
				headers: { ...authHeaders(), "Content-Type": "application/json" },
				body: JSON.stringify(outcome),
				signal: AbortSignal.timeout(1_000),
			},
		)
	} catch {
		// Best-effort telemetry. The command result is already known locally.
	}
}

/** Google Fonts' own five categories, which is what the `fonts` table stores. */
export const FONT_CATEGORIES = [
	"sans-serif",
	"serif",
	"display",
	"monospace",
	"handwriting",
] as const
export type FontCategory = (typeof FONT_CATEGORIES)[number]

export interface FontSummary {
	id: string
	name: string
	family: string
	category: string | null
	designer: string | null
	popularityRank: number | null
	weights: number[]
	license: string | null
}

export interface FontListMeta {
	count: number
	total: number
	page: number
	pageSize: number
	hasMore: boolean
	nextPage: number | null
}

export async function listFonts(
	opts: {
		search?: string
		category?: string
		page?: number
		pageSize?: number
	} = {},
): Promise<{ data: FontSummary[]; meta: FontListMeta }> {
	const qs = new URLSearchParams()
	if (opts.search) qs.set("search", opts.search)
	if (opts.category) qs.set("category", opts.category)
	if (opts.page != null) qs.set("page", String(opts.page))
	if (opts.pageSize != null) qs.set("pageSize", String(opts.pageSize))
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson<{ data: FontSummary[]; meta: FontListMeta }>(
		`/api/v1/fonts${suffix}`,
	)
}

export interface SimilarFont
	extends Omit<FontSummary, "weights" | "designer" | "license"> {
	score: number
	/** Which signals put this font on the list, in plain words. */
	why: string
}

/** The id is a slug of the family, and the endpoint accepts either spelling. */
export async function similarFonts(
	identifier: string,
	limit?: number,
): Promise<{
	base: string
	data: SimilarFont[]
	meta: { limit: number; basis: string }
}> {
	const suffix = limit == null ? "" : `?limit=${limit}`
	return requestJson(
		`/api/v1/fonts/${encodeURIComponent(identifier)}/similar${suffix}`,
	)
}

export interface CuratedPairing {
	heading: string
	body: string
	mono?: string
	label?: string
}

export interface PairingsForFamily {
	family: string
	curated: CuratedPairing[]
	suggested: { heading: string; body: string; why: string }[]
}

export async function fontPairings(opts: {
	family?: string
	role?: "heading" | "body"
}): Promise<{
	data: CuratedPairing[] | PairingsForFamily
	meta: Record<string, unknown>
}> {
	const qs = new URLSearchParams()
	if (opts.family) qs.set("family", opts.family)
	if (opts.role) qs.set("role", opts.role)
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson(`/api/v1/font-pairings${suffix}`)
}

export async function listImageDirections(
	opts: {
		q?: string
		use?: ImageDirectionPurpose
		family?: ImageDirectionFamily[]
		tier?: CollectionTier[]
		sort?: CollectionSort
	} = {},
): Promise<{ data: ImageDirectionSummary[]; meta: EntitlementMeta }> {
	const qs = new URLSearchParams()
	if (opts.q) qs.set("q", opts.q)
	if (opts.use) qs.set("use", opts.use)
	if (opts.family?.length) qs.set("family", opts.family.join(","))
	if (opts.tier?.length) qs.set("tier", opts.tier.join(","))
	if (opts.sort) qs.set("sort", opts.sort)
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson<{ data: ImageDirectionSummary[]; meta: EntitlementMeta }>(
		`/api/v1/image-directions${suffix}`,
	)
}

export async function getImageDirection(
	slug: string,
	format: CollectionExportFormat = "markdown",
): Promise<ExportResult> {
	const path = `/api/v1/image-directions/${encodeURIComponent(
		slug,
	)}/export?format=${format}`
	const res = await fetch(`${resolveApiUrl()}${path}`, {
		headers: authHeaders(),
	})
	noteMinimumCliVersion(res)
	if (!res.ok) throw await readError(res, path)
	return {
		body: await res.text(),
		filename: filenameFromDisposition(
			res.headers.get("content-disposition"),
			slug,
			format,
		),
		contentType: res.headers.get("content-type") ?? "text/plain",
	}
}

export async function listPageRecipes(
	opts: {
		q?: string
		goal?: PageRecipeGoal
		tier?: CollectionTier[]
		sort?: CollectionSort
	} = {},
): Promise<{ data: PageRecipeSummary[]; meta: EntitlementMeta }> {
	const qs = new URLSearchParams()
	if (opts.q) qs.set("q", opts.q)
	if (opts.goal) qs.set("goal", opts.goal)
	if (opts.tier?.length) qs.set("tier", opts.tier.join(","))
	if (opts.sort) qs.set("sort", opts.sort)
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson<{ data: PageRecipeSummary[]; meta: EntitlementMeta }>(
		`/api/v1/page-recipes${suffix}`,
	)
}

export async function getPageRecipe(
	slug: string,
	format: CollectionExportFormat = "markdown",
): Promise<ExportResult> {
	const path = `/api/v1/page-recipes/${encodeURIComponent(
		slug,
	)}/export?format=${format}`
	const res = await fetch(`${resolveApiUrl()}${path}`, {
		headers: authHeaders(),
	})
	noteMinimumCliVersion(res)
	if (!res.ok) throw await readError(res, path)
	return {
		body: await res.text(),
		filename: filenameFromDisposition(
			res.headers.get("content-disposition"),
			slug,
			format,
		),
		contentType: res.headers.get("content-type") ?? "text/plain",
	}
}

export async function listInterfaceStyles(
	opts: {
		q?: string
		use?: KitUseCase
		family?: InterfaceStyleFamily[]
		tier?: CollectionTier[]
		sort?: CollectionSort
	} = {},
): Promise<{ data: InterfaceStyleSummary[]; meta: EntitlementMeta }> {
	const qs = new URLSearchParams()
	if (opts.q) qs.set("q", opts.q)
	if (opts.use) qs.set("use", opts.use)
	if (opts.family?.length) qs.set("family", opts.family.join(","))
	if (opts.tier?.length) qs.set("tier", opts.tier.join(","))
	if (opts.sort) qs.set("sort", opts.sort)
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson<{ data: InterfaceStyleSummary[]; meta: EntitlementMeta }>(
		`/api/v1/interface-styles${suffix}`,
	)
}

export async function getInterfaceStyle(
	slug: string,
	format: CollectionExportFormat = "markdown",
): Promise<ExportResult> {
	const path = `/api/v1/interface-styles/${encodeURIComponent(
		slug,
	)}/export?format=${format}`
	const res = await fetch(`${resolveApiUrl()}${path}`, {
		headers: authHeaders(),
	})
	noteMinimumCliVersion(res)
	if (!res.ok) throw await readError(res, path)
	return {
		body: await res.text(),
		filename: filenameFromDisposition(
			res.headers.get("content-disposition"),
			slug,
			format,
		),
		contentType: res.headers.get("content-type") ?? "text/plain",
	}
}

export async function listNamingRecipes(): Promise<NamingRecipe[]> {
	const json = await requestJson<{ data: NamingRecipe[] }>(
		"/api/v1/naming/recipes",
	)
	return json.data
}

export async function listNamingProjects(
	opts: {
		limit?: number
		offset?: number
	} = {},
): Promise<NamingProject[]> {
	const qs = new URLSearchParams()
	if (opts.limit != null) qs.set("limit", String(opts.limit))
	if (opts.offset != null) qs.set("offset", String(opts.offset))
	const suffix = qs.size ? `?${qs.toString()}` : ""
	const json = await requestJson<{ data: NamingProject[] }>(
		`/api/v1/naming/projects${suffix}`,
	)
	return json.data
}

export async function createNamingProject(input: {
	name: string
	description?: string
	selectedTlds?: string[]
}): Promise<NamingProject> {
	const json = await requestJson<{ data: NamingProject }>(
		"/api/v1/naming/projects",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
	)
	return json.data
}

export async function listNamingCandidates(input: {
	projectId: string
	statuses?: NamingCandidateStatus[]
	limit?: number
	offset?: number
}): Promise<NamingCandidate[]> {
	const qs = new URLSearchParams()
	for (const status of input.statuses ?? []) qs.append("status", status)
	if (input.limit != null) qs.set("limit", String(input.limit))
	if (input.offset != null) qs.set("offset", String(input.offset))
	const suffix = qs.size ? `?${qs.toString()}` : ""
	const json = await requestJson<{ data: NamingCandidate[] }>(
		`/api/v1/naming/projects/${encodeURIComponent(
			input.projectId,
		)}/candidates${suffix}`,
	)
	return json.data
}

export async function addNamingCandidates(input: {
	projectId: string
	candidates: NamingCandidateCreateInput[]
}): Promise<NamingCandidate[]> {
	const json = await requestJson<{ data: NamingCandidate[] }>(
		`/api/v1/naming/projects/${encodeURIComponent(input.projectId)}/candidates`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ candidates: input.candidates }),
		},
	)
	return json.data
}

export async function listNamingGenerations(input: {
	projectId: string
	limit?: number
	offset?: number
}): Promise<NamingGeneration[]> {
	const qs = new URLSearchParams()
	if (input.limit != null) qs.set("limit", String(input.limit))
	if (input.offset != null) qs.set("offset", String(input.offset))
	const suffix = qs.size ? `?${qs.toString()}` : ""
	const json = await requestJson<{ data: NamingGeneration[] }>(
		`/api/v1/naming/projects/${encodeURIComponent(
			input.projectId,
		)}/generations${suffix}`,
	)
	return json.data
}

export async function generateNamingCandidates(input: {
	projectId: string
	description: string
	count?: number
	recipeIds: string[]
	frequencyPenalty?: number
	styleOptions?: Record<string, unknown>
	idempotencyKey?: string
}): Promise<{
	generation: NamingGeneration
	candidates: NamingCandidate[]
	partial: boolean
	remainingCount: number
	replayed: boolean
}> {
	const { projectId, ...body } = input
	const json = await requestJson<{
		data: {
			generation: NamingGeneration
			candidates: NamingCandidate[]
			partial: boolean
			remainingCount: number
			replayed: boolean
		}
	}>(`/api/v1/naming/projects/${encodeURIComponent(projectId)}/generations`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(input.idempotencyKey
				? { "Idempotency-Key": input.idempotencyKey }
				: {}),
		},
		body: JSON.stringify(body),
	})
	return json.data
}

export async function patchNamingCandidates(input: {
	projectId: string
	operations: Array<{
		candidateId: string
		status?: NamingCandidateStatus
		rank?: number | null
		notes?: string | null
		evidence?: Record<string, unknown>
		expectedUpdatedAt?: string
	}>
}): Promise<NamingCandidate[]> {
	const json = await requestJson<{ data: NamingCandidate[] }>(
		`/api/v1/naming/projects/${encodeURIComponent(input.projectId)}/candidates`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ operations: input.operations }),
		},
	)
	return json.data
}

export async function checkDomains(input: {
	domains: string[]
	includeSerp?: boolean
	includeRegistrar?: boolean
	acquisitionIntent?: "new_registration" | "aftermarket" | "either"
	market?: string
	language?: string
}): Promise<DomainCheckBatch> {
	return requestJson<DomainCheckBatch>("/api/v1/domains/check", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	})
}

export async function getNamingResearchContext(
	projectId: string,
): Promise<NamingResearchContext> {
	const json = await requestJson<{ data: NamingResearchContext }>(
		`/api/v1/naming/projects/${encodeURIComponent(projectId)}/research-context`,
	)
	return json.data
}

export async function searchNameEvidence(input: {
	tasks: NameResearchTask[]
}): Promise<{ data: NameSearchResult[]; meta: Record<string, unknown> }> {
	return requestJson("/api/v1/naming/research/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	})
}

export interface TrademarkSearchInput {
	projectId: string
	nameSuggestionId: string
	query: string
	niceClasses?: string[]
}

export async function searchTrademarks(
	input: TrademarkSearchInput,
): Promise<Record<string, unknown>> {
	return requestJson("/api/v1/naming/trademarks/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	})
}

// ── Brand authoring (kits:write) ──────────────────────────────────────────────

/** Mix-and-match overrides: the same knobs the Studio exposes. Token roles use
 *  the 28 shadcn semantic names; facet groups are shape/elevation/typeVoice/
 *  motion/density and each takes a named preset id. */
export interface KitOverridesInput {
	tokens?: {
		light?: Record<string, string>
		dark?: Record<string, string>
	}
	colors?: Record<string, string>
	fonts?: {
		heading?: { family: string; name?: string }
		body?: { family: string; name?: string }
		mono?: { family: string; name?: string }
	}
	facets?: Record<string, string>
}

export interface CreatedKit {
	/** Permanent opaque id. The durable handle: unlike the slug it never moves
	 *  and is never reassigned, so store this and address the kit by it. */
	id: string
	slug: string
	name: string
	tier: "free" | "pro"
	visibility: string
	baseSlug: string | null
	links: {
		/** Where the person opens it: the Studio, because a saved kit starts
		 *  private and the public /kits page does not resolve until it is
		 *  published. */
		page: string
		/** The machine read of the same kit. */
		self: string
		designMd: string
		registry: string
		/**  Repeats `page`. The server still sends it so older CLI
		 *  builds keep printing a Studio line; read `page`. */
		studio?: string
	}
	/** Overrides that were skipped (unknown role / bad hex / unknown preset). */
	warnings?: string[]
}

/** Create a private design kit from scratch or by forking a catalog kit. */
export async function createTheme(input: {
	name: string
	base?: string
	kit?: Record<string, unknown>
	overrides?: KitOverridesInput
}): Promise<CreatedKit> {
	const json = await requestJson<{ data: CreatedKit }>("/api/v1/kits", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	})
	return json.data
}

/** Duplicate a resolvable kit into a new private kit with overrides applied. */
export async function remixTheme(input: {
	slug: string
	name?: string
	overrides: KitOverridesInput
}): Promise<CreatedKit> {
	const { slug, ...body } = input
	const json = await requestJson<{ data: CreatedKit }>(
		`/api/v1/kits/${encodeURIComponent(slug)}/remix`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	)
	return json.data
}

export interface UpdatedKit {
	id: string
	slug: string
	name: string
	tier: "free" | "pro"
	/** Concurrency marker: pass it back as `expectedUpdatedAt` on the next edit. */
	updatedAt: string | null
	links: {
		/** Where the person opens it: the Studio, because a saved kit starts
		 *  private and the public /kits page does not resolve until it is
		 *  published. */
		page: string
		/** The machine read of the same kit. */
		self: string
		designMd: string
		registry: string
		/**  Repeats `page`. The server still sends it so older CLI
		 *  builds keep printing a Studio line; read `page`. */
		studio?: string
	}
	/** Overrides that were skipped (unknown role / bad hex / unknown preset). */
	warnings?: string[]
}

/** Update a kit the caller already saved, in place: same slug, same id, same
 *  publication state, so everything already pointing at it follows the edit.
 *  `slug` accepts a permanent kit id too, matching the read on the same path. */
export async function updateTheme(input: {
	slug: string
	name?: string
	kit?: Record<string, unknown>
	overrides?: KitOverridesInput
	expectedUpdatedAt?: string
}): Promise<UpdatedKit> {
	const { slug, ...body } = input
	const json = await requestJson<{ data: UpdatedKit }>(
		`/api/v1/kits/${encodeURIComponent(slug)}`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	)
	return json.data
}

export async function deleteTheme(identifier: string): Promise<{
	slug: string
	deleted: true
	savedCount: number
	savedLimit: number | null
}> {
	const json = await requestJson<{
		data: { slug: string; deleted: true }
		meta: { savedCount: number; savedLimit: number | null }
	}>(`/api/v1/kits/${encodeURIComponent(identifier)}`, { method: "DELETE" })
	return { ...json.data, ...json.meta }
}

export interface BrandProject {
	project_id: string
	name: string
	brief?: string | null
	variationCount?: number
}

export async function createBrandProject(input: {
	name: string
	brief?: string
}): Promise<BrandProject> {
	const json = await requestJson<{ data: BrandProject }>(
		"/api/v1/brand-projects",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
	)
	return json.data
}

export async function listBrandProjects(): Promise<BrandProject[]> {
	const json = await requestJson<{ data: BrandProject[] }>(
		"/api/v1/brand-projects",
	)
	return json.data
}

/** One board with everything on it. `share` is null when none was ever made;
 *  a revoked one reports `enabled: false` rather than disappearing, because
 *  "was shared and withdrawn" and "never shared" are different facts. */
export interface BrandProjectDetail {
	projectId: string
	name: string
	brief: string | null
	variations: unknown[]
	share: BrandShareState | null
	links: Record<string, string | undefined>
}

export async function getBrandProject(
	projectId: string,
): Promise<{ data: BrandProjectDetail; meta: Record<string, unknown> }> {
	return await requestJson<{
		data: BrandProjectDetail
		meta: Record<string, unknown>
	}>(`/api/v1/brand-projects/${encodeURIComponent(projectId)}`)
}

export interface BrandVariationResult {
	id: string
	project_id: string
	kit_slug: string
	brand_name: string | null
	domain: string | null
	label: string | null
	notes: string
	position: number
}

export async function addBrandVariation(input: {
	projectId: string
	kitSlug: string
	brandName?: string
	domain?: string
	label?: string
	notes?: string
}): Promise<BrandVariationResult> {
	const { projectId, ...body } = input
	const json = await requestJson<{ data: BrandVariationResult }>(
		`/api/v1/brand-projects/${encodeURIComponent(projectId)}/variations`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	)
	return json.data
}

/** Edit one saved variation. Only the fields present move; `null` clears an
 *  optional field rather than leaving it as it was. */
export async function updateBrandVariation(input: {
	projectId: string
	variationId: string
	kitSlug?: string
	brandName?: string | null
	domain?: string | null
	label?: string | null
	notes?: string | null
}): Promise<BrandVariationResult> {
	const { projectId, variationId, ...body } = input
	const json = await requestJson<{ data: BrandVariationResult }>(
		`/api/v1/brand-projects/${encodeURIComponent(
			projectId,
		)}/variations/${encodeURIComponent(variationId)}`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	)
	return json.data
}

/** Permanently remove one variation from a project. */
export async function deleteBrandVariation(input: {
	projectId: string
	variationId: string
}): Promise<{ id: string; projectId: string; deleted: boolean }> {
	const json = await requestJson<{
		data: { id: string; projectId: string; deleted: boolean }
	}>(
		`/api/v1/brand-projects/${encodeURIComponent(
			input.projectId,
		)}/variations/${encodeURIComponent(input.variationId)}`,
		{ method: "DELETE" },
	)
	return json.data
}

/** Set the order the client sees. `variationIds` must list every variation in
 *  the project exactly once; the server rejects a partial list. */
export async function reorderBrandVariations(input: {
	projectId: string
	variationIds: string[]
}): Promise<BrandVariationResult[]> {
	const json = await requestJson<{ data: BrandVariationResult[] }>(
		`/api/v1/brand-projects/${encodeURIComponent(
			input.projectId,
		)}/variations/reorder`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ variationIds: input.variationIds }),
		},
	)
	return json.data
}

export interface BrandProjectComment {
	id: string
	variation_id: string
	body: string
	author_name: string
	created_at: string
}

/** Client feedback left on a project's variations through its share link,
 *  oldest first. The return leg of the share loop. */
export async function listBrandProjectComments(
	projectId: string,
): Promise<BrandProjectComment[]> {
	const json = await requestJson<{ data: BrandProjectComment[] }>(
		`/api/v1/brand-projects/${encodeURIComponent(projectId)}/comments`,
	)
	return json.data
}

export interface MockupJob {
	id: string
	status: "queued" | "running" | "done" | "partial" | "failed"
	creditsCharged: number
	total: number
	completed: number
	results: Array<{
		variationId: string
		templateId: string
		sceneId: string
		bucketPath: string
		url: string | null
	}>
	error: string | null
	createdAt: string
	links: { page?: string; self: string }
}

export async function generateMockups(input: {
	projectId: string
	variationIds: string[]
	items: Array<{ templateId: string; sceneId: string }>
	idempotencyKey?: string
}): Promise<{ id: string; status: "queued"; pollingUrl: string }> {
	const { projectId, idempotencyKey, ...body } = input
	const json = await requestJson<{
		data: { id: string; status: "queued"; pollingUrl: string }
	}>(`/api/v1/brand-projects/${encodeURIComponent(projectId)}/mockups`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
		},
		body: JSON.stringify(body),
	})
	return json.data
}

export async function listMockupJobs(projectId: string): Promise<MockupJob[]> {
	const json = await requestJson<{ data: MockupJob[] }>(
		`/api/v1/brand-projects/${encodeURIComponent(projectId)}/mockups`,
	)
	return json.data
}

export async function getMockupJob(
	projectId: string,
	jobId: string,
): Promise<MockupJob> {
	const json = await requestJson<{ data: MockupJob }>(
		`/api/v1/brand-projects/${encodeURIComponent(
			projectId,
		)}/mockups/${encodeURIComponent(jobId)}`,
	)
	return json.data
}

export interface BrandShareResult {
	url: string
	token: string
	enabled: boolean
	hasPassword: boolean
}

/** The full state of a share, as the read and the edit both return it. The
 *  password itself never leaves the server, only whether one is set. */
export interface BrandShareState extends BrandShareResult {
	viewCount: number
	createdAt: string | null
	revokedAt: string | null
}

/** Change an existing share WITHOUT reissuing its URL. `password: null` clears
 *  the protection; omitting it leaves whatever is set alone. 404 when the
 *  project has no share yet — create one with shareBrandProject first. */
export async function updateBrandShare(input: {
	projectId: string
	enabled?: boolean
	password?: string | null
}): Promise<BrandShareState> {
	const { projectId, ...body } = input
	const json = await requestJson<{ data: BrandShareState }>(
		`/api/v1/brand-projects/${encodeURIComponent(projectId)}/share`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	)
	return json.data
}

/** Revoke the share: the /p/<token> URL stops resolving wherever it was pasted.
 *  Not undoable — a later share mints a NEW token, deliberately never the old
 *  one, so a withdrawn link can not come back to life. */
export async function revokeBrandShare(
	projectId: string,
): Promise<BrandShareState & { revoked: true }> {
	const json = await requestJson<{ data: BrandShareState & { revoked: true } }>(
		`/api/v1/brand-projects/${encodeURIComponent(projectId)}/share`,
		{ method: "DELETE" },
	)
	return json.data
}

export async function shareBrandProject(input: {
	projectId: string
	password?: string
	rotate?: boolean
}): Promise<BrandShareResult> {
	const { projectId, ...body } = input
	const json = await requestJson<{ data: BrandShareResult }>(
		`/api/v1/brand-projects/${encodeURIComponent(projectId)}/share`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	)
	return json.data
}

/* ── Versions ─────────────────────────────────────────────────────────────── */

/** One row of a version timeline. Metadata only: no snapshot, no token values.
 *  `label` is null for a caller not entitled to the kit, because it is authored
 *  free text that can restate a gated value. */
export interface VersionEntry {
	version: number
	contentHash: string
	actor: { type: string; label: string }
	label: string | null
	origin: string | null
	operationId: string | null
	createdAt: string
}

export interface VersionListMeta {
	count: number
	/** Present only when the caller is not entitled to the subject. */
	gated?: { count: number; unlock: { url: string } }
	subject: { type: string; id: string; slug?: string }
	/** The subject's latest version. `0` means nothing has been minted yet —
	 *  a real state, not a missing value. */
	currentVersion: number
	hasMore: boolean
	/** Cursor for the next page, or null at the end of the timeline. */
	nextBefore: number | null
}

/** A single change inside a diff. An unentitled caller gets `redacted: true`
 *  with `from`/`to` absent: the fact that something moved, never the values. */
export interface VersionChange {
	path: string
	kind: string
	op: "added" | "removed" | "changed"
	from?: unknown
	to?: unknown
	cssVar?: string
	deltaE?: number
	note?: string
	redacted?: true
}

export interface VersionDiff {
	subjectType: string
	subjectId: string
	/** Null when `to` is the first version, i.e. the subject was created. */
	from: number | null
	to: number
	changes: VersionChange[]
	counts: Record<string, number>
	/** Mechanical, e.g. "9 changes: 6 token, 2 typography, 1 layer". */
	summary: string
	/** Present only when values were withheld for entitlement. */
	redactedChanges?: number
}

export interface VersionSnapshot {
	version: number
	contentHash: string
	snapshot: Record<string, unknown>
}

function versionPageQuery(opts: { limit?: number; before?: number }): string {
	const qs = new URLSearchParams()
	if (opts.limit != null) qs.set("limit", String(opts.limit))
	if (opts.before != null) qs.set("before", String(opts.before))
	return qs.toString() ? `?${qs.toString()}` : ""
}

/** The kit's version timeline, newest first. Addressed by permanent id or slug,
 *  like every other read on that path. */
export async function listKitVersions(
	identifier: string,
	opts: { limit?: number; before?: number } = {},
): Promise<{ data: VersionEntry[]; meta: VersionListMeta }> {
	return requestJson<{ data: VersionEntry[]; meta: VersionListMeta }>(
		`/api/v1/kits/${encodeURIComponent(identifier)}/versions${versionPageQuery(
			opts,
		)}`,
	)
}

/** One stored version of a kit, as the full snapshot it recorded. Gated exactly
 *  like /export: a Pro kit without an entitled key answers 403, not a redaction. */
export async function getKitVersion(
	identifier: string,
	version: number,
): Promise<VersionSnapshot> {
	const json = await requestJson<{ data: VersionSnapshot }>(
		`/api/v1/kits/${encodeURIComponent(identifier)}/versions/${version}`,
	)
	return json.data
}

/** What changed between two versions of a kit. `from` alone compares against
 *  the current version, which is the question a consuming repo actually asks. */
export async function diffKitVersions(
	identifier: string,
	range: { from: number; to?: number },
): Promise<{ data: VersionDiff; meta: { toIsCurrent: boolean } }> {
	const qs = new URLSearchParams()
	qs.set("from", String(range.from))
	if (range.to != null) qs.set("to", String(range.to))
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson<{ data: VersionDiff; meta: { toIsCurrent: boolean } }>(
		`/api/v1/kits/${encodeURIComponent(identifier)}/versions/diff${suffix}`,
	)
}

/**
 * One line in the kit's history ledger. NOT a version: `eventType` takes
 * `create`, `save` and `apply-to-brand`, and only the first two mint a version,
 * so an apply appears here and nowhere else.
 */
export interface KitHistoryEntry {
	id: string
	eventType: "create" | "save" | "apply-to-brand"
	/** The author's note, or null on an event that carries none. */
	label: string | null
	createdAt: string
	/** Absolute URL of this entry's snapshot. Predates the `links` vocabulary
	 *  and is kept alongside it rather than renamed. */
	snapshot: string
}

export interface KitHistoryMeta {
	count: number
	/** Opaque. Hand it back unchanged; it is not a number to compute with. */
	nextCursor: string | null
	slug: string
}

/**
 * The kit's history ledger, newest first, which is a wider record than the
 * version timeline: every save, the creation, AND every time the kit was
 * applied to a brand. `listKitVersions` cannot answer "when was this used",
 * because applying mints no version.
 *
 * Cursor-paginated rather than numbered, because events have no ordinal: two
 * in the same millisecond still order deterministically on (created_at, id).
 * Only your own saved kits have a reachable ledger; anything else is 404.
 */
export async function listKitHistory(
	identifier: string,
	opts: { limit?: number; cursor?: string } = {},
): Promise<{ data: KitHistoryEntry[]; meta: KitHistoryMeta }> {
	const qs = new URLSearchParams()
	if (opts.limit != null) qs.set("limit", String(opts.limit))
	if (opts.cursor) qs.set("cursor", opts.cursor)
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson<{ data: KitHistoryEntry[]; meta: KitHistoryMeta }>(
		`/api/v1/kits/${encodeURIComponent(identifier)}/history${suffix}`,
	)
}

/**
 * The full kit as it stood at one history entry: the payload behind a line in
 * the ledger, so a past state can be diffed against the current kit or PATCHed
 * back to restore it.
 *
 * Knowing an event id is never sufficient — the event must be yours and on a
 * kit you still own, and either test failing is a 404.
 */
export async function getKitHistorySnapshot(
	identifier: string,
	eventId: string,
): Promise<Record<string, unknown>> {
	const json = await requestJson<{ data: Record<string, unknown> }>(
		`/api/v1/kits/${encodeURIComponent(
			identifier,
		)}/history/${encodeURIComponent(eventId)}`,
	)
	return json.data
}

/** The brand project's version timeline, newest first. Owner-scoped, so a
 *  project you do not own answers 404 exactly as a missing one does. */
export async function listBrandProjectVersions(
	projectId: string,
	opts: { limit?: number; before?: number } = {},
): Promise<{ data: VersionEntry[]; meta: VersionListMeta }> {
	return requestJson<{ data: VersionEntry[]; meta: VersionListMeta }>(
		`/api/v1/brand-projects/${encodeURIComponent(
			projectId,
		)}/versions${versionPageQuery(opts)}`,
	)
}

export async function getBrandProjectVersion(
	projectId: string,
	version: number,
): Promise<VersionSnapshot> {
	const json = await requestJson<{ data: VersionSnapshot }>(
		`/api/v1/brand-projects/${encodeURIComponent(
			projectId,
		)}/versions/${version}`,
	)
	return json.data
}

export async function diffBrandProjectVersions(
	projectId: string,
	range: { from: number; to?: number },
): Promise<{ data: VersionDiff; meta: { toIsCurrent: boolean } }> {
	const qs = new URLSearchParams()
	qs.set("from", String(range.from))
	if (range.to != null) qs.set("to", String(range.to))
	const suffix = qs.toString() ? `?${qs.toString()}` : ""
	return requestJson<{ data: VersionDiff; meta: { toIsCurrent: boolean } }>(
		`/api/v1/brand-projects/${encodeURIComponent(
			projectId,
		)}/versions/diff${suffix}`,
	)
}

/* ── Who am I ─────────────────────────────────────────────────────────────── */

/** What this key can actually do. Free: costs no quota units and no AI credits,
 *  and is never refused for being over quota — so it is safe to call first, and
 *  safe to call when a 429 has already happened. */
export interface Me {
	plan: { tier: "free" | "pro" }
	key: { id: string; label: string | null; createdAt: string | null }
	scopes: {
		granted: string[]
		missing: { id: string; label: string; description: string }[]
		fix?: string
	}
	quota: {
		used: number
		/** null = unmetered key. */
		limit: number | null
		remaining: number | null
		resetsAt: string
	}
	credits: { plan: number; extra: number; total: number; unlimited: boolean }
	kits: {
		saved: number
		/** null = unlimited (Pro). */
		limit: number | null
		remaining: number | null
	}
	links: { page: string }
}

export async function getMe(): Promise<Me> {
	const json = await requestJson<{ data: Me }>("/api/v1/me")
	return json.data
}

/* ── Project context and recommendations ──────────────────────────────────── */

/** One screen the product has. `useCase` is the narrowing key: a kit that
 *  scores below the fit threshold for every surface is factually not a
 *  candidate. `name` and `notes` are prompt and display material. */
export interface ProjectSurface {
	useCase: string
	name: string
	notes?: string
}

/** What the brand has to be built in. Free text on purpose: a stack we do not
 *  recognise must degrade to "the model reads it", not to a 400. */
export interface ProjectStack {
	framework?: string
	styling?: string
	components?: string
	notes?: string
}

/** The durable description of the product being branded. `product` is the only
 *  required field, because a proposal cannot be specific without it. */
export interface ProjectContext {
	product: string
	audience?: string
	constraints?: string
	avoid?: string
	industry?: string
	moods?: string[]
	surfaces?: ProjectSurface[]
	stack?: ProjectStack
}

export interface StoredProjectContext extends ProjectContext {
	projectId: string
	createdAt: string
	updatedAt: string
	links: Record<string, string>
}

/**
 * Read a project's stored context. Needs kits:read.
 *
 * `null` means the project exists and has no context yet, which is a different
 * fact from a project that does not exist — that one 404s.
 */
export async function getProjectContext(
	projectId: string,
): Promise<StoredProjectContext | null> {
	const json = await requestJson<{ data: StoredProjectContext | null }>(
		`/api/v1/brand-projects/${encodeURIComponent(projectId)}/context`,
	)
	return json.data
}

/**
 * REPLACE a project's context. Needs kits:write.
 *
 * PUT, not PATCH, and the distinction is load bearing: nothing is merged, so
 * whatever you omit is gone. Read the current context first and send it back
 * whole with your edit applied.
 */
export async function putProjectContext(
	projectId: string,
	context: ProjectContext,
): Promise<StoredProjectContext> {
	const json = await requestJson<{ data: StoredProjectContext }>(
		`/api/v1/brand-projects/${encodeURIComponent(projectId)}/context`,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(context),
		},
	)
	return json.data
}

export interface RecommendationMeta {
	/** `ranked` when a model ordered them against this product, `candidates`
	 *  when the order is the catalogue's own computed lane fitness. */
	depth: "ranked" | "candidates"
	count: number
	total?: number
	accessible?: number
	gated?: { count: number; unlock: { url: string } }
	order: string
	limit: number
	context: { source: string; projectId?: string; surfaces: number }
	narrowing?: unknown
	ranking?: unknown
}

export interface Recommendation {
	rank: number
	/** Why THIS kit for THIS product. Null at candidates depth, and on any
	 *  candidate the model left unranked. */
	reason: string | null
	fit: { score: number; lane: string; byLane: Record<string, number> }
	evidence: Record<string, unknown>
	kit: Record<string, unknown>
	discovery: Record<string, unknown>
}

/**
 * Kit candidates for a product, grounded in its stored context.
 *
 * Costs 3 quota units and requires a key, unlike every other discovery route.
 */
export async function recommendKits(input: {
	projectId: string
	limit?: number
}): Promise<{ data: Recommendation[]; meta: RecommendationMeta }> {
	return requestJson<{ data: Recommendation[]; meta: RecommendationMeta }>(
		"/api/v1/recommend",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				projectId: input.projectId,
				...(input.limit != null ? { limit: input.limit } : {}),
			}),
		},
	)
}

/* ── Composition: the layers a brand project holds on top of its kit ───────── */

export const COLLECTION_LAYER_AXES = [
	"imageDirection",
	"interfaceStyle",
	"pageRecipe",
] as const
export type CollectionLayerAxis = (typeof COLLECTION_LAYER_AXES)[number]

/**
 * One layer reference as the brand holds it.
 *
 * Both revisions travel: `revision` is what the catalogue serves NOW and
 * `chosenRevision` is what the project pinned. `drift` is present ONLY when they
 * differ, so its presence is the whole signal and an agent does not have to
 * compare numbers to notice. Reading never moves the pin — accepting a drifted
 * revision is a deliberate addBrandLayer call.
 */
export interface BrandLayerReference {
	id: string
	chosenRevision: number | null
	/** False when the record has been withdrawn from the catalogue since it was
	 *  pinned. The reference is still reported: a brand must not quietly forget
	 *  what it points at. */
	resolved: boolean
	slug?: string
	name?: string
	revision?: number
	tier?: CollectionTier
	/** True when this caller may not pull the record's payload. The judgment
	 *  layer still comes back; only the payload is withheld. */
	locked?: boolean
	drift?: { chosen: number; current: number; note?: string }
}

export interface BrandLayersResult {
	projectId: string
	/** `state: "inherited"` means the kit supplies the direction and no record is
	 *  pinned, so there is nothing to drift. */
	imageDirection:
		| ({ state: "set" } & BrandLayerReference)
		| { state: "inherited"; summary: string }
		| null
	interfaceStyle: BrandLayerReference | null
	pageRecipes: BrandLayerReference[]
	links: {
		self: string
		page: string
		project: string
		/** The composition rendered as an image. Absent when the project's kit is
		 *  not publicly servable, because a link that cannot render is worse than
		 *  no link. */
		preview?: string
	}
}

/** What a brand is composed of, with drift. Read-only: mints no version. */
export async function getBrandLayers(input: {
	projectId: string
}): Promise<{ data: BrandLayersResult; meta: { drifted: number } }> {
	return requestJson<{ data: BrandLayersResult; meta: { drifted: number } }>(
		`/api/v1/brand-projects/${encodeURIComponent(input.projectId)}/layers`,
	)
}

export interface ComposedBrandExport extends ExportResult {
	/** How many catalogue layers were written into the document, straight from
	 *  `X-IdentityForge-Composed-Layers`. 0 is a real answer and means the brand
	 *  composes nothing yet, so the body is its kit's DESIGN.md unchanged. */
	layerCount: number
	/** The shape of the composed document, distinct from the kit version below:
	 *  one says how this file is put together, the other says which revision of
	 *  the kit it was put together from. */
	contractVersion: string | null
	/** Which kit it was composed on, so a consuming repo can record what it
	 *  built against without parsing the front matter back out. */
	kitId: string | null
	kitSlug: string | null
	kitVersion: string | null
}

/**
 * The brand as ONE document: its kit's DESIGN.md with every pinned catalogue
 * layer written into it, under the precedence rule that decides which one wins.
 *
 * The alternative is four calls and a merge the caller has to invent, and the
 * caller is the one party that cannot know the answer. Owner-scoped, so unlike
 * every other export here it needs a key that owns the project rather than any
 * valid key.
 */
export async function exportBrandProject(input: {
	projectId: string
}): Promise<ComposedBrandExport> {
	const path = `/api/v1/brand-projects/${encodeURIComponent(
		input.projectId,
	)}/export?format=design-md`
	const res = await fetch(`${resolveApiUrl()}${path}`, {
		headers: authHeaders(),
	})
	noteMinimumCliVersion(res)
	if (!res.ok) throw await readError(res, path)
	const layerCount = Number.parseInt(
		res.headers.get("x-identityforge-composed-layers") ?? "",
		10,
	)
	return {
		body: await res.text(),
		filename: filenameFromDisposition(
			res.headers.get("content-disposition"),
			// The project id, not a slug: a brand has no public handle, and this is
			// only ever a fallback download name.
			input.projectId,
			"design-md",
		),
		contentType: res.headers.get("content-type") ?? "text/markdown",
		// NaN would be a silent lie in a count, so an absent or malformed header
		// reads as 0 layers, which is also what the body would then show.
		layerCount: Number.isFinite(layerCount) ? layerCount : 0,
		contractVersion: res.headers.get(
			"x-identityforge-composed-contract-version",
		),
		kitId: res.headers.get("x-identityforge-kit-id"),
		kitSlug: res.headers.get("x-identityforge-kit-slug"),
		kitVersion: res.headers.get("x-identityforge-kit-version"),
	}
}

export interface BrandLayerPins {
	projectId: string
	imageDirection: { id: string; revision: number | null } | null
	interfaceStyle: { id: string; revision: number | null } | null
	pageRecipes: { id: string; revision: number | null }[]
	links: BrandLayersResult["links"]
}

/** Compose a catalogue record onto the brand, recording the revision current
 *  now so a later read can report drift instead of applying it silently. */
export async function addBrandLayer(input: {
	projectId: string
	axis: CollectionLayerAxis
	recordId: string
	replace?: boolean
}): Promise<{ data: BrandLayerPins; meta: { changed: boolean } }> {
	return requestJson<{ data: BrandLayerPins; meta: { changed: boolean } }>(
		`/api/v1/brand-projects/${encodeURIComponent(input.projectId)}/layers`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				axis: input.axis,
				recordId: input.recordId,
				...(input.replace ? { replace: true } : {}),
			}),
		},
	)
}

/** Take a layer off the brand. Names the record, so a stale caller cannot clear
 *  a layer it never saw; an id that is not pinned answers `changed: false`. */
export async function removeBrandLayer(input: {
	projectId: string
	axis: CollectionLayerAxis
	recordId: string
}): Promise<{ data: BrandLayerPins; meta: { changed: boolean } }> {
	return requestJson<{ data: BrandLayerPins; meta: { changed: boolean } }>(
		`/api/v1/brand-projects/${encodeURIComponent(input.projectId)}/layers`,
		{
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ axis: input.axis, recordId: input.recordId }),
		},
	)
}
