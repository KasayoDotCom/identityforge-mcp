import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import {
	exportKit,
	isSafeExportFilename,
	recordApplyCompleted,
} from "./api.js"

// Applying a kit writes into someone else's repository, so it is the one place
// in this CLI that can destroy work. The rule here: never overwrite a file we
// cannot prove we wrote ourselves. Proof lives in the stamp.

/** Token formats `apply` can write alongside DESIGN.md. */
export const APPLY_TOKENS_FORMATS = [
	"dtcg",
	"css",
	"tailwind-v3",
	"tailwind-v4",
	"shadcn-registry",
] as const
export type ApplyTokensFormat = (typeof APPLY_TOKENS_FORMATS)[number]

export const DESIGN_FILENAME = "DESIGN.md"

/** Written at the root of the target directory. It belongs to the CONSUMING
 *  repo, not to the kit, because it records what that repo was built against:
 *  a fact the server cannot know. Without it a delta has no baseline and an
 *  agent arriving later knows what the kit is now and not what it was then. */
export const STAMP_FILENAME = "identityforge.json"

export interface StampArtifact {
	/** Relative to the stamp, POSIX separators, so the stamp survives a clone. */
	path: string
	/** `sha256:<hex>` over the exact bytes written. */
	hash: string
	writtenAt: string
}

/** A composition layer applied on top of the kit. Empty until composition
 *  ships; the shape is fixed now so the stamp does not change meaning later. */
export interface StampLayer {
	axis: string
	id: string
	revision?: string
}

/**
 * Shape version of the stamp itself, not of any kit.
 *
 * A reader must be able to tell "a field I need is missing" from "this stamp
 * predates that field", and it cannot do that by inspecting the fields. Bump
 * this whenever the meaning or shape of anything below changes, and leave a
 * reader free to refuse a number it does not know rather than guessing.
 */
export const STAMP_VERSION = 1

export interface ApplyStamp {
	/** Shape of this file. See {@link STAMP_VERSION}. Always written. */
	stampVersion: number
	/**
	 * The shape of the DESIGN.md this repo was built against, as its front matter
	 * stated it. NOT the kit's revision and not this file's: three different
	 * versions live in this stamp and flattening any two of them produces a false
	 * baseline. Omitted when the export predates the field, which is how a reader
	 * tells an old server from a missing value.
	 */
	designMdContract?: string
	/** Omitted entirely for a kit-only apply. No code path populates it yet:
	 *  brands are not versioned server-side. */
	brand?: { id?: string; version?: string; contentHash?: string }
	/**
	 * The SERVER's identity for the kit, copied out of the export's front matter
	 * rather than derived here. `null` in `id` or `version` means the export did
	 * not state one; it is never a placeholder for a value we could have looked
	 * up, and specifically `version: null` must never be read as `0`.
	 *
	 * `contentHash` is `subject_versions.content_hash`, minted server-side over a
	 * projection that excludes mutable aliases and prefixed `v1:`. Still absent:
	 * no export carries it. Declared so filling it stays additive.
	 *
	 * `designMdDigest` is ours and is NOT that hash. Never compare the two.
	 */
	kit: {
		/** Opaque permanent id. The durable handle: diff against this, not slug. */
		id: string | null
		slug: string
		/**
		 * The kit record's monotonic `current_version` as the export reported it.
		 * `0` is a real value meaning the kit exists and has no minted version
		 * yet; `null` means the export did not report one at all. The two are
		 * different facts and a reader must not flatten them.
		 */
		version: number | null
		contentHash?: string
		/**
		 * sha256 over the bytes of the rendered DESIGN.md export, computed
		 * locally. It tracks the rendered ARTIFACT, not the design: changing
		 * `buildDesignMd` moves this digest for every kit without any kit having
		 * changed, so treat a move as "re-read the brief", not as proof the kit
		 * was edited. Now that `version` exists it is the weaker signal of the
		 * two, and it is the only one available when `version` is null.
		 */
		designMdDigest?: string
	}
	layers: StampLayer[]
	artifacts: StampArtifact[]
	/** Advisory and caller supplied: where the tokens file is wired into the
	 *  app. Nothing is written to that path. */
	integration: { tokensEntry: string | null }
	appliedAt: string
}

