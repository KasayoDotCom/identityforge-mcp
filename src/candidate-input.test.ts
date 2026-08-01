import assert from "node:assert/strict"
import test from "node:test"
import { parseCandidateBatch } from "./candidate-input.js"

test("parseCandidateBatch accepts an array and a candidates wrapper", () => {
	const candidate = { candidateId: "a", name: "bront" }
	assert.deepEqual(parseCandidateBatch(JSON.stringify([candidate])), [
		candidate,
	])
	assert.deepEqual(
		parseCandidateBatch(JSON.stringify({ candidates: [candidate] })),
		[candidate],
	)
})

test("parseCandidateBatch rejects the wrong shape and batch bounds", () => {
	assert.throws(
		() => parseCandidateBatch('{"items":[]}'),
		/Candidate input must be a JSON array/,
	)
	assert.throws(() => parseCandidateBatch("[]"), /between 1 and 50 items/)
	assert.throws(
		() =>
			parseCandidateBatch(
				JSON.stringify(Array.from({ length: 51 }, () => ({}))),
			),
		/between 1 and 50 items/,
	)
})
