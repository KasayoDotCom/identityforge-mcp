# Public repository guardrails

This repository and its complete Git history are public. Treat every staged file, diff, fixture, comment, and asset as publishable.

- Never commit credentials, secrets, private endpoints, customer or user data, internal-only documents, paid kit payloads, or proprietary application source.
- Use visibly redacted examples such as `ifk_…`; never use realistic token-shaped sample values.
- Review files mirrored from another workspace individually. Their origin is not approval for public release.
- Commit only final media that is owned or licensed, visually reviewed at its target size, free of private UI or data, and supplied with useful alt text. Keep drafts and generated variants out of Git.
- Before committing, inspect `git status --short` and the staged diff. Before a release, run the test, typecheck, and build scripts and inspect `npm pack --dry-run`.
- Keep package metadata, documentation, and examples pointed at public URLs and the public repository.
- Git history is durable. If public safety or publication rights are uncertain, stop before staging the file.