export type ArtifactStatus = "create" | "update" | "unchanged" | "conflict"
export type ConflictReason = "untracked" | "modified" | "unreadable"

export interface PlannedArtifact {
	/** Absolute path on disk. */
	path: string
	/** Path as the stamp records it. */
	relPath: string
	status: ArtifactStatus
	conflictReason?: ConflictReason
	/** Content that would be written. */
	body: string
	/** Hash of `body`. */
	hash: string
	/** Hash of what is on disk now, when the file exists and could be read. */
	currentHash?: string
	/** Hash the prior stamp recorded for this path, when it recorded one. */
	stampedHash?: string
	/** Carried forward for an unchanged file so its record keeps its history. */
	writtenAt?: string
}

export type ApplyMode = "preview" | "applied" | "refused"

export interface ApplyResult {
	mode: ApplyMode
	slug: string
	tokensFormat: ApplyTokensFormat
	/** Absolute target directory. */
	dir: string
	stampPath: string
	artifacts: PlannedArtifact[]
	conflicts: PlannedArtifact[]
	/** Written despite a conflict. Their previous content is gone. */
	overwritten: PlannedArtifact[]
	/** Facts the caller should hear: kit drift, a different kit last time, a
	 *  stamp that could not be read. */
	notes: string[]
	/** The stamp as written. Absent for `preview` and `refused`. */
	stamp?: ApplyStamp
}

export interface ApplyThemeOptions {
	slug: string
	dir: string
	tokensFormat: ApplyTokensFormat
	/** Plan only: read and fetch, write nothing at all. */
	preview?: boolean
	/** Write over conflicting files, destroying their current content. */
	force?: boolean
	/** Advisory note for the stamp. Carried forward when omitted. */
	tokensEntry?: string
}

