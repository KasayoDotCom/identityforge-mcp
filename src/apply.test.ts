import assert from "node:assert/strict"
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { filenameFromDisposition, isSafeExportFilename } from "./api.js"
import {
	type ApplyStamp,
	STAMP_FILENAME,
	STAMP_VERSION,
	applyTheme,
	formatApplyResult,
	hashContent,
	parseExportIdentity,
} from "./apply.js"

// apply_theme is the only thing in this CLI that can destroy a user's work, so
// the conflict rule needs coverage that runs without a network or the repo.

const DESIGN_BODY = "# Acid Signal Black\n\nUse the primary for one thing.\n"
const TOKENS_BODY = '{"color":{"primary":{"$value":"#CCFF00"}}}\n'
const TOKENS_FILENAME = "acid-signal-black.json"

/** Serves the two exports `applyTheme` fetches, keyed on the format query. */
function stubExports(
	bodies: {
		design?: string
		tokens?: string
		tokensFilename?: string
		requests?: Array<{ url: string; method: string; hasBody: boolean }>
		failTelemetry?: boolean
	} = {},
): () => void {
	const originalFetch = globalThis.fetch
	const originalApiUrl = process.env.IDENTITYFORGE_API_URL
	process.env.IDENTITYFORGE_API_URL = "http://api.test"
	globalThis.fetch = async (input, init) => {
		const url = String(input)
		bodies.requests?.push({
			url,
			method: init?.method ?? "GET",
			hasBody: init?.body != null,
		})
		if (url.endsWith("/applied")) {
			if (bodies.failTelemetry) throw new Error("telemetry unavailable")
			return new Response(null, { status: 204 })
		}
		const isDesignMd = url.includes("format=design-md")
		const filename = isDesignMd
			? "DESIGN.md"
			: bodies.tokensFilename ?? TOKENS_FILENAME
		return new Response(
			isDesignMd ? bodies.design ?? DESIGN_BODY : bodies.tokens ?? TOKENS_BODY,
			{ headers: { "content-disposition": `inline; filename="${filename}"` } },
		)
	}
	return () => {
		globalThis.fetch = originalFetch
		if (originalApiUrl === undefined)
			Reflect.deleteProperty(process.env, "IDENTITYFORGE_API_URL")
		else process.env.IDENTITYFORGE_API_URL = originalApiUrl
	}
}

test(
	"a successful apply records one metadata-only completion without depending on telemetry",
	withTempDir(async (dir) => {
		const requests: Array<{ url: string; method: string; hasBody: boolean }> = []
		const restore = stubExports({ requests, failTelemetry: true })
		try {
			const result = await apply(dir)
			assert.equal(result.mode, "applied")
			assert.equal(existsSync(join(dir, STAMP_FILENAME)), true)
			assert.deepEqual(requests.at(-1), {
				url: "http://api.test/api/v1/kits/acid-signal-black/applied",
				method: "POST",
				hasBody: false,
			})
		} finally {
			restore()
		}
	}),
)

