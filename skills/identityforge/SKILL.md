---
name: identityforge
description: Use Identity Forge to choose, inspect, apply, or evolve a complete design system; create brand projects; research names, domains, or EUIPO trademarks; and retrieve implementation-ready DESIGN.md guidance and tokens.
---

# Identity Forge

Use the bundled Identity Forge MCP tools as the live source of truth. Do not copy a fixed
tool inventory or catalog into the conversation because both change independently of this
skill.

Free design-kit discovery works without an account or API key. Before an operation that
needs saved work, Pro kit contents, naming boards, writes, or account quota, call `whoami`
to inspect the current plan, scopes, quota, credits, and saved-kit slots.

If authentication is needed and `whoami` shows no account, tell the user to run:

```bash
npx --yes identityforge@latest login
```

Explain that browser signup requires opening the confirmation email. Once they confirm,
the pending CLI authorization resumes automatically. Never ask the user to paste an
`ifk_...` key into the conversation.

For design work, browse or search kits, inspect the chosen kit's DESIGN.md and tokens, and
use `apply_theme` only after the user has chosen a direction. Preview before overwriting a
project that may already contain generated files, and never use `force` without explicit
approval to replace the named files.

Canonical agent guide: https://identityforge.io/for-agents

API manifest: https://identityforge.io/api/v1

Machine-readable guide: https://identityforge.io/api/v1/llms.txt
