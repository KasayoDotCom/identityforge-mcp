import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { STAMP_VERSION, hashContent } from "./apply.js"
import { MissingStampError, formatThemeStatus, themeStatus } from "./status.js"

/**
 * The three movements are the whole point of this command, and the reason it
 * exists rather than a `themes diff` the caller assembles by hand: a changed
 * kit, a changed serializer and a changed document shape are three different
 * facts, and every one of them makes the DESIGN.md bytes differ. Collapse them
 * and every serializer deploy reads as "your design changed", which is the
 * report that trains people to ignore the report.
 *
 * So each is asserted on its own, including the cases where one side cannot
 * answer and the honest value is `null` rather than `false`. `false` claims a
 * comparison happened.
 */

const DESIGN = (front: string) =>
	`---\n${front}\n---\n\n# Sage Slate Editorial\n\nOne accent, used once.\n`

const STAMPED_BODY = DESIGN(
	'contract: "1.0"\nkit:\n  id: "kit_abc"\n  version: 3\n  slug: "sage-slate-editorial"',
)

function stubExport(
	body: string | { status: number },
	diff?: unknown,
): () => void {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async (input) => {
		if (String(input).includes("/versions/diff")) {
			return new Response(JSON.stringify(diff ?? { data: {}, meta: {} }), {
				headers: { "content-type": "application/json" },
			})
		}
		if (typeof body !== "string") {
			return new Response(JSON.stringify({ error: { message: "Pro kit" } }), {
				status: body.status,
				headers: { "content-type": "application/json" },
			})
		}
		return new Response(body, {
			headers: { "content-disposition": 'inline; filename="DESIGN.md"' },
		})
	}
	return () => {
		globalThis.fetch = originalFetch
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
	}
}

interface StampOverrides {
	contract?: string | null
	version?: number | null
	id?: string | null
	digestOf?: string
	artifacts?: { path: string; hash?: string }[]
}

/** Writes a stamp describing a repo built against `STAMPED_BODY`. */
function writeStamp(dir: string, overrides: StampOverrides = {}): void {
	const stamp = {
		stampVersion: STAMP_VERSION,
		...(overrides.contract === undefined
			? { designMdContract: "1.0" }
			: overrides.contract === null
				? {}
				: { designMdContract: overrides.contract }),
		kit: {
			...(overrides.id === null ? {} : { id: overrides.id ?? "kit_abc" }),
			slug: "sage-slate-editorial",
			version: overrides.version === undefined ? 3 : overrides.version,
			designMdDigest: hashContent(
				Buffer.from(overrides.digestOf ?? STAMPED_BODY),
			),
		},
		layers: [],
		artifacts: overrides.artifacts ?? [],
		integration: { tokensEntry: null },
		appliedAt: "2026-07-01T10:00:00.000Z",
	}
	writeFileSync(join(dir, "identityforge.json"), JSON.stringify(stamp))
}