export function hashContent(content: string | Buffer): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`
}

function shortHash(hash: string): string {
	return hash.startsWith("sha256:") ? `${hash.slice(0, 19)}...` : hash
}

function toRelPath(dir: string, path: string): string {
	return relative(dir, path).split(sep).join("/")
}

/**
 * The tokens filename originates in a `Content-Disposition` header, and when
 * that header is unusable `api.ts` derives one from the slug instead, which is
 * caller supplied. Refuse loudly rather than quietly rewriting the name: a path
 * that is not a plain filename means something upstream is wrong, and silently
 * writing somewhere else is how a traversal turns into a surprise.
 */
function assertSafeArtifactName(filename: string): string {
	if (!isSafeExportFilename(filename)) {
		throw new Error(
			`Refusing to write the tokens file: "${filename}" is not a plain filename, so it cannot be placed safely inside the target directory. Nothing was written.`,
		)
	}
	return filename
}

/**
 * Resolve a path inside `dir` and prove it stayed there. This is the check that
 * holds regardless of how the name was formed: a hostile Content-Disposition, a
 * traversing slug feeding the fallback filename, or a symlinked separator all
 * fail here rather than writing outside the directory the caller named.
 */
function containedPath(dir: string, filename: string): string {
	const path = resolve(dir, filename)
	const rel = relative(dir, path)
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(
			`Refusing to write "${filename}": it resolves to ${path}, outside the target directory ${dir}. Nothing was written.`,
		)
	}
	return path
}

/** What the export said about itself. `null` means the export did not say. */
export interface ExportIdentity {
	id: string | null
	version: number | null
	slug: string | null
	/**
	 * The SHAPE of the DESIGN.md that was read, not the kit's revision.
	 *
	 * A repo built against contract 1.0 that later sees 2.0 knows the document
	 * itself changed and its parse may no longer hold — a question `version` and
	 * `designMdDigest` both fail to answer, the first because the kit can be
	 * untouched while the shape moves, the second because it moves on any
	 * cosmetic change too. `null` means the export predates the field.
	 */
	contract: string | null
}

const NO_IDENTITY: ExportIdentity = {
	id: null,
	version: null,
	slug: null,
	contract: null,
}
const FRONT_MATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/
const IDENTITY_LINE = /^ {2}(id|version|slug): (.+)$/
// Top level, so it cannot collide with the two-space keys inside `kit:`.
const CONTRACT_LINE = /^contract: (.+)$/

/**
 * Read the kit's identity out of a DESIGN.md export.
 *
 * Deliberately not a YAML parser. The front matter is emitted by our own
 * serializer in a fixed shape (`designMdFrontMatter` in src/lib/designKits.ts),
 * so four lines of it are cheaper and more predictable to read directly than a
 * dependency that would also happily interpret the rest of the document. The
 * scan is bounded to the `kit:` block inside the front matter so that a token,
 * a colour name or a prose line further down cannot be mistaken for identity.
 *
 * Anything it cannot read comes back null, because a stamp that says "unknown"
 * is true and a stamp that guesses is a false baseline in someone's repository.
 */
/** `yamlQuote` escapes only the double quote, so that is all there is to undo. */
function unquote(raw: string): string {
	const quoted = /^"([\s\S]*)"$/.exec(raw)
	return quoted ? quoted[1].replace(/\\"/g, '"') : raw
}

export function parseExportIdentity(designMd: string): ExportIdentity {
	const front = FRONT_MATTER.exec(designMd)
	if (!front) return { ...NO_IDENTITY }
	const lines = front[1].split("\n")

	// FIRST match, for the same reason the kit block honours its first match: a
	// caller-supplied kit `name` can inject lines into this front matter, and the
	// server emits `contract` above `kit:` and therefore above `name`, so an
	// injected duplicate always arrives too late to be the one that is read.
	const contractLine = lines.find((line) => CONTRACT_LINE.test(line))
	const contract = contractLine
		? unquote(CONTRACT_LINE.exec(contractLine)?.[1].trim() ?? "")
		: null

	const start = lines.indexOf("kit:")
	if (start === -1) return { ...NO_IDENTITY, contract }

	const identity: ExportIdentity = { ...NO_IDENTITY, contract }
	// Tracked separately from the values, because "the server said null" has to
	// beat a later line just as firmly as "the server said 3" does. Keying off
	// the value alone would leave an explicit null open to being overwritten.
	const seen = new Set<keyof ExportIdentity>()
	for (const line of lines.slice(start + 1)) {
		// The block ends at the next top-level key. Comments and deeper nesting
		// simply do not match below.
		if (/^\S/.test(line)) break
		const match = IDENTITY_LINE.exec(line)
		if (!match) continue
		const field = match[1] as keyof ExportIdentity
		// FIRST occurrence wins, and this is load bearing. `yamlQuote` escapes the
		// double quote and nothing else, so a kit `name` containing a newline —
		// and a name is caller supplied through create_theme / update_theme —
		// injects whatever lines it likes into this block. The server emits id,
		// version and slug BEFORE name, so honouring the first value makes an
		// injected duplicate arrive too late to matter. Taking the last would let
		// a crafted kit name write a false version into someone's repository.
		if (seen.has(field)) continue
		seen.add(field)
		const raw = match[2].trim()
		// A literal `null` is the export stating it does not know. Leave ours null.
		if (raw === "null") continue
		if (field === "version") {
			const value = Number(raw)
			// Only an integer is a version. A float or NaN means the shape moved
			// and reading it as a number would invent a baseline.
			if (Number.isInteger(value)) identity.version = value
			continue
		}
		const value = unquote(raw)
		if (field === "id") identity.id = value
		else identity.slug = value
	}
	return identity
}

function readStamp(stampPath: string): {
	stamp: ApplyStamp | null
	note?: string
} {
	if (!existsSync(stampPath)) return { stamp: null }
	const unreadable = {
		stamp: null,
		note: `${STAMP_FILENAME} exists but is not a readable Identity Forge stamp, so every file already on disk counts as unrecorded.`,
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(stampPath, "utf8"))
	} catch {
		return unreadable
	}
	if (typeof parsed !== "object" || parsed === null) return unreadable
	const stamp = parsed as ApplyStamp
	if (!Array.isArray(stamp.artifacts) || typeof stamp.kit !== "object") {
		return unreadable
	}
	// A stamp written by a NEWER CLI may record artifacts under rules this one
	// does not know, and the artifact records are what stand between an apply
	// and someone's edited file. Fail closed: treat it as unreadable, which
	// makes every file count as unrecorded and turns the apply into a refusal
	// rather than a silent overwrite based on a half-understood record.
	if (typeof stamp.stampVersion === "number") {
		if (stamp.stampVersion > STAMP_VERSION) {
			return {
				stamp: null,
				note: `${STAMP_FILENAME} was written by a newer Identity Forge CLI (stamp version ${stamp.stampVersion}, this CLI understands ${STAMP_VERSION}), so its records are not safe to act on. Upgrade the CLI. Until then every file on disk counts as unrecorded.`,
			}
		}
	} else {
		// Missing means it predates versioning. Its artifact records still mean
		// exactly what they mean now, so honour them: refusing here would turn a
		// harmless upgrade into a conflict on every previously applied file.
		return {
			stamp,
			note: `${STAMP_FILENAME} predates stamp versioning, so it records no kit id or version. This apply rewrites it with both, and the next one can report drift properly.`,
		}
	}
	return { stamp }
}

/**
 * The conflict rule, in order:
 *   1. the file is absent               -> create
 *   2. the file cannot be read          -> conflict (unreadable)
 *   3. it already holds the exact bytes -> unchanged, nothing to write or lose
 *   4. no stamp record for this path    -> conflict (untracked)
 *   5. stamp record disagrees with disk -> conflict (modified)
 *   6. otherwise                        -> update, we wrote it and it is ours
 */
function planArtifact(
	dir: string,
	filename: string,
	body: string,
	priorStamp: ApplyStamp | null,
): PlannedArtifact {
	const path = containedPath(dir, filename)
	const relPath = toRelPath(dir, path)
	const hash = hashContent(body)
	const stamped = priorStamp?.artifacts.find((entry) => entry.path === relPath)
	const base = { path, relPath, body, hash, stampedHash: stamped?.hash }

	if (!existsSync(path)) return { ...base, status: "create" }

	let currentHash: string
	try {
		currentHash = hashContent(readFileSync(path))
	} catch {
		return { ...base, status: "conflict", conflictReason: "unreadable" }
	}
	if (currentHash === hash) {
		return {
			...base,
			status: "unchanged",
			currentHash,
			writtenAt: stamped?.hash === currentHash ? stamped.writtenAt : undefined,
		}
	}
	if (!stamped) {
		return {
			...base,
			status: "conflict",
			conflictReason: "untracked",
			currentHash,
		}
	}
	if (stamped.hash !== currentHash) {
		return {
			...base,
			status: "conflict",
			conflictReason: "modified",
			currentHash,
		}
	}
	return { ...base, status: "update", currentHash }
}

/**
 * What changed since the last apply, in order of how much the answer is worth.
 *
 * A version move is the server's own count and settles the question. The
 * DESIGN.md digest is only a proxy: it also moves when the serializer changes,
 * so it is reported as a question rather than a finding, and the version is used
 * to answer that question whenever both applies recorded one.
 */
function driftNotes(
	prior: ApplyStamp,
	requested: string,
	identity: ExportIdentity,
	designMdDigest: string,
): string[] {
	const priorId = prior.kit?.id ?? null
	// Compare ids when both sides carry one. A slug is renameable, so a slug
	// mismatch on its own is not evidence that the kit differs.
	const differentKit =
		priorId && identity.id
			? priorId !== identity.id
			: Boolean(prior.kit?.slug && prior.kit.slug !== requested)
	if (differentKit) {
		return [
			`This directory was last applied from kit "${prior.kit?.slug}"${
				priorId ? ` (id ${priorId})` : ""
			}, not "${identity.slug ?? requested}"${
				identity.id ? ` (id ${identity.id})` : ""
			}.`,
		]
	}

	const priorVersion = prior.kit?.version
	const bothVersioned =
		typeof priorVersion === "number" && typeof identity.version === "number"
	if (bothVersioned && priorVersion !== identity.version) {
		return [
			`The kit moved from version ${priorVersion} to ${identity.version} since the last apply. That is the server's own count, so the kit itself changed; re-read the brief.`,
		]
	}

	if (
		prior.kit?.designMdDigest &&
		prior.kit.designMdDigest !== designMdDigest
	) {
		return [
			bothVersioned
				? `The rendered DESIGN.md changed but the kit is still version ${identity.version}, so the serializer changed rather than the kit.`
				: `The rendered DESIGN.md changed since the last apply: applied from ${shortHash(
						prior.kit.designMdDigest,
					)}, it now renders as ${shortHash(
						designMdDigest,
					)}. No version was recorded on both sides, so this cannot tell you whether the kit moved or only the serializer did. Read the brief.`,
		]
	}
	return []
}

