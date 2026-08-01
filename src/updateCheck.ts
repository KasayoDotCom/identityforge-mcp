import { get } from "node:https"
import { readConfig, updateConfig } from "./config.js"

const REGISTRY_URL = "https://registry.npmjs.org/identityforge/latest"
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

type ParsedVersion = {
	major: number
	minor: number
	patch: number
	prerelease: string[]
}

function parseVersion(value: string): ParsedVersion | undefined {
	const match = value.trim().match(
		/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
	)
	if (!match) return undefined
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]?.split(".") ?? [],
	}
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
	for (const [a, b] of [
		[left.major, right.major],
		[left.minor, right.minor],
		[left.patch, right.patch],
	] as const) {
		if (a !== b) return a > b ? 1 : -1
	}
	if (!left.prerelease.length || !right.prerelease.length) {
		return left.prerelease.length === right.prerelease.length
			? 0
			: left.prerelease.length
				? -1
				: 1
	}
	for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
		const a = left.prerelease[i]
		const b = right.prerelease[i]
		if (a === undefined) return -1
		if (b === undefined) return 1
		if (a === b) continue
		const aNumber = /^\d+$/.test(a)
		const bNumber = /^\d+$/.test(b)
		if (aNumber && bNumber) return Number(a) > Number(b) ? 1 : -1
		if (aNumber !== bNumber) return aNumber ? -1 : 1
		return a > b ? 1 : -1
	}
	return 0
}

export function isVersionGreater(candidate: string, current: string): boolean {
	const left = parseVersion(candidate)
	const right = parseVersion(current)
	return left !== undefined && right !== undefined && compareVersions(left, right) > 0
}

let updateNoticePrinted = false

function printUpdateNotice(currentVersion: string, latestVersion: string): void {
	if (updateNoticePrinted) return
	updateNoticePrinted = true
	process.stderr.write(
		`Identity Forge update available: ${currentVersion} -> ${latestVersion}. Update with npm i -g identityforge@latest.\n`,
	)
}

function fetchLatestVersion(): Promise<string | undefined> {
	return new Promise((resolve) => {
		let settled = false
		const finish = (version?: string) => {
			if (settled) return
			settled = true
			resolve(version)
		}
		const request = get(
			REGISTRY_URL,
			{ headers: { Accept: "application/json" } },
			(response) => {
				let body = ""
				response.setEncoding("utf8")
				response.on("data", (chunk: string) => {
					body += chunk
				})
				response.on("end", () => {
					if (response.statusCode !== 200) return finish()
					try {
						const version = (JSON.parse(body) as { version?: unknown }).version
						finish(
							typeof version === "string" && parseVersion(version)
								? version
								: undefined,
						)
					} catch {
						finish()
					}
				})
				response.on("error", () => finish())
			},
		)
		request.on("socket", (socket) => socket.unref())
		request.on("error", () => finish())
		const timeout = setTimeout(() => {
			request.destroy()
			finish()
		}, 3000)
		timeout.unref()
	})
}

export async function checkForUpdate(currentVersion: string): Promise<void> {
	const config = readConfig()
	const cached = config.updateCheck
	if (cached?.latestVersion && isVersionGreater(cached.latestVersion, currentVersion)) {
		printUpdateNotice(currentVersion, cached.latestVersion)
	}

	const checkedAt = cached ? Date.parse(cached.checkedAt) : Number.NaN
	if (Number.isFinite(checkedAt) && Date.now() - checkedAt < CHECK_INTERVAL_MS) return

	let latestVersion: string | undefined
	try {
		latestVersion = await fetchLatestVersion()
		if (latestVersion) {
			if (isVersionGreater(latestVersion, currentVersion)) {
				printUpdateNotice(currentVersion, latestVersion)
			}
		}
	} catch {
		return
	} finally {
		try {
			updateConfig({
				updateCheck: {
					checkedAt: new Date().toISOString(),
					...(latestVersion ? { latestVersion } : {}),
				},
			})
		} catch {
			// An unwritable config must never affect the command being run.
		}
	}
}

/** Start the check without giving the network request a chance to hold up a command. */
export function startUpdateCheck(currentVersion: string): void {
	void checkForUpdate(currentVersion).catch(() => {})
}
