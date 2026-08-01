import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

/**
 * The MCP server has a guard that every registered tool is named in the
 * connect-time instructions and vice versa, and it earned its keep the day it
 * was written: it failed the moment two new tools shipped without being added
 * to the instructions. The CLI had no equivalent, so twelve commands were added
 * to it in one night with nothing checking that the README kept up.
 *
 * The README is the CLI's discovery surface the way WORKFLOW_INSTRUCTIONS is the
 * MCP server's. A command absent from it is a command nobody runs; a command
 * documented and absent from the binary sends a reader into an error. Both
 * directions matter and this checks both.
 */

const INDEX = readFileSync(
	fileURLToPath(new URL("./index.ts", import.meta.url)),
	"utf8",
)
const README = readFileSync(
	fileURLToPath(new URL("../README.md", import.meta.url)),
	"utf8",
)
const MCP = readFileSync(
	fileURLToPath(new URL("./mcp.ts", import.meta.url)),
	"utf8",
)
const LOGIN = readFileSync(
	fileURLToPath(new URL("./login.ts", import.meta.url)),
	"utf8",
)
const SERVER = readFileSync(
	fileURLToPath(new URL("../server.json", import.meta.url)),
	"utf8",
)

test("agent-facing signup guidance matches the explicit verification flow", () => {
	for (const source of [README, MCP, LOGIN, SERVER]) {
		assert.match(source, /Send verification email/)
		assert.doesNotMatch(
			source,
			/browser signup sends (?:a )?(?:confirmation|verification) email|signup waits for email confirmation/i,
		)
	}
})

/**
 * Commander's tree is built as `const themes = program.command("themes")` and
 * then `themes.command("history")`, so the full path a user types is the parent
 * variable name plus the child literal. Reading the variable name is what makes
 * "themes history" recoverable rather than a bare "history" that matches
 * anything.
 */
function commandPaths(): string[] {
	const parents = new Map<string, string>()
	for (const match of INDEX.matchAll(
		/const\s+(\w+)\s*=\s*program\s*\.\s*command\(\s*"([a-z][a-z-]*)"/g,
	)) {
		parents.set(match[1], match[2])
	}

	const paths = new Set<string>()
	for (const match of INDEX.matchAll(
		/(\w+)\s*\.\s*command\(\s*"([a-z][a-z-]*)"/g,
	)) {
		const [, receiver, name] = match
		if (receiver === "program") {
			paths.add(name)
			continue
		}
		const parent = parents.get(receiver)
		if (parent) paths.add(`${parent} ${name}`)
	}
	return [...paths].sort()
}

/**
 * Documented means SHOWN AS AN INVOCATION — `identityforge <path>` — and not
 * merely present as characters somewhere in the file.
 *
 * A bare `README.includes(cmd)` passes for any command whose name is a common
 * word or a flag used elsewhere. `status` was matched by `--status shortlisted`
 * in an unrelated naming example, and `brand version` was matched by the `brand
 * versions` line one command over: a plural swallows its own singular, which is
 * the worst case because the two commands are real and different. Both were
 * genuinely undocumented while the guard was green.
 *
 * The version suffix is allowed because the README's install lines are written
 * `npx --yes identityforge@latest install`, which is the invocation a reader
 * actually types.
 */
function documented(cmd: string): boolean {
	return new RegExp(
		`identityforge(@[\\w.-]+)?\\s+${cmd.replace(/ /g, "\\s+")}\\b`,
	).test(README)
}

test("every CLI command appears in the README as an invocation", () => {
	const undocumented = commandPaths().filter((cmd) => !documented(cmd))
	assert.deepEqual(
		undocumented,
		[],
		`registered but not shown as \`identityforge <command>\` in cli/README.md: ${undocumented.join(
			", ",
		)}`,
	)
})

test("the README does not document a command that no longer exists", () => {
	const registered = commandPaths()
	const registeredSet = new Set(registered)
	// A command that has subcommands. `themes` is one; `apply` is not.
	const parents = new Set(
		registered
			.filter((cmd) => cmd.includes(" "))
			.map((cmd) => cmd.split(" ")[0] as string),
	)

	// Only claims written as a runnable invocation count. Prose that happens to
	// contain a command word is not a promise that the command exists.
	const claimed = new Set<string>()
	for (const match of README.matchAll(
		/^\s*(?:\$\s*)?identityforge\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/gm,
	)) {
		const [, first, second] = match
		// Under a parent, the second word IS a subcommand and has to resolve —
		// resolving it to the bare parent instead would let `themes teleport`
		// pass, which is the exact drift this test is for. Elsewhere the second
		// word is an argument (`apply <slug>`) and only the first word is a claim.
		// Flags and placeholders never match the pattern, so they never get here.
		if (second && parents.has(first as string))
			claimed.add(`${first} ${second}`)
		else claimed.add(first as string)
	}

	const phantom = [...claimed].filter(
		(cmd) => !registeredSet.has(cmd) && !parents.has(cmd),
	)
	assert.deepEqual(
		phantom,
		[],
		`documented in cli/README.md but not registered: ${phantom.join(", ")}`,
	)
})

/**
 * `use` RE-ORDERS the catalog for a lane. It does not narrow it: measured across
 * all 75 kits, no kit-by-lane pair scored below the documented cut. Every wording
 * below has actually shipped saying otherwise, and each was found only after the
 * previous one was fixed, because each fix corrected the surface it was reported
 * on and left the paraphrase next door.
 *
 * That is the failure this guards. A sweep for the exact phrase from the last
 * report reads as clean while the same claim sits one synonym away, so the check
 * has to hold every form that has ever shipped rather than the current one.
 *
 * It cannot catch a NEW paraphrase. Nothing mechanical can. When a fix lands
 * here, add the wording it replaced to this list.
 */
const NARROWING_CLAIMS: { pattern: RegExp; shipped: string }[] = [
	{
		pattern: /only kits[^.]{0,60}\bfit\b/i,
		shipped: "README 0.3.3: returns only kits genuinely fit for dashboards",
	},
	{
		pattern: /\bfilter\w*\b[^.]{0,40}\blane\b/i,
		shipped: "README 0.3.3: Filter to a judged use-case lane with `use`",
	},
	{
		pattern: /\bfilters and ranks\b/i,
		shipped: "mcp.ts 0.3.3, search_themes: since it filters and ranks for you",
	},
	{
		pattern: /too subtle to filter on/i,
		shipped: "mcp.ts 0.3.3, list_themes: too subtle to filter on",
	},
	{
		pattern: /trust a filter\b/i,
		shipped: "mcp.ts 0.3.3, search_themes: than trust a filter",
	},
]

test("no agent-facing surface claims that `use` narrows the catalog", () => {
	const found: string[] = []
	for (const [surface, text] of [
		["cli/README.md", README],
		["cli/src/mcp.ts", MCP],
	] as const) {
		for (const { pattern, shipped } of NARROWING_CLAIMS) {
			const hit = text.match(pattern)
			if (hit) found.push(`${surface}: "${hit[0]}" (last shipped as ${shipped})`)
		}
	}
	assert.deepEqual(
		found,
		[],
		`\`use\` re-orders the catalog and never narrows it, but these say it filters:\n${found.join("\n")}`,
	)
})
