import assert from "node:assert/strict"
import test from "node:test"
import {
	MCP_DOMAIN_INPUT_SCHEMA,
	MCP_DOMAIN_LANGUAGE_SCHEMA,
} from "./domain-schema.js"

test("MCP domain input matches the REST route's 300-character bound", () => {
	assert.equal(MCP_DOMAIN_INPUT_SCHEMA.safeParse("candidate.de").success, true)
	assert.equal(MCP_DOMAIN_INPUT_SCHEMA.safeParse("x".repeat(300)).success, true)
	assert.equal(
		MCP_DOMAIN_INPUT_SCHEMA.safeParse("x".repeat(301)).success,
		false,
	)
})

test("MCP language input matches the REST route's language-tag grammar", () => {
	for (const valid of ["de", "de-DE", "zh-Hant-TW", "en-001"]) {
		assert.equal(MCP_DOMAIN_LANGUAGE_SCHEMA.safeParse(valid).success, true)
	}
	for (const invalid of ["", "de_DE", "-de", "de-", "x", "germanish"]) {
		assert.equal(MCP_DOMAIN_LANGUAGE_SCHEMA.safeParse(invalid).success, false)
	}
})
