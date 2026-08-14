import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CLI_VERSION } from "./api.js"
import { buildMcpServer } from "./mcp.js"

const CAPABILITY_GROUPS = {
	designSystems: ["list_themes", "get_design_md", "get_tokens", "apply_theme"],
	brandDelivery: [
		"create_brand_project",
		"export_brand",
		"share_brand_project",
	],
	naming: ["create_naming_project", "generate_names", "list_name_candidates"],
	domains: ["check_domains", "assess_domain_acquisition"],
	trademarks: ["search_trademarks"],
} as const

export interface McpDiagnostic {
	version: string
	toolCount: number
	capabilities: Record<keyof typeof CAPABILITY_GROUPS, boolean>
	missingRequiredTools: string[]
}

/** Exercise the current package over a real MCP transport without calling the API. */
export async function inspectCurrentMcp(): Promise<McpDiagnostic> {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair()
	const client = new McpClient({
		name: "identityforge-doctor",
		version: CLI_VERSION,
	})
	const server = buildMcpServer()
	await Promise.all([
		client.connect(clientTransport),
		server.connect(serverTransport),
	])
	try {
		const { tools } = await client.listTools()
		const names = new Set(tools.map((tool) => tool.name))
		const capabilities = Object.fromEntries(
			Object.entries(CAPABILITY_GROUPS).map(([group, required]) => [
				group,
				required.every((name) => names.has(name)),
			]),
		) as Record<keyof typeof CAPABILITY_GROUPS, boolean>
		const missingRequiredTools = Object.values(CAPABILITY_GROUPS)
			.flat()
			.filter((name) => !names.has(name))
		return {
			version: CLI_VERSION,
			toolCount: tools.length,
			capabilities,
			missingRequiredTools,
		}
	} finally {
		await client.close()
		await server.close()
	}
}
