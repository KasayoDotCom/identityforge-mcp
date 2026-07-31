# Identity Forge MCP

This repository is the public distribution wrapper for the [Identity Forge](https://identityforge.io) MCP server. It pins the official npm package and provides the Dockerfile and metadata used by MCP registries such as Glama.

Product development happens in a separate private repository. This wrapper contains no private source or credentials.

Identity Forge gives coding agents tools to browse and apply complete design kits, create brand projects, and research names, domains, and EUIPO marks. Public Free kit discovery works without an API key. Pro kits, saved projects, and write operations require an Identity Forge account.

## Install for an agent

```sh
npx --yes identityforge@latest install --client claude-code
npx --yes identityforge@latest install --client codex
```

The installer adds the MCP server to the selected client. Free kits work immediately. When an account is needed, run `npx --yes identityforge@latest login`; browser signup includes email confirmation, then resumes authorization.

See the current agent guide at [identityforge.io/for-agents](https://identityforge.io/for-agents).

## Run directly

```sh
npx --yes identityforge@0.3.6 mcp
```

Set `IDENTITYFORGE_API_KEY` to an `ifk_...` key for authenticated tools.

## Docker

```sh
docker build -t identityforge-mcp .
docker run --rm -i identityforge-mcp
```

To pass an existing key:

```sh
docker run --rm -i -e IDENTITYFORGE_API_KEY identityforge-mcp
```

The published package is available on [npm](https://www.npmjs.com/package/identityforge).