/**
 * Fetch a kit and write it into `dir`, refusing rather than destroying local
 * work. Everything is computed before anything is written, so a failed fetch
 * or an unplannable file leaves the target directory untouched.
 */
export async function applyTheme(
	options: ApplyThemeOptions,
): Promise<ApplyResult> {
	const dir = resolve(options.dir)
	const stampPath = join(dir, STAMP_FILENAME)
	const notes: string[] = []

	const { stamp: priorStamp, note: stampNote } = readStamp(stampPath)
	if (stampNote) notes.push(stampNote)

	// Both fetches complete before the first write, so a 403 or a network
	// failure on the second export cannot leave a half-applied repo.
	const [design, tokens] = await Promise.all([
		exportKit(options.slug, "design-md"),
		exportKit(options.slug, options.tokensFormat),
	])

	const tokensName = assertSafeArtifactName(tokens.filename)
	if (tokensName === STAMP_FILENAME || tokensName === DESIGN_FILENAME) {
		throw new Error(
			`The tokens file for "${
				options.slug
			}" would be written to ${tokensName}, which collides with the ${
				tokensName === STAMP_FILENAME ? "stamp" : "design brief"
			}. Nothing was written. Choose another tokens format.`,
		)
	}

	const designMdDigest = hashContent(design.body)
	const identity = parseExportIdentity(design.body)
	if (priorStamp) {
		notes.push(
			...driftNotes(priorStamp, options.slug, identity, designMdDigest),
		)
	}

	const artifacts = [
		planArtifact(dir, DESIGN_FILENAME, design.body, priorStamp),
		planArtifact(dir, tokensName, tokens.body, priorStamp),
	]
	const conflicts = artifacts.filter(
		(artifact) => artifact.status === "conflict",
	)

	const result: ApplyResult = {
		mode: "preview",
		slug: options.slug,
		tokensFormat: options.tokensFormat,
		dir,
		stampPath,
		artifacts,
		conflicts,
		overwritten: [],
		notes,
	}

	if (options.preview) return result
	if (conflicts.length > 0 && !options.force) {
		return { ...result, mode: "refused" }
	}

	const appliedAt = new Date().toISOString()
	const overwritten: PlannedArtifact[] = []
	for (const artifact of artifacts) {
		if (artifact.status === "unchanged") continue
		writeFileSync(artifact.path, artifact.body, "utf8")
		if (artifact.status === "conflict") overwritten.push(artifact)
	}

	// Artifacts written by an earlier apply and untouched by this one keep their
	// records, so switching tokens format does not turn the previous tokens file
	// into an unrecorded stranger on the next run.
	const writtenPaths = new Set(artifacts.map((artifact) => artifact.relPath))
	const carried = (priorStamp?.artifacts ?? []).filter(
		(entry) => !writtenPaths.has(entry.path),
	)
	const stamp: ApplyStamp = {
		stampVersion: STAMP_VERSION,
		// Omitted rather than null when the export did not state one, so a reader
		// can tell "built against a server that predates the contract" from "the
		// contract was read and was empty".
		...(identity.contract ? { designMdContract: identity.contract } : {}),
		kit: {
			id: identity.id,
			// What the server calls this kit, not what the caller typed: `apply`
			// accepts a permanent id, and stamping that as the slug would record a
			// handle no human reading the file can use.
			slug: identity.slug ?? options.slug,
			version: identity.version,
			designMdDigest,
		},
		layers: [],
		artifacts: [
			...carried,
			...artifacts.map((artifact) => ({
				path: artifact.relPath,
				hash: artifact.hash,
				writtenAt: artifact.writtenAt ?? appliedAt,
			})),
		].sort((a, b) => a.path.localeCompare(b.path)),
		integration: {
			tokensEntry:
				options.tokensEntry ?? priorStamp?.integration?.tokensEntry ?? null,
		},
		appliedAt,
	}
	writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, "utf8")
	await recordApplyCompleted(identity.slug ?? options.slug)

	return { ...result, mode: "applied", overwritten, stamp }
}

