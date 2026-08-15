#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { Command } from "commander"
import {
	ApiError,
	CLI_VERSION,
	COLLECTION_EXPORT_FORMATS,
	COLLECTION_LAYER_AXES,
	COLLECTION_SORTS,
	COLLECTION_TIERS,
	type CollectionExportFormat,
	type CollectionSort,
	type CollectionTier,
	EXPORT_FORMATS,
	type ExportFormat,
	FONT_CATEGORIES,
	type FontCategory,
	IMAGE_DIRECTION_FAMILIES,
	IMAGE_DIRECTION_PURPOSES,
	INTERFACE_STYLE_FAMILIES,
	type ImageDirectionFamily,
	type InterfaceStyleFamily,
	KIT_USE_CASES,
	type KitOverridesInput,
	type KitUseCase,
	NAME_RESEARCH_PURPOSES,
	NAMING_CANDIDATE_STATUSES,
	type NameResearchTask,
	type NamingCandidateStatus,
	PAGE_RECIPE_GOALS,
	type PageRecipeGoal,
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
	getKit,
	getKitHistorySnapshot,
	getKitVersion,
	getMe,
	getMockupJob,
	getNamingResearchContext,
	getPageRecipe,
	getProjectContext,
	listAllKits,
	listBrandProjectComments,
	listBrandProjectVersions,
	listBrandProjects,
	listFonts,
	listImageDirections,
	listInterfaceStyles,
	listKitHistory,
	listKitVersions,
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
	shareBrandProject,
	similarFonts,
	similarKits,
	updateBrandShare,
	updateBrandVariation,
	updateTheme,
} from "./api.js"
import {
	APPLY_TOKENS_FORMATS,
	type ApplyTokensFormat,
	applyTheme,
	formatApplyResult,
} from "./apply.js"
import { parseCandidateBatch } from "./candidate-input.js"
import {
	CONFIG_PATH,
	readConfig,
	resolveApiKey,
	resolveApiUrl,
	updateConfig,
} from "./config.js"
import { inspectCurrentMcp } from "./doctor.js"
import {
	CLI_PACKAGE_SPEC,
	type Client,
	SUPPORTED_CLIENTS,
	inspectClientConfig,
	installClient,
} from "./install.js"
import { browserLogin } from "./login.js"
import { runMcp } from "./mcp.js"
import { formatThemeStatus, themeStatus } from "./status.js"
import { getUpdateStatus, startUpdateCheck } from "./updateCheck.js"

function fail(err: unknown): never {
	if (err instanceof ApiError) {
		// The structured fields are the actionable half of an API error: which
		// input failed validation, when the quota resets, the current concurrency
		// marker to retry with. Print them rather than the sentence alone.
		process.stderr.write(`Error ${err.status}: ${err.message}\n`)
		if (err.details) {
			process.stderr.write(`${JSON.stringify(err.details, null, 2)}\n`)
		}
		process.exit(1)
	}
	const message = err instanceof Error ? err.message : String(err)
	process.stderr.write(`${message}\n`)
	process.exit(1)
}

function maskKey(key: string): string {
	return key.length > 8 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "ifk_…"
}

