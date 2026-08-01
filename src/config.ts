import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** Canonical production API. Override with IDENTITYFORGE_API_URL (e.g. http://localhost:4000 in dev). */
export const DEFAULT_API_URL = "https://identityforge.io"

export interface CliConfig {
	/** Identity Forge API key (`ifk_…`). Written by `identityforge login`. */
	apiKey?: string
	/** Optional API base override; env IDENTITYFORGE_API_URL wins over this. */
	apiUrl?: string
	/** Account email, stored after login for `whoami` display. */
	account?: string
	/** Last npm registry check used by the CLI's non-blocking update nudge. */
	updateCheck?: {
		checkedAt: string
		latestVersion?: string
	}
}

const CONFIG_DIR = join(homedir(), ".identityforge")
export const CONFIG_PATH = join(CONFIG_DIR, "config.json")

export function readConfig(): CliConfig {
	try {
		if (!existsSync(CONFIG_PATH)) return {}
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as CliConfig
	} catch {
		return {}
	}
}

export function writeConfig(config: CliConfig): void {
	mkdirSync(CONFIG_DIR, { recursive: true })
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
		mode: 0o600,
	})
	// Ensure perms even if the file already existed with looser modes.
	try {
		chmodSync(CONFIG_PATH, 0o600)
	} catch {
		// best-effort on platforms without chmod semantics
	}
}

export function updateConfig(patch: Partial<CliConfig>): CliConfig {
	const next: CliConfig = { ...readConfig(), ...patch }
	// Drop explicitly-cleared keys so logout actually removes them.
	for (const key of Object.keys(patch) as (keyof CliConfig)[]) {
		if (patch[key] === undefined) delete next[key]
	}
	writeConfig(next)
	return next
}

export function resolveApiUrl(): string {
	const url =
		process.env.IDENTITYFORGE_API_URL || readConfig().apiUrl || DEFAULT_API_URL
	return url.replace(/\/+$/, "")
}

/** API key from env (CI / explicit) first, then the stored config. */
export function resolveApiKey(): string | undefined {
	return process.env.IDENTITYFORGE_API_KEY || readConfig().apiKey || undefined
}
