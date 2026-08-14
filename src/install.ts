import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const SUPPORTED_CLIENTS = [
	"claude-code",
	"cursor",
	"codex",
	"gemini",
	"vscode",
	"opencode",
	"pi",
] as const
export type Client = (typeof SUPPORTED_CLIENTS)[number]

const SERVER_KEY = "identityforge"
export const CLI_PACKAGE_SPEC = "identityforge@latest"
const NPX_ARGS = ["-y", CLI_PACKAGE_SPEC, "mcp"]

interface InstallOptions {
	/** Bake an IDENTITYFORGE_API_URL into the server env (for dev / self-host). */
	apiUrl?: string
	/** Target directory for project-scoped clients (default: cwd). */
	cwd?: string
	/** Home directory override for user-scoped clients. Used by diagnostics/tests. */
	homeDir?: string
}

export interface ClientConfigInspection {
	client: Client
	file: string
	configured: boolean
	current: boolean
	issue?: string
}

type JsonObject = Record<string, unknown>
type ConfigKind = "mcpServers" | "vscode" | "opencode" | "codex"

interface ClientSpec {
	label: string
	kind: ConfigKind
	/** Resolve the config file path for a given working directory. */
	path: (cwd: string, homeDir: string) => string
}

// Each agent runs the SAME local stdio server from the npm registry package;
// only the config file location + schema differ. Sources: each tool's MCP docs.
const CLIENTS: Record<Client, ClientSpec> = {
	"claude-code": {
		label: "Claude Code",
		kind: "mcpServers",
		path: (cwd) => join(cwd, ".mcp.json"),
	},
	cursor: {
		label: "Cursor",
		kind: "mcpServers",
		path: (cwd) => join(cwd, ".cursor", "mcp.json"),
	},
	gemini: {
		label: "Gemini CLI",
		kind: "mcpServers",
		path: (cwd) => join(cwd, ".gemini", "settings.json"),
	},
	codex: {
		label: "Codex",
		kind: "codex",
		path: (_cwd, homeDir) => join(homeDir, ".codex", "config.toml"),
	},
	vscode: {
		label: "VS Code / Copilot",
		kind: "vscode",
		path: (cwd) => join(cwd, ".vscode", "mcp.json"),
	},
	opencode: {
		label: "opencode",
		kind: "opencode",
		path: (cwd) => join(cwd, "opencode.json"),
	},
	pi: {
		label: "Pi",
		kind: "mcpServers",
		path: (cwd) => join(cwd, ".pi", "agent", "mcp.json"),
	},
}

function readJsonObject(file: string): JsonObject {
	if (!existsSync(file)) return {}
	try {
		return JSON.parse(readFileSync(file, "utf8")) as JsonObject
	} catch {
		throw new Error(
			`${file} exists but is not valid JSON — fix or remove it, then retry.`,
		)
	}
}