function jsonOutput(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function commaList(value: string): string[] {
	return Array.from(
		new Set(
			value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		),
	)
}

function collect(value: string, values: string[]): string[] {
	return [...values, value]
}

function mockupItem(value: string): { templateId: string; sceneId: string } {
	const separator = value.indexOf(":")
	if (separator < 1 || separator === value.length - 1) {
		throw new Error(`Mockup item "${value}" must be <template-id>:<scene-id>.`)
	}
	return {
		templateId: value.slice(0, separator),
		sceneId: value.slice(separator + 1),
	}
}

function oneOf<T extends readonly string[]>(
	value: string,
	allowed: T,
	label: string,
): T[number] {
	if (!(allowed as readonly string[]).includes(value)) {
		throw new Error(`Unknown ${label} "${value}". Use ${allowed.join(", ")}.`)
	}
	return value as T[number]
}

/** Parse an integer option, refusing anything that is not one rather than
 *  letting `Number("3 kits")` become NaN and reach the server as `?limit=NaN`. */
function intOption(value: string, label: string): number {
	const parsed = Number(value)
	if (!Number.isInteger(parsed)) {
		throw new Error(`${label} must be a whole number, got "${value}".`)
	}
	return parsed
}

function commaEnum<T extends readonly string[]>(
	value: string | undefined,
	allowed: T,
	label: string,
): T[number][] | undefined {
	if (!value) return undefined
	return commaList(value).map((entry) => oneOf(entry, allowed, label))
}

function namingStatuses(value?: string): NamingCandidateStatus[] | undefined {
	if (!value) return undefined
	const values = commaList(value)
	for (const status of values) {
		if (!(NAMING_CANDIDATE_STATUSES as readonly string[]).includes(status)) {
			throw new Error(
				`Unknown status "${status}". Use ${NAMING_CANDIDATE_STATUSES.join(
					", ",
				)}.`,
			)
		}
	}
	return values as NamingCandidateStatus[]
}

function readCandidateBatch(file: string): unknown[] {
	const source =
		file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8")
	return parseCandidateBatch(source)
}

function readResearchTasks(file: string): NameResearchTask[] {
	const source =
		file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8")
	const parsed = JSON.parse(source) as unknown
	const tasks =
		typeof parsed === "object" && parsed !== null && "tasks" in parsed
			? (parsed as { tasks: unknown }).tasks
			: parsed
	if (!Array.isArray(tasks)) {
		throw new Error('Expected a JSON array or an object with a "tasks" array.')
	}
	return tasks as NameResearchTask[]
}

/**
 * Read one JSON object from a file, or from stdin when the path is `-`.
 *
 * `label` names the thing in every failure, because "unexpected token" against
 * an unnamed file tells you nothing when a command accepts two of these.
 */
function readJsonObject(file: string, label: string): Record<string, unknown> {
	const where = file === "-" ? "stdin" : file
	const source = readFileSync(file === "-" ? 0 : file, "utf8")
	let parsed: unknown
	try {
		parsed = JSON.parse(source) as unknown
	} catch (err) {
		throw new Error(
			`${label} from ${where} is not valid JSON: ${
				err instanceof Error ? err.message : String(err)
			}`,
		)
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${label} from ${where} must be a JSON object.`)
	}
	return parsed as Record<string, unknown>
}

const program = new Command()
program
	.name("identityforge")
	.description(
		"Identity Forge — bring design kits into your coding agent (CLI + MCP server).",
	)
	.version(CLI_VERSION)

startUpdateCheck(CLI_VERSION)

program
	.command("mcp")
	.description(
		"Run the Identity Forge MCP server over stdio. Configure this in your agent (see `install`).",
	)
	.action(async () => {
		// Must not print to stdout — that channel carries the JSON-RPC stream.
		await runMcp()
	})

const themes = program
	.command("themes")
	.description(
		"List available themes. With --query, list the full catalog to rank yourself.",
	)
	.option(
		"-q, --query <text>",
		"Echo your brief alongside the full catalog (no server-side ranking — you judge fit).",
	)
	.action(async (opts: { query?: string }) => {
		try {
			// Both paths list the catalog; --query just carries the brief through.
			// There is no server-side matching — fit is the caller's judgment.
			if (opts.query) {
				const { data: matches, meta } = await resolveKits(opts.query)
				for (const m of matches) {
					const tags = (m.kit.vibeTags ?? m.kit.tags ?? []).slice(0, 4)
					const vibe = tags.length ? `\t${tags.join(", ")}` : ""
					process.stdout.write(`${m.kit.slug}\t${m.kit.name}${vibe}\n`)
				}
				if (meta.gated) {
					process.stderr.write(
						`${meta.accessible} of ${meta.total} available to this key, ${meta.gated.count} need Pro (${meta.gated.unlock.url}).\n`,
					)
				}
			} else {
				const kits = await listAllKits()
				for (const k of kits) {
					process.stdout.write(`${k.slug}\t${k.name}\n`)
				}
			}
		} catch (err) {
			fail(err)
		}
	})

// Reading a kit without writing files. Until this existed the only way to pull
// one through the CLI was `apply`, which writes into your repo, and the
// stale-write marker had no CLI source at all, so `expectedUpdatedAt` could not
// be armed before a first edit.
themes
	.command("get")
	.argument("<id-or-slug>", "Permanent kit id, or its slug.")
	.description(
		"Print one kit to stdout without writing any files: the DESIGN.md brief, the tokens in any format, or the whole kit as JSON.",
	)
	.option(
		"-f, --format <fmt>",
		`Output format: ${EXPORT_FORMATS.join(" | ")}.`,
		"design-md",
	)
	.option(
		"--marker",
		"Print ONLY the stale-write marker, for piping straight into `themes update --expected-updated-at`. Opaque: echo it back byte for byte, never parse it.",
	)
	.action(
		async (identifier: string, opts: { format: string; marker?: boolean }) => {
			try {
				if (opts.marker) {
					const { updatedAt } = await getKit(identifier)
					if (!updatedAt) {
						throw new Error(
							`"${identifier}" is a curated catalog kit. It has no stale-write marker because it cannot be edited; only kits saved under your own key can.`,
						)
					}
					process.stdout.write(`${updatedAt}\n`)
					return
				}
				// `json` comes from the kit route rather than /export, because that
				// response also carries the marker, so one metered call answers both
				// "what is this kit" and "what do I guard the next write with".
				if (opts.format === "json") {
					const { kit, updatedAt } = await getKit(identifier)
					jsonOutput(kit)
					if (updatedAt) {
						process.stderr.write(
							`stale-write marker: ${updatedAt}\nPass it verbatim as --expected-updated-at; it is an opaque string, not a parseable timestamp.\n`,
						)
					}
					return
				}
				const format = oneOf(
					opts.format,
					EXPORT_FORMATS,
					"export format",
				) as ExportFormat
				const { body } = await exportKit(identifier, format)
				process.stdout.write(body.endsWith("\n") ? body : `${body}\n`)
			} catch (err) {
				fail(err)
			}
		},
	)

// The write `themes get --marker` exists to arm. Read the marker, edit, pass it
// back: that round trip is the whole point of the read command landing first.
themes
	.command("update")
	.argument(
		"<id-or-slug>",
		"Permanent kit id, or the slug, of a kit you saved.",
	)
	.description(
		"Edit a kit you already saved, in place. OVERWRITES the stored kit with no undo: the id, slug and publication state all stay put, so every brand variation, share link and installed registry entry pointing at that kit follows the edit. Only kits saved under your own key can be updated; a catalog kit or another user's kit answers 404. Read the marker first with `themes get --marker` and pass it to --expected-updated-at, so a concurrent edit answers 409 instead of being silently overwritten.",
	)
	.option("--name <name>", "Rename the kit. The slug does not move with it.")
	.option(
		"--kit <path>",
		"JSON object deep merged over the stored kit; use - for stdin. State only what changes, everything else survives. A payload carrying a different slug is rejected rather than quietly ignored.",
	)
	.option(
		"--overrides <path>",
		"JSON overrides object (tokens / colors / fonts / facets) applied on top of the merge; use - for stdin.",
	)
	.option(
		"--expected-updated-at <marker>",
		"The marker from `themes get --marker`, byte for byte. Turns a concurrent edit into a 409 carrying the current marker instead of an overwrite. It is an opaque string: never parse or reformat it.",
	)
	.action(
		async (
			identifier: string,
			opts: {
				name?: string
				kit?: string
				overrides?: string
				expectedUpdatedAt?: string
			},
		) => {
			try {
				if (!opts.name && !opts.kit && !opts.overrides) {
					throw new Error(
						"Nothing to update. Pass at least one of --name, --kit or --overrides.",
					)
				}
				// Both read fd 0, and stdin can only be drained once, so the second
				// would silently receive an empty string and parse-fail somewhere
				// confusing.
				if (opts.kit === "-" && opts.overrides === "-") {
					throw new Error(
						"--kit and --overrides cannot both read stdin. Put at least one in a file.",
					)
				}
				if (!opts.expectedUpdatedAt) {
					process.stderr.write(
						"Warning: no --expected-updated-at, so this overwrites whatever is stored, including an edit made since you last read the kit. Read the marker with `themes get --marker` to guard it.\n",
					)
				}
				jsonOutput(
					await updateTheme({
						slug: identifier,
						name: opts.name,
						kit: opts.kit ? readJsonObject(opts.kit, "--kit") : undefined,
						overrides: opts.overrides
							? readJsonObject(opts.overrides, "--overrides")
							: undefined,
						expectedUpdatedAt: opts.expectedUpdatedAt,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

themes
	.command("delete")
	.argument(
		"<id-or-slug>",
		"Permanent kit id, or the slug, of a kit you saved.",
	)
	.description(
		"Permanently delete one of your saved kits. A kit still referenced by a brand project is refused; retire or repoint those references first. Requires --yes because this cannot be undone.",
	)
	.option("--yes", "Confirm the permanent deletion. Required to proceed.")
	.action(async (identifier: string, opts: { yes?: boolean }) => {
		try {
			if (!opts.yes) {
				throw new Error(
					`Would permanently delete kit "${identifier}". Re-run with --yes to confirm. Nothing was deleted.`,
				)
			}
			jsonOutput(await deleteTheme(identifier))
		} catch (err) {
			fail(err)
		}
	})

// The versioning read surface. All read-only: nothing here restores a version,
// because putting an old state back is a write and belongs behind `themes
// update`, where the overwrite rules already live.

/** Shared by the four paged/ranged version commands. */
function versionPageOpts(opts: { limit?: string; before?: string }) {
	return {
		limit: opts.limit == null ? undefined : intOption(opts.limit, "--limit"),
		before:
			opts.before == null ? undefined : intOption(opts.before, "--before"),
	}
}

function versionRangeOpts(opts: { from: string; to?: string }) {
	return {
		from: intOption(opts.from, "--from"),
		to: opts.to == null ? undefined : intOption(opts.to, "--to"),
	}
}

themes
	.command("versions")
	.argument("<id-or-slug>", "Permanent kit id, or its slug.")
	.description(
		"List a kit's edit history, newest first: version, when, by whom, and the author's note. Saved kits and managed catalog kits accumulate versions; static catalog fallbacks remain at version 0 until they are promoted into the managed catalog.",
	)
	.option("--limit <n>", "Rows per page, newest first. Default 50, max 200.")
	.option("--before <n>", "Return versions below this number, for paging.")
	.action(
		async (identifier: string, opts: { limit?: string; before?: string }) => {
			try {
				const { data, meta } = await listKitVersions(
					identifier,
					versionPageOpts(opts),
				)
				jsonOutput({ versions: data, meta })
			} catch (err) {
				fail(err)
			}
		},
	)

themes
	.command("version")
	.argument("<id-or-slug>", "Permanent kit id, or its slug.")
	.argument("<version>", "Version number from `themes versions`.")
	.description(
		"Print one stored version of a kit as the full snapshot it recorded. Large: this is a whole design kit. Gated like an export, so a Pro kit without an entitled key answers 403 rather than a redacted body.",
	)
	.action(async (identifier: string, version: string) => {
		try {
			jsonOutput(await getKitVersion(identifier, intOption(version, "version")))
		} catch (err) {
			fail(err)
		}
	})

themes
	.command("diff")
	.argument("<id-or-slug>", "Permanent kit id, or its slug.")
	.description(
		"Show what changed between two versions of a kit: the paths that moved, their old and new values, and the CSS variable each token change drives. Pass --from alone to compare against the current version, which is the question a repo asks after reading its stamp. For a Pro kit you are not entitled to, changes come back with their values withheld and marked redacted, so you still see what moved.",
	)
	.requiredOption(
		"--from <n>",
		"Lower bound, usually the version recorded in identityforge.json. Use 0 for the first recorded state.",
	)
	.option(
		"--to <n>",
		"Upper bound. Omit to compare against the current version.",
	)
	.action(async (identifier: string, opts: { from: string; to?: string }) => {
		try {
			const { data, meta } = await diffKitVersions(
				identifier,
				versionRangeOpts(opts),
			)
			jsonOutput({ diff: data, meta })
		} catch (err) {
			fail(err)
		}
	})

// WHY `history` EXISTS ALONGSIDE `versions`, WHICH LOOKS LIKE A DUPLICATE
//
// It is a wider record, not a second name for the same one. `kit_history_events`
// carries three event types — create, save and apply-to-brand — and only the
// first two mint a version. So `versions` cannot answer "when was this kit
// actually used on a brand", and an agent that reads only the version timeline
// sees an edit log with the applications silently missing.
//
// Paged by opaque cursor rather than by number, because an event has no ordinal
// to page below the way a version does.

themes
	.command("history")
	.argument("<id-or-slug>", "Permanent kit id, or its slug.")
	.description(
		"List a kit's history ledger, newest first: every save, its creation, and every time it was applied to a brand. Wider than `themes versions`, which only sees the events that minted a version — an apply appears here and nowhere else. Only kits saved under an API key have a ledger; a curated catalog kit is shipped rather than edited, so its ledger is empty.",
	)
	.option("--limit <n>", "Rows per page, newest first. Default 20, max 50.")
	.option(
		"--cursor <cursor>",
		"Next page. Pass `meta.nextCursor` from the previous page back unchanged; it is opaque, so do not construct one.",
	)
	.action(
		async (identifier: string, opts: { limit?: string; cursor?: string }) => {
			try {
				const { data, meta } = await listKitHistory(identifier, {
					limit:
						opts.limit == null ? undefined : intOption(opts.limit, "--limit"),
					cursor: opts.cursor,
				})
				jsonOutput({ history: data, meta })
			} catch (err) {
				fail(err)
			}
		},
	)

themes
	.command("snapshot")
	.argument("<id-or-slug>", "Permanent kit id, or its slug.")
	.argument("<event-id>", "History entry id from `themes history`.")
	.description(
		"Print the full kit as it stood at one history entry. Large: this is a whole design kit. Use it to diff a past state against the current kit, or to PATCH it back and restore that state. The entry must be yours and on a kit you still own; either test failing answers 404, so knowing an id is never enough on its own.",
	)
	.action(async (identifier: string, eventId: string) => {
		try {
			jsonOutput(await getKitHistorySnapshot(identifier, eventId))
		} catch (err) {
			fail(err)
		}
	})

// PARITY WITH MCP, NOT NEW CAPABILITY. Every fetcher below already existed and
// was already reachable — from `identityforge mcp` only. An agent that drives
// this CLI could read a kit and edit one, and could not author one, fork one,
// or ask what a kit is near. Same defect as a REST endpoint no agent surface
// calls, with the two agent surfaces as the two sides.

themes
	.command("create")
	.description(
		"Author a new design kit under your key. Either from scratch with --kit, or by forking a catalog kit with --base and shaping it with --overrides. The result is private and yours; publishing is a separate, deliberate act. Free plans have a saved-kit ceiling, and the response reports where you now stand against it.",
	)
	.requiredOption("--name <name>", "Kit name. The slug is derived from it.")
	.option(
		"--base <id-or-slug>",
		"Catalog kit to fork. Omit when passing --kit.",
	)
	.option("--kit <path>", "Whole kit as JSON; use - for stdin.")
	.option(
		"--overrides <path>",
		"JSON overrides (tokens / colors / fonts / facets) applied on top; use - for stdin.",
	)
	.action(
		async (opts: {
			name: string
			base?: string
			kit?: string
			overrides?: string
		}) => {
			try {
				if (!opts.base && !opts.kit) {
					throw new Error(
						"Nothing to build from. Pass --base to fork a catalog kit, or --kit with a whole kit payload.",
					)
				}
				// Same refusal `themes update` makes: two readers on one stdin means
				// the second gets nothing, and silently sending `{}` would record "no
				// overrides" as though it were the considered answer.
				if (opts.kit === "-" && opts.overrides === "-") {
					throw new Error(
						"--kit and --overrides cannot both read stdin. Put at least one in a file.",
					)
				}
				jsonOutput(
					await createTheme({
						name: opts.name,
						base: opts.base,
						kit: opts.kit ? readJsonObject(opts.kit, "--kit") : undefined,
						overrides: opts.overrides
							? (readJsonObject(
									opts.overrides,
									"--overrides",
								) as KitOverridesInput)
							: undefined,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

themes
	.command("remix")
	.argument(
		"<id-or-slug>",
		"Kit to copy: yours, a catalog kit, or a public one.",
	)
	.description(
		"Copy an existing kit into a NEW private kit with your overrides applied, leaving the original untouched. This is the safe way to explore a direction: `themes update` overwrites in place and everything pointing at that kit follows the edit, whereas this one cannot disturb anybody.",
	)
	.option("--name <name>", "Name for the copy. Defaults to a derived one.")
	.requiredOption(
		"--overrides <path>",
		"JSON overrides (tokens / colors / fonts / facets); use - for stdin. Required: a remix with nothing changed is just a duplicate.",
	)
	.action(
		async (identifier: string, opts: { name?: string; overrides: string }) => {
			try {
				jsonOutput(
					await remixTheme({
						slug: identifier,
						name: opts.name,
						overrides: readJsonObject(
							opts.overrides,
							"--overrides",
						) as KitOverridesInput,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

themes
	.command("similar")
	.argument("<id-or-slug>", "Kit to find neighbours for.")
	.description(
		"Find published kits close to one you already have, ranked by palette proximity, shared tags and audience. Use it when the direction is right but the user wants options before committing.",
	)
	.option("--limit <n>", "How many neighbours. Default 4.")
	.action(async (identifier: string, opts: { limit?: string }) => {
		try {
			jsonOutput(
				await similarKits(
					identifier,
					opts.limit == null ? undefined : intOption(opts.limit, "--limit"),
				),
			)
		} catch (err) {
			fail(err)
		}
	})

themes
	.command("match")
	.argument(
		"<colors...>",
		"Hex colors the brand already owns, e.g. #1d4ed8 #f97316.",
	)
	.description(
		"Rank published kits by how close their palette sits to colors you already hold, using perceptual color distance rather than string matching. Reach for it when a brand arrives with colors that are not negotiable.",
	)
	.option("--limit <n>", "How many kits. Default 4.")
	.action(async (colors: string[], opts: { limit?: string }) => {
		try {
			jsonOutput(
				await matchPalette(
					colors,
					opts.limit == null ? undefined : intOption(opts.limit, "--limit"),
				),
			)
		} catch (err) {
			fail(err)
		}
	})

const imageDirections = program
	.command("image-directions")
	.description("List image directions or print an exact entitled export.")

imageDirections
	.command("list")
	.description("List public image-direction judgment records as JSON.")
	.option("-q, --query <text>", "Search names, aliases, signals, and uses.")
	.option("--use <purpose>", `Purpose: ${IMAGE_DIRECTION_PURPOSES.join(", ")}.`)
	.option("--family <ids>", "Comma-separated image families.")
	.option("--tier <tiers>", "Comma-separated tiers: free, pro.")
	.option("--sort <sort>", "Sort: curated, az, free-first.", "curated")
	.action(
		async (opts: {
			query?: string
			use?: string
			family?: string
			tier?: string
			sort: string
		}) => {
			try {
				jsonOutput(
					await listImageDirections({
						q: opts.query,
						use: opts.use
							? oneOf(opts.use, IMAGE_DIRECTION_PURPOSES, "image purpose")
							: undefined,
						family: commaEnum(
							opts.family,
							IMAGE_DIRECTION_FAMILIES,
							"image family",
						) as ImageDirectionFamily[] | undefined,
						tier: commaEnum(opts.tier, COLLECTION_TIERS, "collection tier") as
							| CollectionTier[]
							| undefined,
						sort: oneOf(
							opts.sort,
							COLLECTION_SORTS,
							"collection sort",
						) as CollectionSort,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

imageDirections
	.command("get")
	.argument("<slug>", "Image-direction slug.")
	.description("Print the exact JSON or Markdown export to stdout.")
	.option(
		"-f, --format <format>",
		"Export format: markdown or json.",
		"markdown",
	)
	.action(async (slug: string, opts: { format: string }) => {
		try {
			const format = oneOf(
				opts.format,
				COLLECTION_EXPORT_FORMATS,
				"export format",
			) as CollectionExportFormat
			const result = await getImageDirection(slug, format)
			process.stdout.write(
				result.body.endsWith("\n") ? result.body : `${result.body}\n`,
			)
		} catch (err) {
			fail(err)
		}
	})

const pageRecipes = program
	.command("page-recipes")
	.description("List page recipes or print an exact entitled export.")

pageRecipes
	.command("list")
	.description(
		"List communication-first and explicitly labeled legacy page recipes as JSON.",
	)
	.option(
		"-q, --query <text>",
		"Search names, audiences, communication ideas, examples, and legacy sections.",
	)
	.option("--goal <goal>", `Goal: ${PAGE_RECIPE_GOALS.join(", ")}.`)
	.option("--tier <tiers>", "Comma-separated tiers: free, pro.")
	.option("--sort <sort>", "Sort: curated, az, free-first.", "curated")
	.action(
		async (opts: {
			query?: string
			goal?: string
			tier?: string
			sort: string
		}) => {
			try {
				jsonOutput(
					await listPageRecipes({
						q: opts.query,
						goal: opts.goal
							? (oneOf(
									opts.goal,
									PAGE_RECIPE_GOALS,
									"page-recipe goal",
								) as PageRecipeGoal)
							: undefined,
						tier: commaEnum(opts.tier, COLLECTION_TIERS, "collection tier") as
							| CollectionTier[]
							| undefined,
						sort: oneOf(
							opts.sort,
							COLLECTION_SORTS,
							"collection sort",
						) as CollectionSort,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

pageRecipes
	.command("get")
	.argument("<slug>", "Page-recipe slug.")
	.description("Print the exact JSON or Markdown export to stdout.")
	.option(
		"-f, --format <format>",
		"Export format: markdown or json.",
		"markdown",
	)
	.action(async (slug: string, opts: { format: string }) => {
		try {
			const format = oneOf(
				opts.format,
				COLLECTION_EXPORT_FORMATS,
				"export format",
			) as CollectionExportFormat
			const result = await getPageRecipe(slug, format)
			process.stdout.write(
				result.body.endsWith("\n") ? result.body : `${result.body}\n`,
			)
		} catch (err) {
			fail(err)
		}
	})

const interfaceStyles = program
	.command("interface-styles")
	.description("List interface styles or print an exact entitled export.")

interfaceStyles
	.command("list")
	.description("List public interface-style judgment records as JSON.")
	.option("-q, --query <text>", "Search names, aliases, signals, and uses.")
	.option("--use <use-case>", `Use case: ${KIT_USE_CASES.join(", ")}.`)
	.option("--family <ids>", "Comma-separated interface-style families.")
	.option("--tier <tiers>", "Comma-separated tiers: free, pro.")
	.option("--sort <sort>", "Sort: curated, az, free-first.", "curated")
	.action(
		async (opts: {
			query?: string
			use?: string
			family?: string
			tier?: string
			sort: string
		}) => {
			try {
				jsonOutput(
					await listInterfaceStyles({
						q: opts.query,
						use: opts.use
							? (oneOf(opts.use, KIT_USE_CASES, "use case") as KitUseCase)
							: undefined,
						family: commaEnum(
							opts.family,
							INTERFACE_STYLE_FAMILIES,
							"interface-style family",
						) as InterfaceStyleFamily[] | undefined,
						tier: commaEnum(opts.tier, COLLECTION_TIERS, "collection tier") as
							| CollectionTier[]
							| undefined,
						sort: oneOf(
							opts.sort,
							COLLECTION_SORTS,
							"collection sort",
						) as CollectionSort,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

interfaceStyles
	.command("get")
	.argument("<slug>", "Interface-style slug.")
	.description("Print the exact JSON or Markdown export to stdout.")
	.option(
		"-f, --format <format>",
		"Export format: markdown or json.",
		"markdown",
	)
	.action(async (slug: string, opts: { format: string }) => {
		try {
			const format = oneOf(
				opts.format,
				COLLECTION_EXPORT_FORMATS,
				"export format",
			) as CollectionExportFormat
			const result = await getInterfaceStyle(slug, format)
			process.stdout.write(
				result.body.endsWith("\n") ? result.body : `${result.body}\n`,
			)
		} catch (err) {
			fail(err)
		}
	})

const fontsCommand = program
	.command("fonts")
	.description(
		"Search the Google Fonts catalog, find faces that resemble one you have, and read pairings.",
	)

fontsCommand
	.command("search")
	.argument("[query]", "Match on font name, e.g. grotesk.")
	.description("Search fonts by name or category. Metadata only, no files.")
	.option("--category <category>", `One of: ${FONT_CATEGORIES.join(", ")}.`)
	.option("--limit <n>", "How many to return. Default 12.")
	.option("--page <n>", "Page index, 0-based. Default 0.")
	.action(
		async (
			query: string | undefined,
			opts: { category?: string; limit?: string; page?: string },
		) => {
			try {
				jsonOutput(
					await listFonts({
						search: query,
						category: opts.category
							? (oneOf(
									opts.category,
									FONT_CATEGORIES,
									"font category",
								) as FontCategory)
							: undefined,
						pageSize:
							opts.limit == null ? 12 : intOption(opts.limit, "--limit"),
						page:
							opts.page == null ? undefined : intOption(opts.page, "--page"),
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

fontsCommand
	.command("similar")
	.argument("<family>", "A font family or its id, e.g. Inter or open-sans.")
	.description(
		"Fonts that resemble one you already have, ranked by category, popularity, shared pairing partners and co-usage in kits. No letterform analysis, so confirm the look yourself.",
	)
	.option("--limit <n>", "How many neighbours. Default 12.")
	.action(async (family: string, opts: { limit?: string }) => {
		try {
			jsonOutput(
				await similarFonts(
					family,
					opts.limit == null ? undefined : intOption(opts.limit, "--limit"),
				),
			)
		} catch (err) {
			fail(err)
		}
	})

fontsCommand
	.command("pairings")
	.argument("[family]", "A family to pair. Omit for the whole curated table.")
	.description("Curated heading/body/mono pairings, plus contrast suggestions.")
	.option("--role <role>", "Which slot the family occupies: heading or body.")
	.action(async (family: string | undefined, opts: { role?: string }) => {
		try {
			jsonOutput(
				await fontPairings({
					family,
					role: opts.role
						? (oneOf(opts.role, ["heading", "body"], "pairing role") as
								| "heading"
								| "body")
						: undefined,
				}),
			)
		} catch (err) {
			fail(err)
		}
	})

program
	.command("apply")
	.argument("<slug>", "Theme slug to apply.")
	.description(
		"Write a theme's DESIGN.md, tokens, and an identityforge.json stamp into a directory. The stamp records the kit's id and version, so a later apply can report what moved. Refuses rather than overwriting files it did not write.",
	)
	.option("-d, --dir <path>", "Target directory.", process.cwd())
	.option(
		"-f, --format <fmt>",
		`Tokens format: ${APPLY_TOKENS_FORMATS.join(" | ")}.`,
		"dtcg",
	)
	.option(
		"--preview",
		"Dry run: print the plan (create / overwrite / conflict) and write nothing.",
	)
	.option(
		"--force",
		"Overwrite conflicting files anyway. Their current content is lost permanently.",
	)
	.option(
		"--tokens-entry <path>",
		"Advisory: project-relative path where the tokens get wired in. Recorded in the stamp.",
	)
	.action(
		async (
			slug: string,
			opts: {
				dir: string
				format: string
				preview?: boolean
				force?: boolean
				tokensEntry?: string
			},
		) => {
			try {
				const result = await applyTheme({
					slug,
					dir: opts.dir,
					tokensFormat: oneOf(
						opts.format,
						APPLY_TOKENS_FORMATS,
						"tokens format",
					) as ApplyTokensFormat,
					preview: opts.preview,
					force: opts.force,
					tokensEntry: opts.tokensEntry,
				})
				const report = `${formatApplyResult(result)}\n`
				// A refusal wrote nothing, so it must not look like success to a
				// script or an agent reading the exit code.
				if (result.mode === "refused") {
					process.stderr.write(report)
					process.exit(1)
				}
				process.stdout.write(report)
			} catch (err) {
				fail(err)
			}
		},
	)

/**
 * The question a repository asks about itself. No arguments: the stamp already
 * knows which kit and which version, and a command that has to be told those is
 * one the caller could have run without us.
 */
program
	.command("status")
	.description(
		"What has moved since this directory was built against a kit. Reads identityforge.json, then reports three independent movements — the kit's version (the design changed), the rendered DESIGN.md digest (which a serializer change moves for every kit at once), and the document's contract version (its SHAPE changed) — plus which written files were edited locally, plus the version diff when the kit moved. Read-only: it never writes and never touches the working tree. Prints JSON.",
	)
	.option(
		"-d, --dir <path>",
		"Directory holding identityforge.json.",
		process.cwd(),
	)
	.action(async (opts: { dir: string }) => {
		try {
			const status = await themeStatus({ dir: opts.dir })
			jsonOutput(status)
			// The human line goes to stderr so `identityforge status | jq` still
			// receives clean JSON.
			process.stderr.write(`${formatThemeStatus(status)}\n`)
		} catch (err) {
			fail(err)
		}
	})

// The client share loop, end to end: open a project, attach proposals, hand the
// client a link, read back what they said, then act on it. The last step is why
// the revise commands are here rather than MCP-only: a loop you can watch but
// not close is a demo, and HM5 ends in "and iterates".
const brand = program
	.command("brand")
	.description(
		"Build a client-facing brand project and read the feedback back. Needs kits:write (comments need kits:read). Every subcommand prints JSON.",
	)

brand
	.command("create")
	.description("Create a brand project: the container for variations + share.")
	.requiredOption("--name <name>", "Project name, usually the client or brief.")
	.option("--brief <text>", "What the client asked for, in their words.")
	.action(async (opts: { name: string; brief?: string }) => {
		try {
			jsonOutput(
				await createBrandProject({ name: opts.name, brief: opts.brief }),
			)
		} catch (err) {
			fail(err)
		}
	})

brand
	.command("projects")
	.description("List your brand projects and their variation counts.")
	.action(async () => {
		try {
			jsonOutput(await listBrandProjects())
		} catch (err) {
			fail(err)
		}
	})

const mockups = brand
	.command("mockups")
	.description("Generate and poll photographic mockup jobs.")

mockups
	.command("generate")
	.description(
		"Queue photographic mockups. This spends one AI credit per variation and scene combination, after validation.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption(
		"--variation <uuid>",
		"Variation id to render. Repeat for more than one.",
		collect,
		[],
	)
	.requiredOption(
		"--item <template:scene>",
		"Template and scene pair. Repeat for more than one.",
		collect,
		[],
	)
	.option(
		"--idempotency-key <key>",
		"Stable key for a retry that must not spend credits twice.",
	)
	.action(
		async (opts: {
			project: string
			variation: string[]
			item: string[]
			idempotencyKey?: string
		}) => {
			try {
				jsonOutput(
					await generateMockups({
						projectId: opts.project,
						variationIds: opts.variation,
						items: opts.item.map(mockupItem),
						idempotencyKey: opts.idempotencyKey,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

mockups
	.command("list")
	.description("List this project's mockup jobs, newest first.")
	.requiredOption("--project <uuid>", "Brand project id.")
	.action(async (opts: { project: string }) => {
		try {
			jsonOutput(await listMockupJobs(opts.project))
		} catch (err) {
			fail(err)
		}
	})

mockups
	.command("get")
	.description("Read one mockup job's status and result URLs.")
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption("--job <uuid>", "Mockup job id.")
	.action(async (opts: { project: string; job: string }) => {
		try {
			jsonOutput(await getMockupJob(opts.project, opts.job))
		} catch (err) {
			fail(err)
		}
	})

brand
	.command("add-variation")
	.description(
		"Attach one proposal to a project. Add four or five contrasting directions; a client choosing between near-identical ones cannot tell you much.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption(
		"--kit <id-or-slug>",
		"Kit for this direction: your own, a catalog kit, or a public user kit.",
	)
	.option("--brand-name <name>", "Brand name shown on this proposal.")
	.option("--domain <domain>", "Domain shown on this proposal.")
	.option("--label <label>", "Short label the client sees.")
	.option("--notes <text>", "Rationale for this direction.")
	.action(
		async (opts: {
			project: string
			kit: string
			brandName?: string
			domain?: string
			label?: string
			notes?: string
		}) => {
			try {
				jsonOutput(
					await addBrandVariation({
						projectId: opts.project,
						kitSlug: opts.kit,
						brandName: opts.brandName,
						domain: opts.domain,
						label: opts.label,
						notes: opts.notes,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

brand
	.command("share")
	.description(
		"Create or rotate the read-only /p/<token> client link. Rotating invalidates the previous URL.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.option("--password <password>", "Password-protect the share.")
	.option("--rotate", "Mint a new token, breaking the old link.")
	.action(
		async (opts: { project: string; password?: string; rotate?: boolean }) => {
			try {
				jsonOutput(
					await shareBrandProject({
						projectId: opts.project,
						password: opts.password,
						rotate: opts.rotate,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

brand
	.command("comments")
	.description(
		"Read what the client wrote on each variation, oldest first. Read this before revising anything.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.action(async (opts: { project: string }) => {
		try {
			jsonOutput(await listBrandProjectComments(opts.project))
		} catch (err) {
			fail(err)
		}
	})

/** Optional variation fields that `--clear` can null out, named as the user
 *  types them. An absent flag leaves a field alone, so clearing needs its own
 *  spelling; `--notes ""` would be a guess about how the server reads an empty
 *  string, and the helper's contract is explicitly `null`. */
const CLEARABLE_VARIATION_FIELDS = {
	"brand-name": "brandName",
	domain: "domain",
	label: "label",
	notes: "notes",
} as const

brand
	.command("update-variation")
	.description(
		"Revise one proposal in place, after reading the client's comments. OVERWRITES the stored variation, and the client sees it the moment they next load the share link, so treat it as publishing rather than drafting. Only the fields you pass move. Add a new direction with add-variation instead when the old one should stay on the board.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption("--variation <uuid>", "Variation id to revise.")
	.option(
		"--kit <id-or-slug>",
		"Repoint this proposal at a different design kit. Re-checks that you can resolve it, and that a Pro kit has an entitled key behind it.",
	)
	.option("--brand-name <name>", "Brand name shown on this proposal.")
	.option("--domain <domain>", "Domain shown on this proposal.")
	.option("--label <label>", "Short label the client sees.")
	.option("--notes <text>", "Rationale for this direction.")
	.option(
		"--clear <fields>",
		`Comma list of fields to empty rather than set: ${Object.keys(
			CLEARABLE_VARIATION_FIELDS,
		).join(", ")}.`,
	)
	.action(
		async (opts: {
			project: string
			variation: string
			kit?: string
			brandName?: string
			domain?: string
			label?: string
			notes?: string
			clear?: string
		}) => {
			try {
				const patch: Record<string, string | null> = {}
				if (opts.brandName !== undefined) patch.brandName = opts.brandName
				if (opts.domain !== undefined) patch.domain = opts.domain
				if (opts.label !== undefined) patch.label = opts.label
				if (opts.notes !== undefined) patch.notes = opts.notes
				const clearNames = Object.keys(CLEARABLE_VARIATION_FIELDS)
				for (const name of commaList(opts.clear ?? "")) {
					const field = oneOf(name, clearNames, "clearable field")
					const key =
						CLEARABLE_VARIATION_FIELDS[
							field as keyof typeof CLEARABLE_VARIATION_FIELDS
						]
					if (patch[key] !== undefined) {
						throw new Error(
							`--clear ${name} contradicts --${name}. Set it or clear it, not both.`,
						)
					}
					patch[key] = null
				}
				if (!opts.kit && Object.keys(patch).length === 0) {
					throw new Error(
						"Nothing to update. Pass at least one of --kit, --brand-name, --domain, --label, --notes or --clear.",
					)
				}
				jsonOutput(
					await updateBrandVariation({
						projectId: opts.project,
						variationId: opts.variation,
						kitSlug: opts.kit,
						...patch,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

brand
	.command("remove-variation")
	.description(
		"Permanently DELETE one proposal from a project. The client stops seeing that direction, and the comments they left on it go with it. There is no undo and no archive, so read `brand comments` first if that feedback still matters. Survivors keep their existing positions, leaving a gap rather than closing it, so follow with `brand reorder` when the sequence matters.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption("--variation <uuid>", "Variation id to delete.")
	.option(
		"--yes",
		"Confirm the deletion. Required, because this also destroys the client's comments on that direction.",
	)
	.action(
		async (opts: { project: string; variation: string; yes?: boolean }) => {
			try {
				// Refuse-by-default on an irreversible write, the same shape as
				// `apply` refusing to clobber a file you edited. The API asks for no
				// confirmation, so if the CLI does not either, one mistyped id
				// silently takes the client's feedback with it.
				if (!opts.yes) {
					throw new Error(
						`Refusing to delete variation ${opts.variation}: this cannot be undone and it also deletes the client comments on that direction. Re-run with --yes once you are sure. Nothing was deleted.`,
					)
				}
				jsonOutput(
					await deleteBrandVariation({
						projectId: opts.project,
						variationId: opts.variation,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

brand
	.command("reorder")
	.description(
		"Set the order the client meets the directions in. The share page walks them in this order, so the first id is what the client sees first. OVERWRITES the whole project's order and takes effect on their next view.",
	)
	.argument(
		"<variation-ids...>",
		"Every variation id in the project, exactly once, in the order the client should see them. A partial list is rejected with the expected id set.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.action(async (variationIds: string[], opts: { project: string }) => {
		try {
			jsonOutput(
				await reorderBrandVariations({
					projectId: opts.project,
					variationIds,
				}),
			)
		} catch (err) {
			fail(err)
		}
	})

brand
	.command("versions")
	.description(
		"List a brand project's history, newest first. Owner-scoped. Note what reaches this timeline: setting or clearing the project's brand name is recorded, while adding, editing, removing or reordering variations is not, so an empty timeline on a busy board is expected rather than a bug.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.option("--limit <n>", "Rows per page, newest first. Default 50, max 200.")
	.option("--before <n>", "Return versions below this number, for paging.")
	.action(
		async (opts: { project: string; limit?: string; before?: string }) => {
			try {
				const { data, meta } = await listBrandProjectVersions(
					opts.project,
					versionPageOpts(opts),
				)
				jsonOutput({ versions: data, meta })
			} catch (err) {
				fail(err)
			}
		},
	)

brand
	.command("version")
	.argument("<version>", "Version number from `brand versions`.")
	.description(
		"Print one stored version of a brand project as a full snapshot.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.action(async (version: string, opts: { project: string }) => {
		try {
			jsonOutput(
				await getBrandProjectVersion(
					opts.project,
					intOption(version, "version"),
				),
			)
		} catch (err) {
			fail(err)
		}
	})

brand
	.command("diff")
	.description(
		"Show what changed between two versions of a brand project. Pass --from alone to compare against the current version. Owner-scoped, so nothing is withheld.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption(
		"--from <n>",
		"Lower bound. Use 0 for the first recorded state.",
	)
	.option(
		"--to <n>",
		"Upper bound. Omit to compare against the current version.",
	)
	.action(async (opts: { project: string; from: string; to?: string }) => {
		try {
			const { data, meta } = await diffBrandProjectVersions(
				opts.project,
				versionRangeOpts(opts),
			)
			jsonOutput({ diff: data, meta })
		} catch (err) {
			fail(err)
		}
	})

// The context exchange. Describe the product once, then ask for proposals
// grounded in it rather than re-sending prose on every call.

brand
	.command("context")
	.description(
		"Print a project's stored context: what the product is, who it is for, its constraints, its surfaces, its stack. Prints null when the project has no context yet, which is a different fact from a project that does not exist. Needs kits:read.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.action(async (opts: { project: string }) => {
		try {
			jsonOutput(await getProjectContext(opts.project))
		} catch (err) {
			fail(err)
		}
	})

brand
	.command("set-context")
	.description(
		"REPLACE a project's context from a JSON file. Nothing is merged: any field the file leaves out is deleted, not kept, so read the current one with `brand context` and send it back whole with your edit applied. `product` is required and must be a real sentence; under 12 characters is refused. Needs kits:write.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption(
		"--file <path>",
		"JSON object: product, audience, constraints, avoid, industry, moods, surfaces, stack. Use - for stdin.",
	)
	.action(async (opts: { project: string; file: string }) => {
		try {
			const parsed = readJsonObject(opts.file, "--file")
			// The one field the server requires. Checking it here names the file
			// the caller has in front of them, rather than making them map a
			// validation error back to which of several files they sent.
			if (typeof parsed.product !== "string") {
				throw new Error(
					`${opts.file} has no "product" string. It is the one required field: a sentence or two on what the product does.`,
				)
			}
			jsonOutput(
				await putProjectContext(
					opts.project,
					parsed as unknown as ProjectContext,
				),
			)
		} catch (err) {
			fail(err)
		}
	})

brand
	.command("recommend")
	.description(
		"Kit candidates for a project, grounded in its stored context. Each carries the kit's own evidence and its computed fitness for the surfaces this product has. A Pro account with a kits:write key also gets a model ranking with a reason per candidate; meta.depth says which you got. Costs 3 quota units and requires a key, unlike the rest of discovery. Set the context first: a project without one is refused rather than guessed at.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.option("--limit <n>", "How many candidates to return.")
	.action(async (opts: { project: string; limit?: string }) => {
		try {
			const { data, meta } = await recommendKits({
				projectId: opts.project,
				limit:
					opts.limit == null ? undefined : intOption(opts.limit, "--limit"),
			})
			jsonOutput({ candidates: data, meta })
		} catch (err) {
			fail(err)
		}
	})

const naming = program
	.command("naming")
	.description(
		"Run the agent-native naming workflow. Every subcommand prints JSON.",
	)

naming
	.command("recipes")
	.description("Discover all public naming recipes as JSON.")
	.action(async () => {
		try {
			jsonOutput(await listNamingRecipes())
		} catch (err) {
			fail(err)
		}
	})

naming
	.command("projects")
	.description("List naming projects owned by the connected account.")
	.option("--limit <number>", "Maximum projects (1-100).", "50")
	.option("--offset <number>", "Pagination offset.", "0")
	.action(async (opts: { limit: string; offset: string }) => {
		try {
			jsonOutput(
				await listNamingProjects({
					limit: Number(opts.limit),
					offset: Number(opts.offset),
				}),
			)
		} catch (err) {
			fail(err)
		}
	})

naming
	.command("create-project")
	.description("Create a project-owned candidate board.")
	.requiredOption("--name <name>", "Project name.")
	.option("--description <brief>", "Project/naming brief.")
	.option("--tlds <list>", "Comma-separated TLDs.", "com,io,co")
	.action(
		async (opts: { name: string; description?: string; tlds: string }) => {
			try {
				jsonOutput(
					await createNamingProject({
						name: opts.name,
						description: opts.description,
						selectedTlds: commaList(opts.tlds),
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

naming
	.command("generate")
	.description(
		"Generate names into a project board and charge the connected account's AI credits.",
	)
	.requiredOption("--project <uuid>", "Project id.")
	.requiredOption("--description <brief>", "Specific naming brief.")
	.requiredOption(
		"--recipes <ids>",
		"Comma-separated recipe ids from `naming recipes`.",
	)
	.option("--count <number>", "Number of candidates (1-30).", "10")
	.option(
		"--frequency-penalty <number>",
		"Model frequency penalty (-2..2).",
		"0",
	)
	.option("--prefixes <list>", "Comma-separated domain-friendly prefixes.")
	.option("--suffixes <list>", "Comma-separated domain-friendly suffixes.")
	.option("--allow-misspellings", "Allow controlled brandable misspellings.")
	.option(
		"--idempotency-key <key>",
		"Stable key (8-128 chars) for safe retries.",
	)
	.action(
		async (opts: {
			project: string
			description: string
			recipes: string
			count: string
			frequencyPenalty: string
			prefixes?: string
			suffixes?: string
			allowMisspellings?: boolean
			idempotencyKey?: string
		}) => {
			try {
				jsonOutput(
					await generateNamingCandidates({
						projectId: opts.project,
						description: opts.description,
						recipeIds: commaList(opts.recipes),
						count: Number(opts.count),
						frequencyPenalty: Number(opts.frequencyPenalty),
						styleOptions: {
							...(opts.prefixes
								? { selectedPrefixes: commaList(opts.prefixes) }
								: {}),
							...(opts.suffixes
								? { selectedSuffixes: commaList(opts.suffixes) }
								: {}),
							...(opts.allowMisspellings ? { allowMisspellings: true } : {}),
						},
						idempotencyKey: opts.idempotencyKey,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

naming
	.command("candidates")
	.description("List a project's kanban candidates as JSON.")
	.requiredOption("--project <uuid>", "Project id.")
	.option("--status <list>", "Comma-separated board states.")
	.option("--limit <number>", "Maximum candidates (1-100).", "100")
	.option("--offset <number>", "Pagination offset.", "0")
	.action(
		async (opts: {
			project: string
			status?: string
			limit: string
			offset: string
		}) => {
			try {
				jsonOutput(
					await listNamingCandidates({
						projectId: opts.project,
						statuses: namingStatuses(opts.status),
						limit: Number(opts.limit),
						offset: Number(opts.offset),
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

naming
	.command("add-candidates")
	.description(
		"Persist names researched by Codex exec or another external model. Exact retries are idempotent through caller-owned candidate UUIDs.",
	)
	.requiredOption("--project <uuid>", "Project id.")
	.requiredOption(
		"--file <path>",
		'JSON array or {"candidates":[...]} file; use - to read stdin.',
	)
	.action(async (opts: { project: string; file: string }) => {
		try {
			jsonOutput(
				await addNamingCandidates({
					projectId: opts.project,
					candidates: readCandidateBatch(opts.file) as Parameters<
						typeof addNamingCandidates
					>[0]["candidates"],
				}),
			)
		} catch (err) {
			fail(err)
		}
	})

naming
	.command("generations")
	.description("List persistent model, prompt, request, and credit provenance.")
	.requiredOption("--project <uuid>", "Project id.")
	.option("--limit <number>", "Maximum generations (1-100).", "50")
	.option("--offset <number>", "Pagination offset.", "0")
	.action(async (opts: { project: string; limit: string; offset: string }) => {
		try {
			jsonOutput(
				await listNamingGenerations({
					projectId: opts.project,
					limit: Number(opts.limit),
					offset: Number(opts.offset),
				}),
			)
		} catch (err) {
			fail(err)
		}
	})

naming
	.command("move")
	.description("Atomically move one or more candidates to a kanban state.")
	.argument("<candidateIds...>", "Candidate ids.")
	.requiredOption("--project <uuid>", "Project id.")
	.requiredOption(
		"--status <state>",
		`One of: ${NAMING_CANDIDATE_STATUSES.join(", ")}.`,
	)
	.option("--notes <text>", "Replace candidate notes for every moved item.")
	.option(
		"--evidence <path|->",
		"JSON object whose top-level keys merge into every moved item's evidence, preserving unrelated sources. Read from a file, or from stdin with -.",
	)
	.option(
		"--expected-updated-at <marker>",
		"Refuse the move if the candidate changed since you read it. Take the marker from `naming candidates`, echo it back byte for byte, and never parse it. One candidate only: the marker identifies a specific row.",
	)
	.action(
		async (
			candidateIds: string[],
			opts: {
				project: string
				status: string
				notes?: string
				evidence?: string
				expectedUpdatedAt?: string
			},
		) => {
			try {
				const status = namingStatuses(opts.status)?.[0]
				if (!status) throw new Error("A valid status is required.")
				// The marker belongs to ONE row. Applying one candidate's marker to
				// the rest would guard the wrong rows and reject a legitimate move,
				// so refuse here rather than send a write that cannot succeed.
				if (opts.expectedUpdatedAt && candidateIds.length !== 1) {
					throw new Error(
						`--expected-updated-at guards a single candidate, but ${candidateIds.length} were given. Each candidate has its own marker. Move the guarded one on its own.`,
					)
				}
				// WHY THIS WARNS ON ONE STATUS AND NOT THE REST, when
				// `themes update` warns on every unguarded write.
				//
				// A warning that fires on routine work is trained out, and then it
				// is not there for the write that needed it. Moving twenty
				// candidates to `reviewing` is routine and reversible; the marker
				// buys little and the noise costs a lot. `selected` is the one
				// naming write shaped like a `themes update`: a project holds
				// exactly one selected candidate, and selecting also sets the
				// project's chosen brand name, so losing a concurrent one is both
				// expensive and invisible. Rank is never warned: it is cheap and
				// obvious to undo.
				if (status === "selected" && !opts.expectedUpdatedAt) {
					process.stderr.write(
						"Warning: no --expected-updated-at, so this selection overwrites whatever is stored, including a selection made since you last read the board. Selecting also sets the project's chosen brand name. Read the marker with `naming candidates` to guard it.\n",
					)
				}
				const evidence =
					opts.evidence === undefined
						? undefined
						: readJsonObject(opts.evidence, "--evidence")
				jsonOutput(
					await patchNamingCandidates({
						projectId: opts.project,
						operations: candidateIds.map((candidateId) => ({
							candidateId,
							status,
							...(opts.notes !== undefined ? { notes: opts.notes } : {}),
							...(evidence !== undefined ? { evidence } : {}),
							...(opts.expectedUpdatedAt !== undefined
								? { expectedUpdatedAt: opts.expectedUpdatedAt }
								: {}),
						})),
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

naming
	.command("rank")
	.description(
		"Atomically rank candidates with candidateId=rank assignments (rank 1 is highest).",
	)
	.argument("<assignments...>", "Assignments such as UUID=1 UUID=2.")
	.requiredOption("--project <uuid>", "Project id.")
	.option(
		"--expected-updated-at <marker>",
		"Refuse the ranking if the candidate changed since you read it. Take the marker from `naming candidates`, echo it back byte for byte, and never parse it. One assignment only: the marker identifies a specific row.",
	)
	.action(
		async (
			assignments: string[],
			opts: { project: string; expectedUpdatedAt?: string },
		) => {
			try {
				// Same rule as `naming move`: one marker guards one row, so applying
				// it across a batch would reject a legitimate write.
				if (opts.expectedUpdatedAt && assignments.length !== 1) {
					throw new Error(
						`--expected-updated-at guards a single candidate, but ${assignments.length} assignments were given. Each candidate has its own marker. Rank the guarded one on its own.`,
					)
				}
				const operations = assignments.map((assignment) => {
					const separator = assignment.lastIndexOf("=")
					if (separator <= 0) {
						throw new Error(`Invalid rank assignment "${assignment}".`)
					}
					return {
						candidateId: assignment.slice(0, separator),
						rank: Number(assignment.slice(separator + 1)),
						...(opts.expectedUpdatedAt !== undefined
							? { expectedUpdatedAt: opts.expectedUpdatedAt }
							: {}),
					}
				})
				jsonOutput(
					await patchNamingCandidates({ projectId: opts.project, operations }),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

naming
	.command("research-context")
	.description(
		"Read the brief, board, evidence, capabilities, and small-task handoff contract for an orchestrator.",
	)
	.requiredOption("--project <uuid>", "Project id.")
	.action(async (opts: { project: string }) => {
		try {
			jsonOutput(await getNamingResearchContext(opts.project))
		} catch (err) {
			fail(err)
		}
	})

naming
	.command("search")
	.description(
		`Execute model-authored evidence queries (${NAME_RESEARCH_PURPOSES.join(
			", ",
		)}); Identity Forge returns results, not verdicts. Each query uses one account-wide monthly unit.`,
	)
	.requiredOption(
		"--file <path>",
		'JSON task array or {"tasks":[...]}; use - to read stdin.',
	)
	.action(async (opts: { file: string }) => {
		try {
			jsonOutput(
				await searchNameEvidence({ tasks: readResearchTasks(opts.file) }),
			)
		} catch (err) {
			fail(err)
		}
	})

naming
	.command("domains")
	.description(
		"Check low-level DNS, RDAP, registrar, optional landing-page, and optional SERP evidence. No DNS records alone never establish availability.",
	)
	.argument("<domains...>", "One to 20 bare domain names.")
	.option("--serp", "Include bounded SERP collision signals.")
	.option(
		"--registrar",
		"Include registrar evidence alongside DNS and RDAP, which is the closest this gets to an availability answer.",
	)
	.option("--market <market>", "Market context for the SERP query.")
	.option("--language <tag>", "Search language tag, e.g. de-DE.")
	.option(
		"--intent <intent>",
		"Acquisition intent: new_registration, aftermarket, or either. Default new_registration; aftermarket adds 1 unit per domain.",
		"new_registration",
	)
	.action(
		async (
			domains: string[],
			opts: {
				serp?: boolean
				registrar?: boolean
				market?: string
				language?: string
				intent: string
			},
		) => {
			try {
				jsonOutput(
					await checkDomains({
						domains,
						includeSerp: Boolean(opts.serp),
						includeRegistrar: Boolean(opts.registrar),
						acquisitionIntent: oneOf(
							opts.intent,
							["new_registration", "aftermarket", "either"] as const,
							"intent",
						),
						market: opts.market,
						language: opts.language,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

naming
	.command("acquisition")
	.description(
		"Assess a stated new-registration or aftermarket acquisition path, keeping registrar and public landing-page evidence separate.",
	)
	.argument("<domains...>", "One to 20 bare domain names.")
	.requiredOption(
		"--intent <intent>",
		"new_registration, aftermarket, or either.",
	)
	.option("--serp", "Add market-collision search evidence.")
	.option("--market <market>", "Market context for the SERP query.")
	.option("--language <tag>", "Search language tag, e.g. de-DE.")
	.action(
		async (
			domains: string[],
			opts: {
				intent: string
				serp?: boolean
				market?: string
				language?: string
			},
		) => {
			try {
				const intent = oneOf(
					opts.intent,
					["new_registration", "aftermarket", "either"] as const,
					"intent",
				)
				jsonOutput(
					await checkDomains({
						domains,
						includeSerp: Boolean(opts.serp),
						includeRegistrar: intent !== "aftermarket",
						acquisitionIntent: intent,
						market: opts.market,
						language: opts.language,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

program
	.command("install")
	.description("Write the Identity Forge MCP config into a coding agent.")
	.requiredOption(
		"-c, --client <client>",
		`Target client: ${SUPPORTED_CLIENTS.join(" | ")}.`,
	)
	.option(
		"--api-url <url>",
		"Bake an API base into the server env (for dev/self-host).",
	)
	.action(async (opts: { client: string; apiUrl?: string }) => {
		try {
			const client = oneOf(opts.client, SUPPORTED_CLIENTS, "client") as Client
			const file = installClient(client, {
				apiUrl: opts.apiUrl,
			})
			const mcp = await inspectCurrentMcp()
			if (mcp.missingRequiredTools.length > 0) {
				throw new Error(
					`MCP initialization succeeded, but required tools are missing: ${mcp.missingRequiredTools.join(
						", ",
					)}.`,
				)
			}
			process.stdout.write(
				`Configured and verified Identity Forge MCP ${mcp.version} (${mcp.toolCount} tools) for ${opts.client}:\n  ${file}\n\nRestart the agent to pick it up, then sign in with:\n  npx --yes ${CLI_PACKAGE_SPEC} login\n`,
			)
		} catch (err) {
			fail(err)
		}
	})

program
	.command("doctor")
	.description(
		"Verify an agent's Identity Forge configuration and initialize this package's MCP server without spending quota.",
	)
	.requiredOption(
		"-c, --client <client>",
		`Client to inspect: ${SUPPORTED_CLIENTS.join(" | ")}.`,
	)
	.action(async (opts: { client: string }) => {
		try {
			const client = oneOf(opts.client, SUPPORTED_CLIENTS, "client") as Client
			const config = inspectClientConfig(client)
			const mcp = await inspectCurrentMcp()
			jsonOutput({
				ok: config.current && mcp.missingRequiredTools.length === 0,
				config,
				mcp,
			})
			if (!config.current || mcp.missingRequiredTools.length > 0)
				process.exitCode = 1
		} catch (err) {
			fail(err)
		}
	})

program
	.command("update-check")
	.description(
		"Check npm now and report whether this CLI/MCP package has a newer release. The normal startup check remains non-blocking.",
	)
	.action(async () => {
		try {
			jsonOutput(await getUpdateStatus(CLI_VERSION))
		} catch (err) {
			fail(err)
		}
	})

program
	.command("login")
	.description(
		"Open a browser to sign in. New accounts select Send verification email before approval; PKCE returns the key to this machine.",
	)
	.option(
		"-k, --key <ifk_…>",
		"Store an API key directly (create one at /account/api-keys).",
	)
	.option(
		"--api-url <url>",
		"Use a non-default API base (e.g. http://localhost:4000).",
	)
	.action(async (opts: { key?: string; apiUrl?: string }) => {
		if (opts.apiUrl) updateConfig({ apiUrl: opts.apiUrl.replace(/\/+$/, "") })
		if (opts.key) {
			if (!opts.key.startsWith("ifk_")) {
				fail(
					new Error("API keys start with 'ifk_'. Check the value and retry."),
				)
			}
			updateConfig({ apiKey: opts.key })
			process.stdout.write(
				`Saved API key ${maskKey(opts.key)} to ${CONFIG_PATH}.\n`,
			)
			return
		}
		// Default: browser sign-in via PKCE loopback. `--key` above is the headless
		// fallback (create a key at /account/api-keys and paste it).
		try {
			const { apiKey, account } = await browserLogin()
			updateConfig({ apiKey, account: account ?? undefined })
			process.stdout.write(
				`\nConnected${
					account ? ` as ${account}` : ""
				}.\nSaved API key ${maskKey(apiKey)} to ${CONFIG_PATH}.\n`,
			)
		} catch (err) {
			process.stderr.write(
				`\n${
					err instanceof Error ? err.message : String(err)
				}\n\nIf this machine has no browser, ask the human to open ${resolveApiUrl()}/account/api-keys. For a new account, they must use Send verification email and open its link before creating a key. Then run:\n  identityforge login --key ifk_…\n`,
			)
			process.exit(1)
		}
	})

program
	.command("whoami")
	.alias("usage")
	.description(
		"Show what this key can actually do: plan, scopes it holds and lacks, quota left, AI credits, and saved-kit slots. Asks the server, so it also tells you whether the key still works. Free: it spends no quota and no credits, and still answers when you are over quota.",
	)
	.action(async () => {
		const key = resolveApiKey()
		if (!key) {
			process.stdout.write(
				"Not connected. Run `identityforge login` to connect your account.\n",
			)
			return
		}
		const cfg = readConfig()
		const local = `Key:     ${maskKey(
			key,
		)}\nAPI:     ${resolveApiUrl()}\nConfig:  ${CONFIG_PATH}\n`
		let me: Awaited<ReturnType<typeof getMe>>
		try {
			me = await getMe()
		} catch (err) {
			// Local facts are still worth printing when the server cannot be
			// reached or the key has been revoked: they are what the user needs to
			// debug either case. The error says which one it was.
			process.stdout.write(local)
			process.stderr.write(
				`\nCould not reach the server for entitlements: ${
					err instanceof ApiError
						? `${err.status} ${err.message}`
						: err instanceof Error
							? err.message
							: String(err)
				}\n`,
			)
			process.exit(1)
		}
		const quota =
			me.quota.limit == null
				? `${me.quota.used} units used (unmetered account)`
				: `${me.quota.used} of ${me.quota.limit} units used, ${me.quota.remaining} left, resets ${me.quota.resetsAt}`
		const kits =
			me.kits.limit == null
				? `${me.kits.saved} saved (no limit)`
				: `${me.kits.saved} of ${me.kits.limit} saved, ${me.kits.remaining} slot(s) left`
		process.stdout.write(
			`${local}Account: ${cfg.account ?? "(not stored locally)"}\nPlan:    ${
				me.plan.tier
			}\nScopes:  ${
				me.scopes.granted.join(", ") || "(none)"
			}\nQuota:   ${quota}\nCredits: ${
				me.credits.unlimited ? "unlimited" : me.credits.total
			}\nKits:    ${kits}\n`,
		)
		if (me.scopes.missing.length > 0) {
			process.stdout.write(
				`\nNot granted: ${me.scopes.missing
					.map((scope) => scope.id)
					.join(", ")}\n${me.scopes.fix ?? ""}\n`,
			)
		}
	})

program
	.command("logout")
	.description("Remove stored credentials from this machine.")
	.action(() => {
		updateConfig({ apiKey: undefined, account: undefined })
		process.stdout.write("Logged out. Stored credentials removed.\n")
	})

// The composition half of the brand surface, and the reversible/irreversible
// pair for a client link. All five were MCP-only. `brand share` created and
// rotated a link and nothing could pause or withdraw one, which is the same
// hole that was closed on the MCP side and left open here.

brand
	.command("get")
	.description(
		"Read one brand project in full: its kit, name and domain, variations, pinned layers and share state. `brand projects` lists; this is the single read you hand an id to.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.action(async (opts: { project: string }) => {
		try {
			jsonOutput(await getBrandProject(opts.project))
		} catch (err) {
			fail(err)
		}
	})

brand
	.command("layers")
	.description(
		"Read the catalogue records pinned onto a project alongside its design kit: image direction, interface style and page recipes. Each pin records the revision it was made at, so this also reports when a record has moved since — which is what stops somebody else's edit being applied to a client's brand without anyone seeing it.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.action(async (opts: { project: string }) => {
		try {
			jsonOutput(await getBrandLayers({ projectId: opts.project }))
		} catch (err) {
			fail(err)
		}
	})

// The composed read. `brand layers` answers what is pinned; this answers what
// the brand IS, as the one document you hand to a build. Until it existed the
// only way to get that was four calls and a merge the caller had to invent.
brand
	.command("export")
	.description(
		"Print the brand as ONE document: its design kit's DESIGN.md with every pinned catalogue layer written into it, under the precedence rule that says which wins — the kit owns identity, a layer owns application. This is what you give a coding agent or paste into a repo. A layer your key cannot open is NAMED with its page and an upgrade path rather than dropped, so the document never pretends the brand is simpler than it is. A brand that has not chosen a kit answers 409: there is no design system to export yet, and a placeholder nobody picked must not end up in your repository. Read-only, writes nothing, mints no version.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.action(async (opts: { project: string }) => {
		try {
			const result = await exportBrandProject({ projectId: opts.project })
			process.stdout.write(
				result.body.endsWith("\n") ? result.body : `${result.body}\n`,
			)
			// The stamp goes to stderr so stdout stays a clean document that can be
			// redirected straight into a file.
			const kit = result.kitSlug
				? `${result.kitSlug}${
						result.kitVersion ? ` v${result.kitVersion}` : ""
					}`
				: "unknown kit"
			process.stderr.write(
				`Composed ${result.layerCount} layer(s) onto ${kit}.\n`,
			)
		} catch (err) {
			fail(err)
		}
	})

brand
	.command("add-layer")
	.description(
		"Pin one catalogue record onto a brand project, so the choice lives on the brand rather than in a conversation. Layers belong to the PROJECT, not the kit, so swapping the kit later leaves them alone. imageDirection and interfaceStyle hold one each and a second is refused with 409 unless you pass --replace; page recipes accumulate. This overwrites live brand state and mints a version recording that your key did it.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption(
		"--axis <axis>",
		`Which axis: ${COLLECTION_LAYER_AXES.join(", ")}.`,
	)
	.requiredOption(
		"--record <id>",
		"The record's PERMANENT id, never its slug. A slug is a mutable handle and a pin keyed on one could come to mean a different record.",
	)
	.option(
		"--replace",
		"Replace the record already on this axis, or accept a drifted revision after seeing what changed.",
	)
	.action(
		async (opts: {
			project: string
			axis: string
			record: string
			replace?: boolean
		}) => {
			try {
				jsonOutput(
					await addBrandLayer({
						projectId: opts.project,
						axis: oneOf(opts.axis, COLLECTION_LAYER_AXES, "axis"),
						recordId: opts.record,
						replace: opts.replace,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

brand
	.command("remove-layer")
	.description(
		"Unpin one catalogue record from a brand project. The record itself is untouched and can be pinned again, so unlike remove-variation this loses nothing but the choice.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.requiredOption(
		"--axis <axis>",
		`Which axis: ${COLLECTION_LAYER_AXES.join(", ")}.`,
	)
	.requiredOption(
		"--record <id>",
		"The record's permanent id, from `brand layers`.",
	)
	.option(
		"--yes",
		"Confirm removing this composed record. Required because the change is immediate and cannot be undone.",
	)
	.action(
		async (opts: {
			project: string
			axis: string
			record: string
			yes?: boolean
		}) => {
			try {
				if (!opts.yes) {
					throw new Error(
						`Refusing to remove layer ${opts.record} from ${opts.project}: this change is immediate and cannot be undone. Re-run with --yes once you are sure. Nothing was removed.`,
					)
				}
				jsonOutput(
					await removeBrandLayer({
						projectId: opts.project,
						axis: oneOf(opts.axis, COLLECTION_LAYER_AXES, "axis"),
						recordId: opts.record,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

brand
	.command("update-share")
	.description(
		"Change an existing client link WITHOUT reissuing it. --disable pauses it so the client sees nothing until you resume; --password sets one after the fact and --clear-password removes it. The token is untouched, so a URL already with the client works again the moment you resume. Takes effect immediately, including for a client with the page open. This is the REVERSIBLE one and it is almost always what you want; a project with no share yet answers 404, so create one with `brand share` first.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.option(
		"--disable",
		"Pause the link. The client sees nothing until you resume.",
	)
	.option("--enable", "Resume a paused link.")
	.option("--password <password>", "Set or change the password.")
	.option("--clear-password", "Remove the password, leaving the link open.")
	.action(
		async (opts: {
			project: string
			disable?: boolean
			enable?: boolean
			password?: string
			clearPassword?: boolean
		}) => {
			try {
				if (opts.disable && opts.enable) {
					throw new Error(
						"--disable and --enable contradict each other. Pass one.",
					)
				}
				if (opts.password != null && opts.clearPassword) {
					throw new Error(
						"--password and --clear-password contradict each other. Pass one.",
					)
				}
				const enabled = opts.disable ? false : opts.enable ? true : undefined
				// `null` REMOVES the password and `undefined` leaves it alone. Collapsing
				// the two would silently strip a password off a live client link.
				const password = opts.clearPassword ? null : opts.password
				if (enabled === undefined && password === undefined) {
					throw new Error(
						"Nothing to change. Pass --disable, --enable, --password or --clear-password.",
					)
				}
				jsonOutput(
					await updateBrandShare({
						projectId: opts.project,
						enabled,
						password,
					}),
				)
			} catch (err) {
				fail(err)
			}
		},
	)

brand
	.command("revoke-share")
	.description(
		"Withdraw the client's access PERMANENTLY. The /p/<token> URL stops resolving wherever it was pasted, including in an email already sent, and sharing again mints a new token and deliberately never the old one. Not undoable. Reach for `brand update-share --disable` instead when the client should see it again later. Revoking is for a link that leaked or an engagement that ended. The project, its variations and the comments the client already left all survive; only the access is withdrawn.",
	)
	.requiredOption("--project <uuid>", "Brand project id.")
	.option(
		"--yes",
		"Confirm. Required, because the URL dies wherever it was already pasted and cannot be brought back.",
	)
	.action(async (opts: { project: string; yes?: boolean }) => {
		try {
			// Refuse-by-default, the same shape as `brand remove-variation`. The API
			// asks for no confirmation, and this one reaches OUTSIDE the account: a
			// mistyped id kills a link that is already in a client's inbox.
			if (!opts.yes) {
				throw new Error(
					`Refusing to revoke the share on ${opts.project}: the /p/<token> URL dies everywhere it was already pasted and a new share can never reissue the old token. Use \`brand update-share --disable\` if the client should see it again later. Re-run with --yes once you are sure. Nothing was revoked.`,
				)
			}
			jsonOutput(await revokeBrandShare(opts.project))
		} catch (err) {
			fail(err)
		}
	})

program.parseAsync(process.argv).catch(fail)
