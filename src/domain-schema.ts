import { z } from "zod"

export const MCP_DOMAIN_INPUT_SCHEMA = z.string().max(300)
export const MCP_DOMAIN_LANGUAGE_SCHEMA = z
	.string()
	.max(32)
	.regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/)