const CONFLICT_EXPLANATIONS: Record<
	ConflictReason,
	(artifact: PlannedArtifact) => string
> = {
	untracked: () =>
		`exists on disk and is not recorded in ${STAMP_FILENAME}, so no previous apply wrote it`,
	modified: (artifact) =>
		`changed after it was applied: ${STAMP_FILENAME} recorded ${shortHash(
			artifact.stampedHash ?? "",
		)}, the file is now ${shortHash(artifact.currentHash ?? "")}`,
	unreadable: () =>
		"exists but could not be read, so there is no way to tell whether it holds local work",
}

function describeConflict(artifact: PlannedArtifact): string {
	const explain = CONFLICT_EXPLANATIONS[artifact.conflictReason ?? "untracked"]
	return `  ${artifact.relPath}: ${explain(artifact)}`
}

const PLAN_LABELS: Record<ArtifactStatus, string> = {
	create: "create   ",
	update: "overwrite",
	unchanged: "unchanged",
	conflict: "CONFLICT ",
}

const APPLIED_LABELS: Record<ArtifactStatus, string> = {
	create: "created  ",
	update: "updated  ",
	unchanged: "unchanged",
	conflict: "forced   ",
}

const NEXT_STEP =
	"Next: follow DESIGN.md and wire the tokens into your styling layer (CSS variables, a Tailwind theme, or shadcn)."

