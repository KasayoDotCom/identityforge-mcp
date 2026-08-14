import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"

const packageJson = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
)
const run = promisify(execFile)
const { stdout } = await run(process.execPath, ["dist/index.js", "update-check"], {
	cwd: new URL("..", import.meta.url),
	timeout: 5000,
})
const status = JSON.parse(stdout)

assert.equal(status.currentVersion, packageJson.version)
assert.equal(typeof status.updateAvailable, "boolean")
assert.ok(["registry", "cache", "unavailable"].includes(status.source))
process.stdout.write(
	`Update-check smoke passed: ${status.currentVersion}, ${status.source}.\n`,
)
