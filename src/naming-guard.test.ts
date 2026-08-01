import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo, Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

// The naming half of the stale-write guard. `patchNamingCandidates` has
// accepted `expectedUpdatedAt` and `evidence` per operation since it was
// written, and no CLI flag reached either: we offered a concurrency guard and
// left it unarmable from the command line, which is the same shape as the
// `themes get --marker` gap on the kits half.
//
// These drive the real CLI in a subprocess for the reason revise-commands does:
// what is untested is the argv wiring and the refusals, both of which are
// properties of the command as assembled rather than of any helper it calls.
// A refusal is asserted as `requests == []`, never as "it printed something" —
// a guard that warns and writes anyway is worse than no guard, because it
// teaches the reader the write was refused.

const CLI = fileURLToPath(new URL("./index.ts", import.meta.url))

interface Recorded {
	method: string
	url: string
	body: string
}

interface Run {
	code: number | null
	stdout: string
	stderr: string
	requests: Recorded[]
}

async function runCli(args: string[], reply: unknown = { data: [] }) {
	const requests: Recorded[] = []
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = []
		req.on("data", (chunk: Buffer) => chunks.push(chunk))
		req.on("end", () => {
			requests.push({
				method: req.method ?? "",
				url: req.url ?? "",
				body: Buffer.concat(chunks).toString("utf8"),
			})
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify(reply))
		})
	})
	await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
	const { port } = server.address() as AddressInfo
	try {
		return await new Promise<Run>((resolve, reject) => {
			const child = spawn("npx", ["tsx", CLI, ...args], {
				env: {
					...process.env,
					IDENTITYFORGE_API_URL: `http://127.0.0.1:${port}`,
					IDENTITYFORGE_API_KEY: "ifk_test",
				},
			})
			let stdout = ""
			let stderr = ""
			child.stdout.on("data", (d) => {
				stdout += String(d)
			})
			child.stderr.on("data", (d) => {
				stderr += String(d)
			})
			child.on("error", reject)
			child.on("close", (code) => resolve({ code, stdout, stderr, requests }))
		})
	} finally {
		await new Promise<void>((ok) => server.close(() => ok()))
	}
}

const opsOf = (run: Run) =>
	(
		JSON.parse(run.requests[0].body) as {
			operations: Array<Record<string, unknown>>
		}
	).operations

test("naming move carries the marker through to the operation", async () => {
	const run = await runCli([
		"naming",
		"move",
		"cand-1",
		"--project",
		"p-1",
		"--status",
		"selected",
		"--expected-updated-at",
		"2026-07-27T00:11:22.333Z",
	])
	assert.equal(run.code, 0)
	assert.equal(run.requests.length, 1)
	assert.equal(run.requests[0].method, "PATCH")
	assert.deepEqual(opsOf(run), [
		{
			candidateId: "cand-1",
			status: "selected",
			expectedUpdatedAt: "2026-07-27T00:11:22.333Z",
		},
	])
})

test("the marker is sent byte for byte, never normalized", async () => {
	// It looks like a timestamp and is compared as an opaque string. Parsing it
	// into a Date and back is the change that would silently disarm the guard:
	// every write would 409, or worse, none would.
	const marker = "2026-07-27T00:11:22.333456+00:00"
	const run = await runCli([
		"naming",
		"rank",
		"cand-1=1",
		"--project",
		"p-1",
		"--expected-updated-at",
		marker,
	])
	assert.equal(run.code, 0)
	assert.equal(opsOf(run)[0].expectedUpdatedAt, marker)
})

test("a marker with several candidates is refused before anything is sent", async () => {
	// One marker identifies ONE row. Spreading it across a batch would guard
	// the wrong rows, so every such write would be rejected by the server and
	// the caller would learn nothing about why.
	const run = await runCli([
		"naming",
		"move",
		"cand-1",
		"cand-2",
		"--project",
		"p-1",
		"--status",
		"shortlisted",
		"--expected-updated-at",
		"2026-07-27T00:11:22.333Z",
	])
	assert.equal(run.code, 1)
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /guards a single candidate/)
	assert.match(run.stderr, /2 were given/)
})

test("the same refusal covers rank, which takes assignments not ids", async () => {
	const run = await runCli([
		"naming",
		"rank",
		"cand-1=1",
		"cand-2=2",
		"--project",
		"p-1",
		"--expected-updated-at",
		"2026-07-27T00:11:22.333Z",
	])
	assert.equal(run.code, 1)
	assert.deepEqual(run.requests, [])
	assert.match(run.stderr, /2 assignments were given/)
})

