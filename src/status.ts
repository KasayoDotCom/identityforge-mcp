import { readFile } from "node:fs/promises"
import path from "node:path"
import { type VersionDiff, diffKitVersions, exportKit } from "./api.js"
import {
	type ApplyStamp,
	DESIGN_FILENAME,
	STAMP_FILENAME,
	type StampLayer,
	hashContent,
	parseExportIdentity,
} from "./apply.js"

/**
 * What has moved since this repository was built against a kit.
 *
 * The pieces have existed for a while and none of them answered the question on
 * their own. `themes diff --from N` needs you to know the kit AND the version.
 * `apply --preview` needs the slug and fetches a whole plan. The stamp holds
 * both facts and nothing read it. So the loop the version ledger was built for —
 * "the design moved, walk the code and apply only what changed" — still started
 * with a person reading a JSON file and typing the numbers back in.
 *
 * This reads the stamp and asks the questions it implies. NO ARGUMENTS: a
 * command that needs to be told which kit is one the caller could already run.
 *
 * Read-only by construction. It never writes, never touches the working tree,
 * and is safe to run in a loop; `apply` remains the only thing that changes a
 * file.
 */

export type LocalArtifactState =
	| "unchanged"
	| "modified"
	| "missing"
	| "unreadable"
	/** In the stamp with no hash recorded — a stamp older than the field. */
	| "unrecorded"

export interface LocalArtifactStatus {
	path: string
	state: LocalArtifactState
}

export interface ThemeStatus {
	stampPath: string
	/** What the stamp says this repository was built against. */
	stamped: {
		kitId: string | null
		slug: string
		/** `0` = exists, nothing minted. `null` = the export reported none. */
		version: number | null
		designMdContract: string | null
		designMdDigest: string | null
		appliedAt: string
		layers: StampLayer[]
	}
	/** What the server says now. Absent when it could not be asked. */
	current?: {
		kitId: string | null
		slug: string
		version: number | null
		designMdContract: string | null
		designMdDigest: string
	}
	/**
	 * Three independent movements, each `null` when one side cannot answer.
	 *
	 * `kitMoved` is the strong signal: the server's own count says the design
	 * changed. `documentMoved` is the weak one: the RENDERED bytes differ, which
	 * a serializer change alone will do to every kit at once. `contractMoved`
	 * says the document's SHAPE changed — a section added, renamed or removed —
	 * which is a different question from either.
	 */
	moved: {
		kitMoved: boolean | null
		documentMoved: boolean | null
		contractMoved: boolean | null
	}
	local: LocalArtifactStatus[]
	/** Present only when both versions are numbers and they differ. */
	diff?: VersionDiff
	/** True only when nothing moved on either side and every file is intact. */
	inSync: boolean
	/** Facts the caller should hear that are not booleans. */
	notes: string[]
}

export class MissingStampError extends Error {
	constructor(public readonly stampPath: string) {
		super(
			`No ${STAMP_FILENAME} at ${stampPath}. This directory was never built against a kit — run \`identityforge apply <slug>\` first.`,
		)
		this.name = "MissingStampError"
	}
}

async function readStamp(stampPath: string): Promise<ApplyStamp> {
	let raw: string
	try {
		raw = await readFile(stampPath, "utf8")
	} catch {
		throw new MissingStampError(stampPath)
	}
	try {
		return JSON.parse(raw) as ApplyStamp
	} catch {
		// Refusing beats guessing: every answer below is derived from this file,
		// and half-reading it would report drift that is really a broken stamp.
		throw new Error(
			`${stampPath} is not valid JSON. It records what this repository was built against; fix or delete it rather than letting a status report be derived from a file nobody can parse.`,
		)
	}
}

async function localState(
	dir: string,
	artifact: { path: string; hash?: string },
): Promise<LocalArtifactStatus> {
	if (!artifact.hash) return { path: artifact.path, state: "unrecorded" }
	try {
		const body = await readFile(path.join(dir, artifact.path))
		return {
			path: artifact.path,
			state: hashContent(body) === artifact.hash ? "unchanged" : "modified",
		}
	} catch (error) {
		// A file that is gone and a file that cannot be read are different
		// problems: the first is a deletion the caller probably made on purpose,
		// the second is usually a permission fault.
		const missing = (error as { code?: string }).code === "ENOENT"
		return { path: artifact.path, state: missing ? "missing" : "unreadable" }
	}
}