/** One report shared by the MCP tool and the CLI command. */
export function formatApplyResult(result: ApplyResult): string {
	const lines: string[] = []
	const labels = result.mode === "applied" ? APPLIED_LABELS : PLAN_LABELS

	if (result.mode === "preview") {
		lines.push(
			`Preview of applying "${result.slug}" to ${result.dir} as ${result.tokensFormat}. Nothing was written.`,
		)
	} else if (result.mode === "refused") {
		lines.push(
			`REFUSED: nothing was written to ${result.dir}. Applying "${result.slug}" would overwrite ${result.conflicts.length} file(s) whose current content Identity Forge did not write or cannot verify.`,
		)
	} else {
		lines.push(
			`Applied "${result.slug}" to ${result.dir} as ${result.tokensFormat}.`,
		)
	}

	lines.push("")
	for (const artifact of result.artifacts) {
		lines.push(`  ${labels[artifact.status]}  ${artifact.relPath}`)
	}
	if (result.mode === "applied") {
		lines.push(`  stamped    ${STAMP_FILENAME}`)
	}

	if (result.conflicts.length > 0) {
		lines.push("", "Conflicts:")
		for (const artifact of result.conflicts)
			lines.push(describeConflict(artifact))
	}

	if (result.notes.length > 0) {
		lines.push("", ...result.notes.map((note) => `Note: ${note}`))
	}

	if (result.mode === "preview") {
		lines.push(
			"",
			result.conflicts.length > 0
				? "Applying now would refuse and write nothing. Move or delete the conflicting files to keep them, or apply with force to overwrite them and lose their current content permanently."
				: "Nothing here is at risk. Apply when ready.",
		)
	} else if (result.mode === "refused") {
		lines.push(
			"",
			"Show the user the conflicting files and let them choose. Preview the full plan, move or delete those files, or apply with force to overwrite them and lose their current content permanently.",
		)
	} else {
		if (result.overwritten.length > 0) {
			lines.push(
				"",
				`Forced: the previous content of ${result.overwritten
					.map((artifact) => artifact.relPath)
					.join(
						", ",
					)} was overwritten and is gone permanently. It is not recoverable through Identity Forge.`,
			)
		}
		lines.push(
			"",
			`${STAMP_FILENAME} records the kit and a hash of every file written, so the next apply can tell your edits from ours.`,
			NEXT_STEP,
		)
	}

	return lines.join("\n")
}