test("an unguarded move still writes, and says nothing about a marker", async () => {
	// The guard is opt-in on purpose. Requiring it would break every first move
	// made before a marker was read, and a guard everyone works around is worse
	// than none.
	const run = await runCli([
		"naming",
		"move",
		"cand-1",
		"cand-2",
		"--project",
		"p-1",
		"--status",
		"reviewing",
	])
	assert.equal(run.code, 0)
	assert.equal(run.requests.length, 1)
	assert.deepEqual(opsOf(run), [
		{ candidateId: "cand-1", status: "reviewing" },
		{ candidateId: "cand-2", status: "reviewing" },
	])
})

test("an unguarded selection warns, because that one is expensive to lose", async () => {
	// `themes update` warns on every unguarded write. This warns on ONE status,
	// deliberately: a warning that fires on routine work gets trained out and is
	// then absent for the write that needed it. `selected` is the naming write
	// shaped like a kit overwrite — one per project, and it also sets the
	// project's chosen brand name.
	const run = await runCli([
		"naming",
		"move",
		"cand-1",
		"--project",
		"p-1",
		"--status",
		"selected",
	])
	assert.equal(run.code, 0)
	// It warns and still writes. Refusing would break every first selection made
	// before a marker was read.
	assert.equal(run.requests.length, 1)
	assert.match(run.stderr, /--expected-updated-at/)
	assert.match(run.stderr, /chosen brand name/)
})

test("a guarded selection does not warn, and routine moves never do", async () => {
	const guarded = await runCli([
		"naming",
		"move",
		"cand-1",
		"--project",
		"p-1",
		"--status",
		"selected",
		"--expected-updated-at",
		"2026-07-27T00:11:22.333Z",
	])
	assert.equal(guarded.code, 0)
	assert.doesNotMatch(guarded.stderr, /Warning/)

	// The noise case: this is the move an agent makes twenty at a time.
	const routine = await runCli([
		"naming",
		"move",
		"cand-1",
		"cand-2",
		"--project",
		"p-1",
		"--status",
		"reviewing",
	])
	assert.equal(routine.code, 0)
	assert.doesNotMatch(routine.stderr, /Warning/)

	const ranked = await runCli(["naming", "rank", "cand-1=1", "--project", "p-1"])
	assert.equal(ranked.code, 0)
	assert.doesNotMatch(ranked.stderr, /Warning/)
})

test("evidence is read as JSON and applies to every moved candidate", async () => {
	// Unlike the marker, evidence is not row-specific: it records why this move
	// was made, which is the same answer for every candidate in the batch, so it
	// is spread across all of them rather than refused like the marker is.
	const file = join(tmpdir(), `if-evidence-${process.pid}.json`)
	writeFileSync(file, JSON.stringify({ source: "serp", collisions: 0 }))
	try {
		const run = await runCli([
			"naming",
			"move",
			"cand-1",
			"cand-2",
			"--project",
			"p-1",
			"--status",
			"rejected",
			"--evidence",
			file,
		])
		assert.equal(run.code, 0)
		assert.deepEqual(opsOf(run), [
			{
				candidateId: "cand-1",
				status: "rejected",
				evidence: { source: "serp", collisions: 0 },
			},
			{
				candidateId: "cand-2",
				status: "rejected",
				evidence: { source: "serp", collisions: 0 },
			},
		])
	} finally {
		rmSync(file, { force: true })
	}
})

test("malformed evidence is refused before the write, and names the flag", async () => {
	// The failure that matters: sending `{}` because the file would not parse
	// would record "no evidence" as though it were the considered answer.
	const file = join(tmpdir(), `if-evidence-bad-${process.pid}.json`)
	writeFileSync(file, "{not json")
	try {
		const run = await runCli([
			"naming",
			"move",
			"cand-1",
			"--project",
			"p-1",
			"--status",
			"rejected",
			"--evidence",
			file,
		])
		assert.equal(run.code, 1)
		assert.deepEqual(run.requests, [])
		assert.match(run.stderr, /--evidence/)
	} finally {
		rmSync(file, { force: true })
	}
})

test("naming domains asks for registrar evidence when told to", async () => {
	const run = await runCli(
		["naming", "domains", "example.com", "--registrar"],
		{ results: [] },
	)
	assert.equal(run.code, 0)
	const body = JSON.parse(run.requests[0].body) as {
		includeRegistrar?: boolean
		includeSerp?: boolean
	}
	assert.equal(body.includeRegistrar, true)
	// The other optional signal must not be switched on by association.
	assert.equal(body.includeSerp, false)
})
