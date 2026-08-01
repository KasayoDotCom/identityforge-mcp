export function parseCandidateBatch(source: string): unknown[] {
	const parsed = JSON.parse(source) as unknown
	const candidates = Array.isArray(parsed)
		? parsed
		: parsed &&
				typeof parsed === "object" &&
				Array.isArray((parsed as { candidates?: unknown }).candidates)
			? (parsed as { candidates: unknown[] }).candidates
			: null
	if (!candidates) {
		throw new Error(
			'Candidate input must be a JSON array or an object with a "candidates" array.',
		)
	}
	if (candidates.length < 1 || candidates.length > 50) {
		throw new Error("Candidate input must contain between 1 and 50 items.")
	}
	return candidates
}