function writeJsonObject(file: string, data: JsonObject): void {
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

function envBlock(apiUrl: string | undefined, key: "env" | "environment") {
	return apiUrl ? { [key]: { IDENTITYFORGE_API_URL: apiUrl } } : {}
}

// Claude Code / Cursor / Gemini all use `{ mcpServers: { name: {command,args} } }`.
function writeMcpServers(file: string, apiUrl?: string): void {
	const json = readJsonObject(file)
	const existing = (json.mcpServers as JsonObject | undefined) ?? {}
	json.mcpServers = {
		...existing,
		[SERVER_KEY]: {
			command: "npx",
			args: NPX_ARGS,
			...envBlock(apiUrl, "env"),
		},
	}
	writeJsonObject(file, json)
}

// VS Code (and Copilot agent mode) use `{ servers: { name: {type:"stdio",…} } }`.
function writeVscode(file: string, apiUrl?: string): void {
	const json = readJsonObject(file)
	const existing = (json.servers as JsonObject | undefined) ?? {}
	json.servers = {
		...existing,
		[SERVER_KEY]: {
			type: "stdio",
			command: "npx",
			args: NPX_ARGS,
			...envBlock(apiUrl, "env"),
		},
	}
	writeJsonObject(file, json)
}

// opencode uses `{ mcp: { name: {type:"local", command:[…], enabled:true} } }`.
function writeOpencode(file: string, apiUrl?: string): void {
	const json = readJsonObject(file)
	if (!json.$schema) json.$schema = "https://opencode.ai/config.json"
	const existing = (json.mcp as JsonObject | undefined) ?? {}
	json.mcp = {
		...existing,
		[SERVER_KEY]: {
			type: "local",
			command: ["npx", ...NPX_ARGS],
			enabled: true,
			...envBlock(apiUrl, "environment"),
		},
	}
	writeJsonObject(file, json)
}

// Codex uses a TOML `[mcp_servers.<name>]` table; append if not already present.
function writeCodexToml(file: string, apiUrl?: string): void {
	const header = `[mcp_servers.${SERVER_KEY}]`
	const existing = existsSync(file) ? readFileSync(file, "utf8") : ""
	if (existing.includes(header)) {
		const entry = codexServerEntry(existing)
		if (entry && codexEntryIsCurrent(entry)) return
		throw new Error(
			`${file} already contains ${header}, but it does not run npx -y ${CLI_PACKAGE_SPEC} mcp. Repair or remove that table, then retry; Identity Forge did not overwrite it.`,
		)
	}
	const envLine = apiUrl
		? `\nenv = { IDENTITYFORGE_API_URL = "${apiUrl}" }`
		: ""
	const block = `\n${header}\ncommand = "npx"\nargs = ["-y", "${CLI_PACKAGE_SPEC}", "mcp"]${envLine}\n`
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(
		file,
		existing ? `${existing.replace(/\n*$/, "\n")}${block}` : block.trimStart(),
		"utf8",
	)
}

function codexServerEntry(source: string): string | undefined {
	const header = `[mcp_servers.${SERVER_KEY}]`
	const start = source.indexOf(header)
	if (start < 0) return undefined
	const rest = source.slice(start + header.length)
	const nextTable = rest.search(/\n\s*\[/)
	return nextTable < 0 ? rest : rest.slice(0, nextTable)
}

function codexEntryIsCurrent(entry: string): boolean {
	return (
		/^\s*command\s*=\s*["']npx["']\s*$/m.test(entry) &&
		/^\s*args\s*=\s*\[\s*["']-y["']\s*,\s*["']identityforge@latest["']\s*,\s*["']mcp["']\s*\]\s*$/m.test(
			entry,
		)
	)
}

function jsonServerIsCurrent(kind: ConfigKind, json: JsonObject): boolean {
	if (kind === "opencode") {
		const entry = (json.mcp as JsonObject | undefined)?.[SERVER_KEY] as
			| JsonObject
			| undefined
		return (
			entry?.type === "local" &&
			entry.enabled === true &&
			Array.isArray(entry.command) &&
			entry.command.join("\0") === ["npx", ...NPX_ARGS].join("\0")
		)
	}
	const parent = kind === "vscode" ? "servers" : "mcpServers"
	const entry = (json[parent] as JsonObject | undefined)?.[SERVER_KEY] as
		| JsonObject
		| undefined
	return (
		(kind !== "vscode" || entry?.type === "stdio") &&
		entry?.command === "npx" &&
		Array.isArray(entry.args) &&
		entry.args.join("\0") === NPX_ARGS.join("\0")
	)
}

export function configPathFor(
	client: Client,
	cwd = process.cwd(),
	homeDir = homedir(),
): string {
	return CLIENTS[client].path(cwd, homeDir)
}

/** Read-only check that the client points at the rolling public MCP package. */
export function inspectClientConfig(
	client: Client,
	opts: Pick<InstallOptions, "cwd" | "homeDir"> = {},
): ClientConfigInspection {
	const spec = CLIENTS[client]
	const file = spec.path(opts.cwd ?? process.cwd(), opts.homeDir ?? homedir())
	if (!existsSync(file)) {
		return {
			client,
			file,
			configured: false,
			current: false,
			issue: "Configuration file does not exist.",
		}
	}
	try {
		const source = readFileSync(file, "utf8")
		const current =
			spec.kind === "codex"
				? (() => {
						const entry = codexServerEntry(source)
						return entry !== undefined && codexEntryIsCurrent(entry)
					})()
				: jsonServerIsCurrent(spec.kind, JSON.parse(source) as JsonObject)
		return {
			client,
			file,
			configured: true,
			current,
			...(current
				? {}
				: {
						issue: `Identity Forge is not configured as npx -y ${CLI_PACKAGE_SPEC} mcp.`,
					}),
		}
	} catch (error) {
		return {
			client,
			file,
			configured: true,
			current: false,
			issue: error instanceof Error ? error.message : String(error),
		}
	}
}

/** Write the Identity Forge MCP server config for a coding agent. Returns the file written. */
export function installClient(
	client: Client,
	opts: InstallOptions = {},
): string {
	const spec = CLIENTS[client]
	if (!spec) {
		throw new Error(
			`Unknown client "${client}". Supported: ${SUPPORTED_CLIENTS.join(", ")}.`,
		)
	}
	const file = spec.path(opts.cwd ?? process.cwd(), opts.homeDir ?? homedir())
	switch (spec.kind) {
		case "mcpServers":
			writeMcpServers(file, opts.apiUrl)
			break
		case "vscode":
			writeVscode(file, opts.apiUrl)
			break
		case "opencode":
			writeOpencode(file, opts.apiUrl)
			break
		case "codex":
			writeCodexToml(file, opts.apiUrl)
			break
	}
	const inspection = inspectClientConfig(client, opts)
	if (!inspection.current) {
		throw new Error(
			`Identity Forge wrote ${file}, but verification failed: ${
				inspection.issue ?? "unknown configuration error"
			}`,
		)
	}
	return file
}
