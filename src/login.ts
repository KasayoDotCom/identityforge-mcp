import { spawn } from "node:child_process"
import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { hostname } from "node:os"
import { type CliTokenResult, exchangeCliToken } from "./api.js"
import { resolveApiUrl } from "./config.js"

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

const base64url = (buf: Buffer) => buf.toString("base64url")

function openBrowser(url: string): void {
	const platform = process.platform
	const [cmd, args] =
		platform === "darwin"
			? ["open", [url]]
			: platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]]
	try {
		const child = spawn(cmd as string, args as string[], {
			stdio: "ignore",
			detached: true,
		})
		child.on("error", () => {
			/* no browser available — the printed URL is the fallback */
		})
		child.unref()
	} catch {
		// ignore — user can open the printed URL manually
	}
}

function page(title: string, message: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0b0c;color:#e7e7e7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}.card{max-width:30rem;padding:2rem;text-align:center;line-height:1.5}h1{font-size:1.2rem;margin:0 0 .5rem}p{color:#9b9b9b;margin:0}</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`
}

/**
 * Browser sign-in via an OAuth-style PKCE loopback flow:
 *  1. generate a PKCE verifier/challenge + CSRF state, start a localhost server,
 *  2. open the browser to /cli/authorize (the user signs in + approves),
 *  3. the page redirects back to our loopback with a one-time `code`,
 *  4. exchange code + verifier at /api/cli/token for the API key.
 * The verifier never leaves this process, and the key is delivered only to this
 * machine's loopback address.
 */
export async function browserLogin(): Promise<CliTokenResult> {
	const verifier = base64url(crypto.randomBytes(32))
	const challenge = base64url(
		crypto.createHash("sha256").update(verifier).digest(),
	)
	const state = base64url(crypto.randomBytes(16))
	const label = `Identity Forge CLI · ${hostname()}`

	return new Promise<CliTokenResult>((resolve, reject) => {
		let settled = false
		const done = (fn: () => void) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			server.close()
			fn()
		}

		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1")
			if (url.pathname !== "/callback") {
				res.writeHead(404)
				res.end("Not found")
				return
			}

			const err = url.searchParams.get("error")
			if (err) {
				res.writeHead(200, { "content-type": "text/html" })
				res.end(page("Sign-in cancelled", "You can close this tab."))
				done(() => reject(new Error(`Authorization was denied (${err}).`)))
				return
			}

			const code = url.searchParams.get("code")
			const gotState = url.searchParams.get("state")
			if (!code || gotState !== state) {
				res.writeHead(400, { "content-type": "text/html" })
				res.end(page("Sign-in failed", "State mismatch. Please try again."))
				done(() => reject(new Error("State mismatch — aborting for safety.")))
				return
			}

			exchangeCliToken(code, verifier)
				.then((result) => {
					res.writeHead(200, { "content-type": "text/html" })
					res.end(
						page(
							"You're signed in",
							"Identity Forge is connected. You can close this tab and return to your terminal.",
						),
					)
					done(() => resolve(result))
				})
				.catch((e: unknown) => {
					res.writeHead(500, { "content-type": "text/html" })
					res.end(page("Sign-in failed", "Token exchange failed."))
					done(() => reject(e instanceof Error ? e : new Error(String(e))))
				})
		})

		const timer = setTimeout(() => {
			done(() =>
				reject(
					new Error("Timed out waiting for browser sign-in (10 minutes)."),
				),
			)
		}, LOGIN_TIMEOUT_MS)

		server.on("error", (e) => done(() => reject(e)))

		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port
			const redirect = `http://127.0.0.1:${port}/callback`
			const authorizeUrl = new URL("/cli/authorize", resolveApiUrl())
			authorizeUrl.searchParams.set("challenge", challenge)
			authorizeUrl.searchParams.set("state", state)
			authorizeUrl.searchParams.set("redirect", redirect)
			authorizeUrl.searchParams.set("label", label)
			const href = authorizeUrl.toString()
			process.stdout.write(
				`Opening your browser to sign in…\nNo account yet? Sign up there, complete the security check, select Send verification email, and open its link.\nThen approve the resumed authorization; the CLI receives the key automatically.\nIf it doesn't open, paste this URL:\n  ${href}\n`,
			)
			openBrowser(href)
		})
	})
}
