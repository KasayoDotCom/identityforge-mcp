import assert from "node:assert/strict"
import test from "node:test"
import { isVersionGreater } from "./updateCheck.js"

test("update checks use semver ordering, including prereleases", () => {
	assert.equal(isVersionGreater("0.3.6", "0.3.5"), true)
	assert.equal(isVersionGreater("0.3.5", "0.3.5"), false)
	assert.equal(isVersionGreater("0.3.4", "0.3.5"), false)
	assert.equal(isVersionGreater("1.0.0", "0.99.99"), true)
	assert.equal(isVersionGreater("1.0.0", "1.0.0-beta.1"), true)
	assert.equal(isVersionGreater("1.0.0-beta.2", "1.0.0-beta.10"), false)
})