export async function themeStatus(
	opts: { dir?: string } = {},
): Promise<ThemeStatus> {
	const dir = path.resolve(opts.dir ?? process.cwd())
	const stampPath = path.join(dir, STAMP_FILENAME)
	const stamp = await readStamp(stampPath)

	const notes: string[] = []
	const local = await Promise.all(
		(stamp.artifacts ?? []).map((artifact) => localState(dir, artifact)),
	)

	const stamped = {
		kitId: stamp.kit?.id ?? null,
		slug: stamp.kit?.slug ?? "",
		version: stamp.kit?.version ?? null,
		designMdContract: stamp.designMdContract ?? null,
		designMdDigest: stamp.kit?.designMdDigest ?? null,
		appliedAt: stamp.appliedAt,
		layers: stamp.layers ?? [],
	}

	// The ID, not the slug: a slug can be renamed and a retired one can later be
	// claimed by a different kit, so asking by slug can silently ask about
	// something else. Falling back to the slug is still better than refusing,
	// because a stamp written before ids were reported has only that.
	const identifier = stamped.kitId ?? stamped.slug
	if (!stamped.kitId) {
		notes.push(
			"This stamp records no kit id, so the question was asked by slug. A slug can be renamed and a freed slug can be claimed by a different kit, so a moved answer here is worth confirming by hand.",
		)
	}

	let current: ThemeStatus["current"]
	try {
		// ONE request answers four questions: the id, the current version, the
		// document's contract, and the bytes to digest. Asking the export is also
		// asking the exact source the stamp was written from, so the two are
		// comparable by construction rather than by convention.
		const exported = await exportKit(identifier, "design-md")
		const identity = parseExportIdentity(exported.body)
		current = {
			kitId: identity.id,
			slug: identity.slug ?? stamped.slug,
			version: identity.version,
			designMdContract: identity.contract,
			designMdDigest: hashContent(exported.body),
		}
		if (identity.id && stamped.kitId && identity.id !== stamped.kitId) {
			notes.push(
				`The kit at this address is not the one this repository was built against: stamped ${stamped.kitId}, served ${identity.id}. Nothing below is a comparison of the same design.`,
			)
		}
	} catch (error) {
		// A Pro kit this caller is not entitled to answers 403 here, and so does
		// an expired key. Local drift is still worth reporting, so this degrades
		// rather than fails.
		notes.push(
			`Could not read the current kit, so only local changes are reported: ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}

	const kitMoved =
		current &&
		typeof stamped.version === "number" &&
		typeof current.version === "number"
			? current.version !== stamped.version
			: null
	if (kitMoved === null && current) {
		notes.push(
			stamped.version === null
				? "The stamp records no version, so the rendered digest is the only signal available and it cannot tell a changed kit from a changed serializer."
				: "The server reported no version for this kit, so the rendered digest is the only signal available.",
		)
	}

	const documentMoved =
		current && stamped.designMdDigest
			? current.designMdDigest !== stamped.designMdDigest
			: null

	const contractMoved =
		current && stamped.designMdContract && current.designMdContract
			? current.designMdContract !== stamped.designMdContract
			: null
	if (current && stamped.designMdContract === null) {
		notes.push(
			`This stamp predates the document contract version, so a shape change cannot be detected. The next \`apply\` records it (currently ${
				current.designMdContract ?? "unreported"
			}).`,
		)
	}

	let diff: VersionDiff | undefined
	if (kitMoved && typeof stamped.version === "number") {
		try {
			diff = (await diffKitVersions(identifier, { from: stamped.version })).data
		} catch (error) {
			notes.push(
				`The kit moved but the diff could not be read: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	const dirty = local.filter((artifact) => artifact.state !== "unchanged")
	const inSync =
		Boolean(current) &&
		kitMoved === false &&
		documentMoved !== true &&
		contractMoved !== true &&
		dirty.length === 0

	return {
		stampPath,
		stamped,
		...(current ? { current } : {}),
		moved: { kitMoved, documentMoved, contractMoved },
		local,
		...(diff ? { diff } : {}),
		inSync,
		notes,
	}
}

/** One human-readable line per finding. The JSON above is the contract; this is
 *  what a person reads in a terminal. */
export function formatThemeStatus(status: ThemeStatus): string {
	const lines: string[] = []
	const { stamped, current, moved } = status
	lines.push(
		`${stamped.slug}${
			stamped.version === null ? "" : ` v${stamped.version}`
		} — applied ${stamped.appliedAt}`,
	)

	if (!current) {
		lines.push("Current kit unreadable; only local files were checked.")
	} else if (moved.kitMoved) {
		lines.push(
			`The kit moved: v${stamped.version} → v${current.version}. Re-read ${DESIGN_FILENAME}.`,
		)
		// The server already writes this sentence ("9 changes: 6 token, 2
		// typography, 1 layer"), so recounting it here would be a second home for
		// the same fact and a chance to disagree with the diff it summarises.
		if (status.diff) lines.push(status.diff.summary)
	} else if (moved.kitMoved === false && moved.documentMoved) {
		lines.push(
			"Same version, different rendered file: the serializer changed, not the kit. No action.",
		)
	} else if (moved.kitMoved === null) {
		lines.push("No version on one side; the digest is the only signal.")
	}

	if (moved.contractMoved) {
		lines.push(
			`The document's SHAPE changed: contract ${stamped.designMdContract} → ${current?.designMdContract}. Sections may have been added, renamed or removed.`,
		)
	}

	for (const artifact of status.local) {
		if (artifact.state !== "unchanged") {
			lines.push(`${artifact.path}: ${artifact.state}`)
		}
	}

	if (stamped.layers.length) {
		lines.push(
			`${stamped.layers.length} composed layer${
				stamped.layers.length === 1 ? "" : "s"
			} recorded in the stamp.`,
		)
	}

	for (const note of status.notes) lines.push(note)
	if (status.inSync) lines.push("In sync.")
	return lines.join("\n")
}