function withTempDir(run: (dir: string) => Promise<void>): () => Promise<void> {
	return async () => {
		const dir = mkdtempSync(join(tmpdir(), "identityforge-status-"))
		try {
			await run(dir)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}
}

test(
	"nothing moved: three falses and inSync",
	withTempDir(async (dir) => {
		writeStamp(dir)
		const restore = stubExport(STAMPED_BODY)
		try {
			const status = await themeStatus({ dir })
			assert.deepEqual(status.moved, {
				kitMoved: false,
				documentMoved: false,
				contractMoved: false,
			})
			assert.equal(status.inSync, true)
			assert.equal(status.diff, undefined)
			assert.match(formatThemeStatus(status), /In sync\./)
		} finally {
			restore()
		}
	}),
)

test(
	"the kit moved: the diff is fetched and its own summary is printed",
	withTempDir(async (dir) => {
		writeStamp(dir)
		const moved = DESIGN(
			'contract: "1.0"\nkit:\n  id: "kit_abc"\n  version: 5\n  slug: "sage-slate-editorial"',
		)
		const restore = stubExport(moved, {
			data: { summary: "9 changes: 6 token, 2 typography, 1 layer" },
			meta: { toIsCurrent: true },
		})
		try {
			const status = await themeStatus({ dir })
			assert.equal(status.moved.kitMoved, true)
			assert.equal(status.moved.documentMoved, true)
			assert.equal(status.moved.contractMoved, false)
			assert.equal(status.inSync, false)
			const text = formatThemeStatus(status)
			assert.match(text, /The kit moved: v3 → v5/)
			// The server wrote this sentence. Recounting it here would be a second
			// home for the same fact and a chance to disagree with the diff.
			assert.match(text, /9 changes: 6 token, 2 typography, 1 layer/)
		} finally {
			restore()
		}
	}),
)

test(
	"same version, different bytes: the serializer changed, not the kit",
	withTempDir(async (dir) => {
		writeStamp(dir)
		const reserialized = `${STAMPED_BODY}\nA line the serializer now emits.\n`
		const restore = stubExport(reserialized)
		try {
			const status = await themeStatus({ dir })
			assert.equal(status.moved.kitMoved, false)
			assert.equal(status.moved.documentMoved, true)
			// It is NOT in sync — something differs — but the sentence must not send
			// anyone to re-read a brief that did not change.
			assert.equal(status.inSync, false)
			assert.match(formatThemeStatus(status), /serializer changed, not the kit/)
			assert.doesNotMatch(formatThemeStatus(status), /The kit moved/)
			assert.equal(status.diff, undefined, "no diff to fetch at one version")
		} finally {
			restore()
		}
	}),
)

test(
	"the document's SHAPE moved independently of its version",
	withTempDir(async (dir) => {
		writeStamp(dir)
		const reshaped = DESIGN(
			'contract: "1.1"\nkit:\n  id: "kit_abc"\n  version: 3\n  slug: "sage-slate-editorial"',
		)
		const restore = stubExport(reshaped)
		try {
			const status = await themeStatus({ dir })
			assert.equal(status.moved.kitMoved, false)
			assert.equal(status.moved.contractMoved, true)
			assert.match(formatThemeStatus(status), /contract 1\.0 → 1\.1/)
		} finally {
			restore()
		}
	}),
)

test(
	"a missing version on either side is null, never false",
	withTempDir(async (dir) => {
		// `null` is the export saying it does not know, which parseExportIdentity
		// keeps distinct from 0. A `false` here would claim a comparison ran.
		writeStamp(dir)
		const unversioned = DESIGN(
			'contract: "1.0"\nkit:\n  id: "kit_abc"\n  version: null\n  slug: "sage-slate-editorial"',
		)
		const restore = stubExport(unversioned)
		try {
			const status = await themeStatus({ dir })
			assert.equal(status.moved.kitMoved, null)
			assert.equal(status.inSync, false)
			assert.ok(
				status.notes.some((note) => note.includes("no version")),
				"a null must come with the reason it is null",
			)
		} finally {
			restore()
		}
	}),
)

test(
	"a stamp older than the contract field cannot report a shape change",
	withTempDir(async (dir) => {
		writeStamp(dir, { contract: null })
		const restore = stubExport(STAMPED_BODY)
		try {
			const status = await themeStatus({ dir })
			assert.equal(status.moved.contractMoved, null)
			assert.ok(
				status.notes.some((note) => note.includes("predates")),
				"the caller is told the next apply fixes it",
			)
		} finally {
			restore()
		}
	}),
)

test(
	"local artifacts are hashed against disk, one state each",
	withTempDir(async (dir) => {
		const kept = "# hand written\n"
		writeFileSync(join(dir, "DESIGN.md"), STAMPED_BODY)
		writeFileSync(join(dir, "edited.css"), kept)
		writeStamp(dir, {
			artifacts: [
				{ path: "DESIGN.md", hash: hashContent(Buffer.from(STAMPED_BODY)) },
				{ path: "edited.css", hash: hashContent(Buffer.from("original")) },
				{ path: "deleted.json", hash: hashContent(Buffer.from("gone")) },
				{ path: "old-stamp.txt" },
			],
		})
		const restore = stubExport(STAMPED_BODY)
		try {
			const status = await themeStatus({ dir })
			assert.deepEqual(
				status.local.map((artifact) => [artifact.path, artifact.state]),
				[
					["DESIGN.md", "unchanged"],
					["edited.css", "modified"],
					["deleted.json", "missing"],
					["old-stamp.txt", "unrecorded"],
				],
			)
			// Nothing moved server-side, and it still is not in sync: a modified
			// file is exactly what `apply` will refuse over.
			assert.equal(status.moved.kitMoved, false)
			assert.equal(status.inSync, false)
			assert.match(formatThemeStatus(status), /edited\.css: modified/)
		} finally {
			restore()
		}
	}),
)

test(
	"a 403 degrades to a local report rather than failing",
	withTempDir(async (dir) => {
		writeFileSync(join(dir, "DESIGN.md"), "edited by hand\n")
		writeStamp(dir, {
			artifacts: [
				{ path: "DESIGN.md", hash: hashContent(Buffer.from(STAMPED_BODY)) },
			],
		})
		const restore = stubExport({ status: 403 })
		try {
			const status = await themeStatus({ dir })
			assert.equal(status.current, undefined)
			assert.deepEqual(status.moved, {
				kitMoved: null,
				documentMoved: null,
				contractMoved: null,
			})
			assert.equal(status.inSync, false, "unknown is not in sync")
			assert.equal(status.local[0]?.state, "modified")
			assert.ok(status.notes.some((note) => note.includes("only local")))
		} finally {
			restore()
		}
	}),
)

test(
	"asking by slug is allowed and is flagged, because a slug can be reclaimed",
	withTempDir(async (dir) => {
		writeStamp(dir, { id: null })
		const restore = stubExport(STAMPED_BODY)
		try {
			const status = await themeStatus({ dir })
			assert.equal(status.stamped.kitId, null)
			assert.ok(status.notes.some((note) => note.includes("no kit id")))
		} finally {
			restore()
		}
	}),
)

test(
	"the address now serves a DIFFERENT kit, and nothing below is a comparison",
	withTempDir(async (dir) => {
		writeStamp(dir)
		const otherKit = DESIGN(
			'contract: "1.0"\nkit:\n  id: "kit_xyz"\n  version: 3\n  slug: "sage-slate-editorial"',
		)
		const restore = stubExport(otherKit)
		try {
			const status = await themeStatus({ dir })
			assert.ok(
				status.notes.some((note) => note.includes("not the one")),
				"a matching version number across two different kits is the trap",
			)
		} finally {
			restore()
		}
	}),
)

test(
	"no stamp is a named error, not a crash on undefined",
	withTempDir(async (dir) => {
		await assert.rejects(() => themeStatus({ dir }), MissingStampError)
		await assert.rejects(() => themeStatus({ dir }), /identityforge apply/)
	}),
)

test(
	"an unparseable stamp refuses rather than reporting drift it cannot know",
	withTempDir(async (dir) => {
		writeFileSync(join(dir, "identityforge.json"), "{ not json")
		await assert.rejects(() => themeStatus({ dir }), /not valid JSON/)
	}),
)