/** A throwaway directory per test. Never the repo. */
function withTempDir(
	run: (dir: string) => Promise<void> | void,
): () => Promise<void> {
	return async () => {
		const dir = mkdtempSync(join(tmpdir(), "identityforge-apply-"))
		try {
			await run(dir)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}
}

function readStampFile(dir: string): ApplyStamp {
	return JSON.parse(
		readFileSync(join(dir, STAMP_FILENAME), "utf8"),
	) as ApplyStamp
}

function stampedHash(stamp: ApplyStamp, path: string): string | undefined {
	return stamp.artifacts.find((artifact) => artifact.path === path)?.hash
}

async function apply(
	dir: string,
	options: { preview?: boolean; force?: boolean; tokensEntry?: string } = {},
) {
	return applyTheme({
		slug: "acid-signal-black",
		dir,
		tokensFormat: "dtcg",
		...options,
	})
}

test(
	"a fresh apply writes both files and a stamp that hashes each one",
	withTempDir(async (dir) => {
		const restore = stubExports()
		try {
			const result = await apply(dir)

			assert.equal(result.mode, "applied")
			assert.deepEqual(
				result.artifacts.map((artifact) => [artifact.relPath, artifact.status]),
				[
					["DESIGN.md", "create"],
					[TOKENS_FILENAME, "create"],
				],
			)
			assert.equal(readFileSync(join(dir, "DESIGN.md"), "utf8"), DESIGN_BODY)
			assert.equal(
				readFileSync(join(dir, TOKENS_FILENAME), "utf8"),
				TOKENS_BODY,
			)

			const stamp = readStampFile(dir)
			assert.equal(stamp.kit.slug, "acid-signal-black")
			// A digest of the rendered DESIGN.md, computed locally. Deliberately
			// NOT named contentHash: the server mints one of those over a different
			// projection and the two must never be compared.
			assert.equal(stamp.kit.designMdDigest, hashContent(DESIGN_BODY))
			assert.equal(stamp.stampVersion, STAMP_VERSION)
			// This fixture is an export with no front matter, so the honest answer
			// is null. Explicitly null rather than absent: a reader must be able to
			// tell "the export did not say" from "an old CLI did not record it",
			// and null must never be softened into 0.
			assert.equal(stamp.kit.id, null)
			assert.equal(stamp.kit.version, null)
			// Still absent: no export carries the server's content hash.
			assert.equal(stamp.kit.contentHash, undefined)
			assert.deepEqual(stamp.layers, [])
			assert.equal(stamp.brand, undefined)
			assert.equal(stamp.integration.tokensEntry, null)
			assert.ok(Date.parse(stamp.appliedAt) > 0)
			assert.equal(stamp.artifacts.length, 2)
			assert.equal(stampedHash(stamp, "DESIGN.md"), hashContent(DESIGN_BODY))
			assert.equal(
				stampedHash(stamp, TOKENS_FILENAME),
				hashContent(TOKENS_BODY),
			)
			// The hash is the whole point of the record: it must match the bytes.
			assert.equal(
				stampedHash(stamp, "DESIGN.md"),
				hashContent(readFileSync(join(dir, "DESIGN.md"))),
			)
		} finally {
			restore()
		}
	}),
)

test(
	"re-applying over untouched files succeeds and reports them unchanged",
	withTempDir(async (dir) => {
		const restore = stubExports()
		try {
			const first = await apply(dir)
			const second = await apply(dir)

			assert.equal(second.mode, "applied")
			assert.deepEqual(
				second.artifacts.map((artifact) => artifact.status),
				["unchanged", "unchanged"],
			)
			assert.deepEqual(second.conflicts, [])
			assert.deepEqual(second.overwritten, [])
			// An unchanged file keeps the timestamp of the apply that wrote it.
			const writtenAt = (stamp: ApplyStamp | undefined) =>
				stamp?.artifacts.find((artifact) => artifact.path === "DESIGN.md")
					?.writtenAt
			assert.ok(writtenAt(first.stamp))
			assert.equal(writtenAt(readStampFile(dir)), writtenAt(first.stamp))
		} finally {
			restore()
		}
	}),
)

test(
	"a locally edited file is a conflict, and the default apply writes nothing",
	withTempDir(async (dir) => {
		const restore = stubExports()
		try {
			await apply(dir)
			const edited = `${DESIGN_BODY}\n## House rules\n\nOur own section.\n`
			writeFileSync(join(dir, "DESIGN.md"), edited, "utf8")
			const stampBefore = readFileSync(join(dir, STAMP_FILENAME), "utf8")

			const result = await apply(dir)

			assert.equal(result.mode, "refused")
			assert.equal(result.conflicts.length, 1)
			assert.equal(result.conflicts[0].relPath, "DESIGN.md")
			assert.equal(result.conflicts[0].conflictReason, "modified")
			// Nothing moved: not the edited file, not the untouched one, not the stamp.
			assert.equal(readFileSync(join(dir, "DESIGN.md"), "utf8"), edited)
			assert.equal(readFileSync(join(dir, STAMP_FILENAME), "utf8"), stampBefore)

			const report = formatApplyResult(result)
			assert.match(report, /REFUSED/)
			assert.match(report, /DESIGN\.md/)
			assert.match(report, /force/)
		} finally {
			restore()
		}
	}),
)

test(
	"a hand written file with no stamp is a conflict, not a silent overwrite",
	withTempDir(async (dir) => {
		const restore = stubExports()
		try {
			const handWritten = "# Our design system\n\nWritten by a person.\n"
			writeFileSync(join(dir, "DESIGN.md"), handWritten, "utf8")

			const result = await apply(dir)

			assert.equal(result.mode, "refused")
			assert.equal(result.conflicts[0].conflictReason, "untracked")
			assert.equal(readFileSync(join(dir, "DESIGN.md"), "utf8"), handWritten)
			// The tokens file was the safe half of the plan and still went nowhere.
			assert.equal(existsSync(join(dir, TOKENS_FILENAME)), false)
			assert.equal(existsSync(join(dir, STAMP_FILENAME)), false)
		} finally {
			restore()
		}
	}),
)

test(
	"an existing file that already matches the kit is adopted, not refused",
	withTempDir(async (dir) => {
		const restore = stubExports()
		try {
			// The pre-stamp upgrade path: an older apply left these bytes behind.
			writeFileSync(join(dir, "DESIGN.md"), DESIGN_BODY, "utf8")
			writeFileSync(join(dir, TOKENS_FILENAME), TOKENS_BODY, "utf8")

			const result = await apply(dir)

			assert.equal(result.mode, "applied")
			assert.deepEqual(
				result.artifacts.map((artifact) => artifact.status),
				["unchanged", "unchanged"],
			)
			assert.equal(readStampFile(dir).artifacts.length, 2)
		} finally {
			restore()
		}
	}),
)

test(
	"force overwrites the conflict and reports exactly what was destroyed",
	withTempDir(async (dir) => {
		const restore = stubExports()
		try {
			writeFileSync(join(dir, "DESIGN.md"), "# Mine\n", "utf8")

			const result = await apply(dir, { force: true })

			assert.equal(result.mode, "applied")
			assert.deepEqual(
				result.overwritten.map((artifact) => artifact.relPath),
				["DESIGN.md"],
			)
			assert.equal(readFileSync(join(dir, "DESIGN.md"), "utf8"), DESIGN_BODY)
			assert.equal(
				stampedHash(readStampFile(dir), "DESIGN.md"),
				hashContent(DESIGN_BODY),
			)

			const report = formatApplyResult(result)
			assert.match(report, /DESIGN\.md/)
			assert.match(report, /gone permanently/)
		} finally {
			restore()
		}
	}),
)

test(
	"preview writes nothing at all, stamp included, and returns the plan",
	withTempDir(async (dir) => {
		const restore = stubExports()
		try {
			writeFileSync(join(dir, "DESIGN.md"), "# Mine\n", "utf8")

			const result = await apply(dir, { preview: true })

			assert.equal(result.mode, "preview")
			assert.equal(result.stamp, undefined)
			assert.deepEqual(
				result.artifacts.map((artifact) => [artifact.relPath, artifact.status]),
				[
					["DESIGN.md", "conflict"],
					[TOKENS_FILENAME, "create"],
				],
			)
			assert.equal(readFileSync(join(dir, "DESIGN.md"), "utf8"), "# Mine\n")
			assert.equal(existsSync(join(dir, TOKENS_FILENAME)), false)
			assert.equal(existsSync(join(dir, STAMP_FILENAME)), false)
			assert.match(formatApplyResult(result), /Nothing was written/)
		} finally {
			restore()
		}
	}),
)

test(
	"a kit that moved since the last apply is reported, and the update is not a conflict",
	withTempDir(async (dir) => {
		const first = stubExports()
		try {
			await apply(dir)
		} finally {
			first()
		}

		const moved = `${DESIGN_BODY}\n## Motion\n\nSlower now.\n`
		const second = stubExports({ design: moved })
		try {
			const result = await apply(dir)

			assert.equal(result.mode, "applied")
			assert.equal(result.artifacts[0].status, "update")
			assert.equal(
				result.notes.some((note) =>
					note.includes("The rendered DESIGN.md changed"),
				),
				true,
			)
			assert.equal(readFileSync(join(dir, "DESIGN.md"), "utf8"), moved)
			assert.equal(readStampFile(dir).kit.designMdDigest, hashContent(moved))
		} finally {
			second()
		}
	}),
)

test(
	"an unreadable stamp makes every existing file a conflict rather than a target",
	withTempDir(async (dir) => {
		const restore = stubExports()
		try {
			await apply(dir)
			writeFileSync(join(dir, STAMP_FILENAME), "{ not json", "utf8")
			writeFileSync(join(dir, "DESIGN.md"), "# Mine\n", "utf8")

			const result = await apply(dir)

			assert.equal(result.mode, "refused")
			assert.equal(result.conflicts[0].conflictReason, "untracked")
			assert.equal(
				result.notes.some((note) => note.includes(STAMP_FILENAME)),
				true,
			)
		} finally {
			restore()
		}
	}),
)

test(
	"switching tokens format keeps the earlier tokens file recorded, and records tokensEntry",
	withTempDir(async (dir) => {
		const dtcg = stubExports()
		try {
			await apply(dir)
		} finally {
			dtcg()
		}

		const css = stubExports({
			tokens: ":root { --primary: #CCFF00; }\n",
			tokensFilename: "acid-signal-black.css",
		})
		try {
			const result = await applyTheme({
				slug: "acid-signal-black",
				dir,
				tokensFormat: "css",
				tokensEntry: "src/app/globals.css",
			})
			assert.equal(result.mode, "applied")
		} finally {
			css()
		}

		const stamp = readStampFile(dir)
		// The dtcg file is still on disk and still ours, so it keeps its record
		// instead of becoming an unrecorded stranger on the next apply.
		assert.deepEqual(
			stamp.artifacts.map((artifact) => artifact.path),
			["DESIGN.md", "acid-signal-black.css", TOKENS_FILENAME].sort((a, b) =>
				a.localeCompare(b),
			),
		)
		assert.equal(stamp.integration.tokensEntry, "src/app/globals.css")

		// And a third apply back to dtcg finds it unchanged rather than conflicting.
		const again = stubExports()
		try {
			const result = await apply(dir)
			assert.equal(result.mode, "applied")
			assert.equal(result.conflicts.length, 0)
			// tokensEntry survives an apply that does not mention it.
			assert.equal(
				readStampFile(dir).integration.tokensEntry,
				"src/app/globals.css",
			)
		} finally {
			again()
		}
	}),
)

// The write path treats the server as untrusted. IDENTITYFORGE_API_URL is
// overridable by env and by config file, so the API base is not necessarily
// ours, and a Content-Disposition filename is server-chosen input on a path we
// are about to write.

test("a Content-Disposition filename that escapes the directory is rejected", () => {
	const hostile = [
		"../../evil.json",
		"../evil.json",
		"..\\..\\evil.json",
		"/etc/passwd",
		"/tmp/evil.json",
		"sub/dir/evil.json",
		"evil\u0000.json",
		"evil\u001f.json",
		"evil\u007f.json",
		".",
		"..",
		"",
	]
	for (const name of hostile) {
		assert.equal(
			isSafeExportFilename(name),
			false,
			`${JSON.stringify(name)} must not be accepted as a filename`,
		)
		// The fallback is derived from the slug, never from the header.
		assert.equal(
			filenameFromDisposition(
				`inline; filename="${name}"`,
				"acid-signal-black",
				"dtcg",
			),
			"acid-signal-black.json",
		)
	}
})

test("an ordinary Content-Disposition filename is still honoured", () => {
	assert.equal(isSafeExportFilename("acid-signal-black.css"), true)
	assert.equal(
		filenameFromDisposition(
			'inline; filename="acid-signal-black.css"',
			"acid-signal-black",
			"css",
		),
		"acid-signal-black.css",
	)
	// No header at all derives the name from the slug and the format.
	assert.equal(
		filenameFromDisposition(null, "acid-signal-black", "tailwind-v3"),
		"acid-signal-black.js",
	)
})

test(
	"a traversing filename from the API cannot write outside the target directory",
	withTempDir(async (dir) => {
		// A NUL byte cannot travel in a real header, since undici rejects it when
		// the Response is constructed, so that vector is covered by the unit test
		// above. This exercises the separator case end to end.
		const restore = stubExports({ tokensFilename: "../../evil.json" })
		try {
			const result = await apply(dir)

			assert.equal(result.mode, "applied")
			// Fell back to the slug-derived name, inside the directory.
			assert.deepEqual(
				result.artifacts.map((artifact) => artifact.relPath),
				["DESIGN.md", TOKENS_FILENAME],
			)
			assert.equal(existsSync(join(dirname(dirname(dir)), "evil.json")), false)
			assert.equal(existsSync(join(dirname(dir), "evil.json")), false)
		} finally {
			restore()
		}
	}),
)

test(
	"a traversing slug is caught by the containment check, and nothing is written",
	withTempDir(async (dir) => {
		// The fallback filename is built from the slug, which is caller supplied,
		// so containment is the check that holds however the name was formed.
		const restore = stubExports({ tokensFilename: "../../evil.json" })
		try {
			await assert.rejects(
				applyTheme({ slug: "../../evil", dir, tokensFormat: "dtcg" }),
				/Refusing to write/,
			)
			assert.equal(existsSync(join(dir, "DESIGN.md")), false)
			assert.equal(existsSync(join(dir, STAMP_FILENAME)), false)
			assert.equal(existsSync(join(dirname(dirname(dir)), "evil.json")), false)
		} finally {
			restore()
		}
	}),
)

// ---------------------------------------------------------------------------
// The version stamp: what this repo was built against.
//
// Identity comes out of the export's own front matter, so these fixtures mirror
// `designMdFrontMatter` in src/lib/designKits.ts exactly, comment lines and all.
// A fixture that only matched the parser would prove nothing; this shape was
// copied from a real /export response.

function designMd(
	identity: {
		id?: string | null
		version?: number | null
		slug?: string
		contract?: string | null
	},
	body = "Use the primary for one thing.",
): string {
	const {
		id = "c2d13a12-40ba-409f-a3cf-0e00cebf321e",
		version = 0,
		slug = "acid-signal-black",
		contract = "1.0",
	} = identity
	return `---
# Machine-readable tokens (the WHAT). The prose body gives the WHY + the rules.
${contract === null ? "" : `contract: "${contract}"\n`}kit:
  # The id is the durable handle; name and slug are both mutable.
  # version is this record's monotonic revision: 0 = never versioned,
  # null = the server did not report one. Diff against it; don't hash the file.
  id: ${id === null ? "null" : `"${id}"`}
  version: ${version === null ? "null" : version}
  slug: "${slug}"
  name: "Acid Signal Black"
colors:
  roles_light:
    background: "#0A0A0A"
---

# Acid Signal Black

${body}
`
}

test("parseExportIdentity reads the front matter the server actually emits", () => {
	assert.deepEqual(parseExportIdentity(designMd({})), {
		id: "c2d13a12-40ba-409f-a3cf-0e00cebf321e",
		version: 0,
		slug: "acid-signal-black",
		contract: "1.0",
	})
})

test("an export that predates the contract reads as null, never as 1.0", () => {
	// Assuming the oldest shape we ever shipped would let a repo record a
	// baseline the server never stated.
	assert.equal(parseExportIdentity(designMd({ contract: null })).contract, null)
})

test("a kit name cannot forge the contract either", () => {
	// Same injection the identity block already defends against, one level up:
	// `name` is caller supplied and yamlQuote escapes only the double quote, so a
	// newline in it writes lines at column 0 inside the front matter. The server
	// emits `contract` first, and the FIRST match wins.
	const forged = designMd({}).replace(
		'name: "Acid Signal Black"',
		'name: "Acid"\ncontract: "99.0"',
	)
	assert.equal(parseExportIdentity(forged).contract, "1.0")
})

test("parseExportIdentity keeps a null version null, and never reads it as 0", () => {
	const identity = parseExportIdentity(designMd({ id: null, version: null }))
	assert.equal(identity.id, null)
	// The distinction the whole field exists for: `0` means "no version minted
	// yet", null means "the server did not report one". Flattening them puts a
	// false baseline in a customer's repository.
	assert.equal(identity.version, null)
	assert.notEqual(identity.version, 0)
	assert.equal(identity.slug, "acid-signal-black")
})

test("a kit name cannot inject a false id or version into the stamp", () => {
	// Not hypothetical. `yamlQuote` in src/lib/designKits.ts escapes the double
	// quote and nothing else, so a kit NAME containing a newline breaks out of
	// its line and writes arbitrary front matter. A name is caller supplied
	// through create_theme / update_theme, and `name:` is emitted after the real
	// identity, so first-occurrence-wins is what keeps this out of the stamp.
	const hostile = designMd({}).replace(
		'name: "Acid Signal Black"',
		'name: "Nice Kit\\"\n  id: "spoofed-id"\n  version: 999\n  slug: "spoofed-slug"',
	)
	const identity = parseExportIdentity(hostile)
	assert.equal(identity.version, 0)
	assert.notEqual(identity.version, 999)
	assert.equal(identity.id, "c2d13a12-40ba-409f-a3cf-0e00cebf321e")
	assert.equal(identity.slug, "acid-signal-black")
})

test("an injected line cannot overwrite a version the server reported as null", () => {
	// The subtler half: an explicit null must win over a later line just as
	// firmly as a real number would, or the one case with no baseline is exactly
	// the case an attacker gets to fill in.
	const hostile = designMd({ version: null }).replace(
		'name: "Acid Signal Black"',
		'name: "x"\n  version: 999',
	)
	assert.equal(parseExportIdentity(hostile).version, null)
})

test("parseExportIdentity ignores identity-shaped lines outside the kit block", () => {
	// A later top-level key ends the block, so nothing below it is identity.
	const poisoned = designMd({}).replace(
		"colors:",
		'colors:\n  version: 99\n  id: "spoofed"',
	)
	const identity = parseExportIdentity(poisoned)
	assert.equal(identity.version, 0)
	assert.equal(identity.id, "c2d13a12-40ba-409f-a3cf-0e00cebf321e")
})

test("parseExportIdentity reports nothing rather than guessing on a body it cannot read", () => {
	assert.deepEqual(parseExportIdentity("# Just a heading\n"), {
		id: null,
		version: null,
		slug: null,
		contract: null,
	})
})

test(
	"the stamp records the id and version the export stated",
	withTempDir(async (dir) => {
		const restore = stubExports({ design: designMd({ version: 3 }) })
		try {
			await apply(dir)
			const stamp = readStampFile(dir)
			assert.equal(stamp.stampVersion, STAMP_VERSION)
			assert.equal(stamp.kit.id, "c2d13a12-40ba-409f-a3cf-0e00cebf321e")
			assert.equal(stamp.kit.version, 3)
			assert.equal(stamp.kit.slug, "acid-signal-black")
		} finally {
			restore()
		}
	}),
)

test(
	"a version move is reported as a real kit change, not a maybe",
	withTempDir(async (dir) => {
		let restore = stubExports({ design: designMd({ version: 3 }) })
		try {
			await apply(dir)
		} finally {
			restore()
		}
		restore = stubExports({ design: designMd({ version: 4 }) })
		try {
			const result = await apply(dir)
			assert.match(result.notes.join("\n"), /moved from version 3 to 4/)
			// The server's own count settles it, so the note must not hedge about
			// the serializer the way the digest-only note has to.
			assert.doesNotMatch(result.notes.join("\n"), /serializer/)
		} finally {
			restore()
		}
	}),
)

test(
	"a changed render at the same version blames the serializer, not the kit",
	withTempDir(async (dir) => {
		let restore = stubExports({ design: designMd({ version: 3 }) })
		try {
			await apply(dir)
		} finally {
			restore()
		}
		// Same version, different bytes: that is a re-render, and telling the user
		// to go re-read the brief would be a false alarm every time we touch the
		// serializer.
		restore = stubExports({
			design: designMd({ version: 3 }, "Reworded guidance."),
		})
		try {
			const result = await apply(dir)
			assert.match(result.notes.join("\n"), /still version 3/)
			assert.match(result.notes.join("\n"), /serializer changed rather than/)
		} finally {
			restore()
		}
	}),
)

test(
	"a renamed slug on the same id is not reported as a different kit",
	withTempDir(async (dir) => {
		let restore = stubExports({ design: designMd({ slug: "old-name" }) })
		try {
			await apply(dir)
		} finally {
			restore()
		}
		// The id is the durable handle. Reporting a rename as "you applied a
		// different kit" would train people to ignore the one note that matters.
		restore = stubExports({ design: designMd({ slug: "new-name" }) })
		try {
			const result = await apply(dir)
			assert.doesNotMatch(result.notes.join("\n"), /was last applied from kit/)
			assert.equal(readStampFile(dir).kit.slug, "new-name")
		} finally {
			restore()
		}
	}),
)

test(
	"a stamp from a newer CLI is refused rather than half-understood",
	withTempDir(async (dir) => {
		const restore = stubExports({ design: designMd({}) })
		try {
			await apply(dir)
			const stamp = readStampFile(dir)
			writeFileSync(
				join(dir, STAMP_FILENAME),
				JSON.stringify({ ...stamp, stampVersion: STAMP_VERSION + 1 }),
			)
			// The file has to actually differ from what would be written, or it is
			// "unchanged" before the stamp is ever consulted and nothing can be
			// lost either way. This is the case where the stamp record is the only
			// thing deciding whether the local edit survives.
			writeFileSync(join(dir, "DESIGN.md"), "# Locally edited\n", "utf8")

			// Fail closed: a record written under rules this CLI does not know must
			// not be acted on, so the edit becomes a conflict rather than a target.
			const result = await apply(dir)
			assert.equal(result.mode, "refused")
			assert.match(result.notes.join("\n"), /newer Identity Forge CLI/)
			assert.equal(result.conflicts[0].conflictReason, "untracked")
			assert.equal(
				readFileSync(join(dir, "DESIGN.md"), "utf8"),
				"# Locally edited\n",
			)
		} finally {
			restore()
		}
	}),
)
