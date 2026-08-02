<p align="center">
  <a href="https://identityforge.io">
    <img src="https://identityforge.io/opengraph-image.png" alt="Identity Forge branding pipeline from names and design kits to agent-ready systems" width="1200">
  </a>
</p>

<h1 align="center">Identity Forge MCP</h1>

<p align="center"><strong>The branding pipeline for the agentic era.</strong></p>

<p align="center">Give coding agents a complete design system, then carry it from first build to later updates and client handoff.</p>

<p align="center">
  <a href="#for-people">For people</a> ·
  <a href="#for-agents">For agents</a> ·
  <a href="#capabilities">Capabilities</a> ·
  <a href="#watch-it-work">Watch it work</a> ·
  <a href="#reference">Reference</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/identityforge"><img src="https://img.shields.io/npm/v/identityforge" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/identityforge"><img src="https://img.shields.io/npm/dw/identityforge?label=weekly%20downloads" alt="weekly npm downloads"></a>
  <a href="https://github.com/KasayoDotCom/identityforge-mcp/actions/workflows/ci.yml"><img src="https://github.com/KasayoDotCom/identityforge-mcp/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/identityforge" alt="MIT license"></a>
</p>

## For people

- **Start with a complete design kit.** Typography, semantic color tokens, layout, spacing, motifs, dos and don'ts, and an implementation-ready `DESIGN.md` travel together.
- **Choose with evidence.** Your agent can search the catalog, rank kits for the product and its surfaces, inspect the full brief, and compare nearby directions.
- **Apply safely.** Identity Forge writes the brief, tokens, and a version stamp, then protects files that changed locally.
- **Compose the whole brand.** Add an image direction, interface style, and page recipes while keeping the supplied product, person, or object recognizable.
- **Carry decisions forward.** Version history, drift checks, naming and domain research, saved projects, client shares, and feedback stay in the same workflow.

Public Free kits are ready immediately. An account adds persistent projects, saved work, authenticated quota, and Pro access.

[Browse the design kits](https://identityforge.io/kits) · [See the agent workflow](https://identityforge.io/for-agents) · [Read the HTTP API](https://identityforge.io/api/v1)

## For agents

Install the local MCP server into your coding agent:

```bash
npx --yes identityforge@latest install --client claude-code
```

Use `cursor`, `vscode`, `codex`, `gemini`, `opencode`, or `pi` in place of
`claude-code`. The installer merges the MCP entry into the client's existing
configuration.

Then tell your agent:

> Use Identity Forge to pick a theme that fits this product, apply it, and follow the DESIGN.md.

Sign in when you want persistent projects, saved work, authenticated quota, or Pro access:

```bash
npx --yes identityforge@latest login
```

No account yet? In the browser, sign up, complete the security check, select
`Send verification email`, and open its link. Then select
`Confirm email and continue`, approve the resumed authorization, and the CLI
receives the key automatically.

## Capabilities

Once connected, your agent gets 61 tools grouped around real jobs:

- **Find the right system:** search, rank, compare, and inspect complete design kits.
- **Build from it:** export `DESIGN.md`, CSS, Tailwind v3 or v4, shadcn registry data, DTCG tokens, or JSON.
- **Apply and maintain it:** preview writes, protect local changes, inspect status, compare versions, and follow drift.
- **Direct the presentation:** codify image directions, interface styles, and page recipes around the chosen kit.
- **Build a client-ready brand:** compose variations, generate mockups, share a review link, and act on feedback.
- **Name and research:** manage a persistent naming board and collect domain, trademark, registrar, DNS, RDAP, and search evidence.

## Watch it work

The three-minute lifecycle film follows a design system from the first choice through later updates, an older-site rebuild, and a client handoff. The Aubade storefront, Shiftly rebuild, and Kestrel rebrand are complete one-shot agent builds from real Identity Forge design systems.

https://github.com/user-attachments/assets/e139a54f-8b06-4ba0-830f-0a476533d166

[Download the full-resolution 1080p WebM](https://github.com/KasayoDotCom/identityforge-mcp/releases/download/v0.3.10/identity-forge-lifecycle-explainer-v2.webm).

## Reference

The complete behavior and command inventory stays here for agents and implementation work. Expand only the part you need.

<details>
<summary><strong>Discovery and installation details</strong></summary>

## Judged discovery

Every kit in the catalog is scored per use case against concrete criteria measured on its own tokens: chart-series distinctness, text contrast, information density, and similar, rather than keyword matching. The per-lane prose justification is switched off catalogue-wide pending re-enrichment, so a score arrives without a sentence explaining it. Your agent can use the scores directly:

- `list_themes({ use: "data-dashboard" })` re-orders the catalog by fitness for dashboards rather than narrowing it, each kit carrying a score from 0 to 100 computed from its own tokens against the lane's criteria.
- `list_themes({ q: "calm fintech dashboard" })` runs a synonym-aware ranked search across moods, industries, and use cases.
- `search_themes` returns the whole catalog unranked so the agent can weigh a subtle brief itself.

Read the order, not the number. The score measures how well a kit is built against a lane's criteria, and every catalog kit is well built, so the scores cluster high and the documented cut excludes almost nothing. A lane changes which kits come first, not which kits come back.

For the data lanes there is a better answer than the score. Every kit summary carries a `charts` block measured on the mode the kit ships in: `minDeltaE` and `cvdMinDeltaE` (the closest pair of series colors, plain and under colorblind simulation), `distinct`, `hueFamilies`, `severityHeadroom` (how close any series comes to the destructive, warning and success roles — 0 means a category color IS a status color), `sequentialReady`, and `designed`, which is `false` when the kit defines no chart slots and the five were cycled from its brand roles. Those are measurements, so unlike the fitness score they can be stated to a user as the reason for a recommendation.

Use-case lanes: `data-dashboard`, `admin-internal-tool`, `saas-marketing`, `landing-page`, `ecommerce-store`, `portfolio`, `editorial-blog`, `docs-knowledge-base`, `mobile-app`, `business-services`, `community-social`, `ai-agent-chat`.

The same discovery runs the [kit gallery](https://identityforge.io/kits) and the [HTTP API](https://identityforge.io/api/v1) (`GET /api/v1/kits?use=…&q=…`, see [llms.txt](https://identityforge.io/api/v1/llms.txt)).

## Install into an agent

`install --client <name>` writes the MCP server config for that agent, merging into any existing config:

| Client | `--client` | Config file |
| --- | --- | --- |
| Claude Code | `claude-code` | `.mcp.json` |
| Cursor | `cursor` | `.cursor/mcp.json` |
| Codex | `codex` | `~/.codex/config.toml` |
| Gemini CLI | `gemini` | `.gemini/settings.json` |
| VS Code / Copilot | `vscode` | `.vscode/mcp.json` |
| opencode | `opencode` | `opencode.json` |
| Pi | `pi` | `.pi/agent/mcp.json` |

All of them run the same local stdio server via `npx -y identityforge@latest mcp`.

### Install the agent plugin and skill

The repository also bundles the MCP server with an Agent Skill that tells the agent when
to use Identity Forge, how free and authenticated access differ, and how to guide a human
through `Send verification email` before the pending browser authorization resumes.

Claude Code:

```bash
claude plugin marketplace add KasayoDotCom/identityforge-mcp
claude plugin install identity-forge@identity-forge
```

GitHub Copilot CLI:

```bash
copilot plugin marketplace add KasayoDotCom/identityforge-mcp
copilot plugin install identity-forge@identity-forge
```

Codex and other Agent Skills-compatible clients:

```bash
npx skills add KasayoDotCom/identityforge-mcp
```

Cursor metadata is included for directory distribution. Until it is listed there, use
the `install --client cursor` command above to connect the same MCP server.

</details>

<details>
<summary><strong>MCP tools, workflows, safety, and version behavior</strong></summary>

## MCP tools

Once connected, your agent gets 61 tools. Browsing free kits needs no key; scopes are noted where they apply.

### Find a design kit

- `list_themes`: browse the catalog as compact summaries. Rank by use-case lane with `use`, run ranked search with `q`, page with `offset`, sort by `featured`, `popular`, `recent`, `name`, or `fit`.
- `search_themes`: return the whole catalog unranked, for briefs too subtle to rank against a lane.
- `similar_themes`: given a kit slug, find neighbours by palette, tags, and audience.
- `match_palette`: given existing brand colors, rank kits by perceptual color distance.

### Read and apply one

- `get_design_md`: fetch a kit's DESIGN.md, the full design brief.
- `get_tokens`: fetch tokens as `dtcg`, `css`, `tailwind-v3`, `tailwind-v4`, `shadcn-registry`, or `json`.
- `apply_theme`: write DESIGN.md, a tokens file, and an `identityforge.json` stamp into the project. It refuses rather than overwriting a file it did not write, see below.

## What `apply` writes, and what it will not overwrite

`apply_theme` (and `identityforge apply`) writes three files into the target directory:

| File | What it is |
| --- | --- |
| `DESIGN.md` | the design brief the agent builds from |
| `<slug>.css` / `.json` / `.js` | the tokens, named for the format you asked for |
| `identityforge.json` | the stamp: which kit was applied, at which version, and a SHA-256 of every file written |

The stamp belongs to your repository, not to the kit. It records what this codebase was built against, which is a fact the server cannot know, so commit it. It is also what makes applying safe: before writing anything, `apply` compares what is on disk against the hashes in the stamp.

- A file that does not exist gets created.
- A file whose content already matches the kit is left alone.
- A file the last apply wrote, still byte-identical, is updated when the kit has moved.
- A file that is **not recorded in the stamp**, for example a `DESIGN.md` you wrote yourself, or one that **changed since it was written**, is a **conflict**.

On a conflict the default is to write nothing at all, name every conflicting file, and exit non-zero. Nothing is written until every file is planned, so a failed fetch cannot leave the directory half applied.

```bash
identityforge apply acid-signal-black --preview   # plan only, writes nothing
identityforge apply acid-signal-black             # refuses if anything conflicts
identityforge apply acid-signal-black --force     # overwrites, content is lost
```

`--force` is destructive and unrecoverable: the current content of the conflicting files is gone, and the report names each one. Preview first, show the person what would change, and let them decide.

### What the stamp records, and how a later apply reads it

```jsonc
{
  "stampVersion": 1,          // shape of this file, so a reader never has to guess
  "designMdContract": "1.0",  // shape of the DESIGN.md you built against — not the kit's
                              // revision and not this file's. Three different versions
                              // live here; flattening any two invents a baseline.
  "kit": {
    "id": "c2d13a12-…",       // permanent. diff against this, never the slug
    "slug": "sage-slate-editorial",
    "version": 0,             // the kit's monotonic revision, as the export reported it
    "designMdDigest": "sha256:…"
  },
  "layers": [],
  "artifacts": [{ "path": "DESIGN.md", "hash": "sha256:…", "writtenAt": "…" }],
  "integration": { "tokensEntry": null },
  "appliedAt": "…"
}
```

`kit.version` has three distinct meanings and they must not be collapsed. A number is the kit's revision. **`0` means the kit exists and has no minted version yet.** **`null` means the export did not report a version at all**, which is a different fact, and reading it as `0` would put a baseline in your repository that was never true. Identity is copied from the export's own front matter; nothing here is inferred.

Re-applying reads that back:

- **The version moved** — the server's own count says the kit changed. Re-read the brief.
- **Same version, different rendered file** — the `DESIGN.md` serializer changed, not the kit. No action.
- **No version on both sides** — only the digest is available, and it cannot tell those two cases apart, so it says so rather than guessing.

Because the id is the durable handle, renaming a kit's slug is not reported as "you applied a different kit". A stamp written by a newer CLI than yours is refused rather than half-understood: every file counts as unrecorded, so the apply stops instead of overwriting on a record it cannot fully read.

### `status`: ask the stamp what moved

```bash
identityforge status              # the current directory
identityforge status --dir apps/web
```

It takes no kit and no version, because the stamp already holds both. `themes diff --from N` needs you to know the kit and read the number out of the JSON yourself; `apply --preview` needs the slug and fetches a whole write plan to answer a read-only question. `status` reads `identityforge.json`, asks the server by **id**, and reports the three movements the stamp implies, separately:

- **`kitMoved`** — the server's own version count differs. The design changed.
- **`documentMoved`** — the rendered `DESIGN.md` bytes differ. A serializer change alone does that to every kit at once, so on its own it is not a reason to touch your code.
- **`contractMoved`** — `designMdContract` differs. The document's *shape* changed: a section added, renamed, or removed. That is a third question, and neither of the other two answers it.

Each is `null` rather than `false` when one side cannot answer, and a note says which side was missing. If the kit did move and both versions are numbers, the same diff `themes diff` would have printed is included. It also hashes every artifact the stamp recorded against what is on disk, so a `DESIGN.md` you have since edited by hand shows as `modified` before you re-apply over it.

It writes nothing and never touches the working tree. Losing your key or hitting a Pro gate degrades it to a local-only report with a note, rather than failing. JSON goes to stdout and the human summary to stderr, so `identityforge status | jq .moved` works while a person still sees the sentence.

### Complementary collections

These answer questions a kit does not. None of them replace the kit.

- `list_image_directions` / `get_image_direction`: choose and export how the project's imagery should be presented and repeated.
- `list_interface_styles` / `get_interface_style`: choose and export a neutral render grammar for surfaces and hierarchy, applied through a kit.
- `list_page_recipes` / `get_page_recipe`: choose and export how a page should argue its case.

When the user supplies a real product, person, or object, keep that reference recognizable. Use
the chosen image direction to shape project-specific presentation routes around it: setting,
supporting elements, composition, lighting, surfaces, crop, finish, and variation rules. After the
person chooses, codify the route for the image model they use. Identity Forge provides the brief;
it does not render the images in this flow.

### Author kits and brands (`kits:write`)

- `create_theme`: author a private kit from scratch or by forking a catalog kit with overrides covering tokens, colors, fonts, and facet presets.
- `remix_theme`: copy a resolvable kit into a new private kit with overrides applied.
- `update_theme`: edit one of your saved kits in place, keeping its slug and publication state so existing consumers follow the change. Overwrites the stored kit, but every save mints a version, so the replaced state stays readable through the version tools below. The slug itself cannot be renamed here, and `expectedUpdatedAt` turns a concurrent edit into a 409 instead of a silent overwrite.
- `delete_theme`: permanently delete one of your saved kits. Pass `confirm: true`; a kit still referenced by a brand project is refused with `409 kit_in_use`, so retire or repoint those references first.
- `create_brand_project` and `list_brand_projects`: the container for brand variations and a client share.
- `add_brand_variation`: attach a proposal to a project, with a kit plus optional name, domain, label, and notes.
- `update_brand_variation`: revise one proposal in place, including repointing it at a different kit. The client sees it on their next view.
- `remove_brand_variation`: permanently delete one proposal and its comments. Pass `confirm: true`; it is not undoable.
- `revoke_brand_share`: permanently withdraw a client link. Pass `confirm: true`; sharing again mints a new token.
- `reorder_brand_variations`: set the order the client meets the directions in. Must list every variation exactly once.
- `share_brand_project`: create or rotate a read-only `/p/<token>` client share link, optionally password protected.
- `list_client_comments` (`kits:read`): read what the client wrote on each variation. The return leg of the share loop.

### Compose the other axes onto a brand

A brand is a design kit plus an image direction, an interface style, and any number of page recipes. Those references live on the PROJECT, not the kit, so swapping the kit leaves them alone.

- `get_brand_layers` (`kits:read`): what a brand is composed of, with both revision numbers on every reference and `drift` present only where the record has moved since it was pinned. `meta.drifted` counts them, and `links.preview` is the composition rendered as an image. Reads nothing into the brand: no version is minted and no pin moves.
- `add_brand_layer`: compose one record onto the brand, recording the revision it is at now so a later read can report a change rather than apply it silently. One tool for all three axes via `axis`. Image direction and interface style hold one each; a second is refused with 409 unless you pass `replace: true`, which is also how you accept a drifted revision.
- `remove_brand_layer`: take one off. Pass `confirm: true`; it names the record rather than the axis, so a stale view cannot clear a layer it never saw, and repeating it is a no-op.
- `export_brand` (`kits:read`): the brand as ONE document, ready to build from — the kit's `DESIGN.md` with every pinned layer written into it, under the precedence rule that decides which wins when they disagree (the kit owns identity, a layer owns application). Use it instead of merging the kit and each layer yourself. A layer the key cannot open is named with its page and an upgrade path rather than dropped; a brand with no chosen kit answers 409 instead of returning a placeholder nobody picked.

### Describe the product once, then get proposals grounded in it

- `get_project_context` / `set_project_context`: store what the product is — what it does, who it is for, its constraints, what has been ruled out, its screens, its stack — on a brand project. Every later proposal is grounded in it, including in a session that never saw the description.
- `recommend_kits({projectId})`: candidates for that product, each carrying the kit's own evidence and its judged fitness for the surfaces the product actually has. With Pro and a `kits:write` key you also get a model ranking with a reason per candidate; `meta.depth` is `ranked` or `candidates`.

Two things that surprise people:

- **`set_project_context` REPLACES.** The endpoint is `PUT`, not `PATCH`, so a field you omit is deleted rather than kept. That is deliberate — a merging update would let you drop a surface from the list and silently keep the old one — but it means you read with `get_project_context` first and send the whole object back with your edit applied.
- **`recommend_kits` costs 3 quota units and needs a key**, where `list_themes` costs 1 and every other discovery route works anonymously. The reasoning is in the route's own docstring: it takes a free-text body rather than query parameters, and it is the one route that can grow into a metered model call. Writing a context needs `kits:write`; reading one needs only `kits:read`.

### Has it changed since I built? (read-only)

- `list_kit_versions`, `get_kit_version`, `diff_kit_versions`: a kit's version timeline, one past snapshot in full, and what moved between two versions. `diff_kit_versions({slug, from})` with no upper bound compares against the current version, which is the question a repo with an `identityforge.json` actually has.
- `list_brand_project_versions`, `get_brand_project_version`, `diff_brand_project_versions`: the same three for a brand project, owner-scoped.
- `list_kit_history`, `get_kit_history_event`: the same kit's ledger, which is a wider record than its version timeline. `kit_history_events` carries three event types — created, saved, and applied to a brand — and only the first two mint a version, so an apply appears in the ledger and nowhere else. Ask the ledger whether a kit was ever actually used; ask the timeline what its tokens were. It pages by an opaque cursor rather than a version number, because an event has no ordinal to page below.
**Share: pause or withdraw.** `update-share` is the reversible one and almost always the
right one — `--disable` pauses the link, the token is untouched, and a URL already with the
client works again the moment you resume. `revoke-share` is permanent: the `/p/<token>` URL
stops resolving wherever it was pasted, including in an email already sent, and sharing
again mints a new token and deliberately never the old one. It refuses without `--yes`.

- `whoami`: plan, granted and missing scopes, remaining quota, AI credits, and saved-kit slots. Free, and never refused for being over quota, so it still answers after a 429.

None of these writes anything. Restoring an old state is an `update_theme` call you make deliberately.

**What actually has history.** Only kits saved under an API key accumulate versions: a curated catalog kit is shipped rather than edited, so its timeline is empty and its version stays `0`. On brand projects the whole brand is recorded: name and domain, fonts, pinned layers, project context, and the variations, including a reorder. What is deliberately not recorded is sharing — who may see a brand is not what the brand is. A project that has not been written since versioning was wired shows an empty timeline because the record starts there, not because nothing happened to it.

**What a Pro gate does to them.** For a kit you are not entitled to, the timeline still lists versions but the author's free-text note is `null`, and a diff returns each change marked `redacted: true` with its path and CSS variable but no before or after, plus a `redactedChanges` count. `get_kit_version` returns the whole payload, so it answers 403 instead.

### Name a brand (`naming:read` / `naming:write`)

- `list_naming_recipes`: the full naming strategy catalog.
- `list_naming_projects` and `create_naming_project`: reuse or create a durable board.
- `generate_names`: generate with Identity Forge's own model. Spends AI credits only when unique candidates persist.
- `add_name_candidates`: persist names from the active agent, an authorized offline process, or manual research, using stable caller UUIDs. Spends no credits.
- `list_name_candidates`: read the kanban board with provenance and evidence.
- `list_name_generations`: audit model, prompt, request, and credit provenance.
- `move_name_candidates` and `rank_name_candidates`: atomically review, shortlist, rank, and select.
- `get_naming_research_context`: read the brief, board, evidence, capabilities, and small-task handoff contract, without server ranking.
- `search_name_evidence`: run bounded model-authored searches and return evidence without verdicts.
- `check_domains`: DNS plus distinct RDAP, registrar, and optional SERP evidence. Absent DNS records only mean a domain might be available, so verify at a registrar before promising it to anyone.

### Build a brand and share it with a client

The `kits:write` tools let an agent build a whole brand package end to end:

1. `create_theme` or `remix_theme` to compose four or five contrasting directions, either forking a catalog kit and overriding colors, fonts, and facets, or authoring from scratch.
2. `create_brand_project`, one project per client brief.
3. `add_brand_variation` to attach each direction with a brand name, domain, and label.
4. `share_brand_project` to hand the client a `/p/<token>` link, optionally password protected, where they cycle the variations and comment.
5. `list_client_comments` to read what came back, then `update_theme`, `update_brand_variation`, `remove_brand_variation`, and `reorder_brand_variations` to revise the same board rather than starting a second one.

Everything an agent creates it can also revise. The write tools change live, client-visible state; destructive tools require `confirm: true`, so read the feedback before acting on it.

New keys carry `kits:write` by default. A key minted before that scope existed will 403 until you re-run `identityforge login` or create a new scoped key.

The MCP server also ships connect-time instructions describing this workflow, so a connected agent knows how to go from intent to an applied kit without being told the steps.

## How an agent picks a kit

When you ask your agent for a look and feel, it should:

1. **Gather intent**: what the product is, who it is for, and the mood you want, for example "fintech dashboard for SMBs, calm and trustworthy".
2. **Find candidates**: `list_themes({ use })` when the build target maps to a use-case lane, `list_themes({ q })` for ranked search, or `search_themes` to rank the whole catalog against a subtle brief. If you already have brand colors, `match_palette({ colors })` finds the closest kits.
3. **Review**: each result is a compact summary with name, tags, a font and color glimpse, tier, and judged fitness. `similar_themes(slug)` offers neighbours, and `get_design_md(slug)` reads the full brief before committing.
4. **Apply**: `apply_theme(slug)`, optionally with a `tokensFormat` matching your stack, writes `DESIGN.md`, a tokens file, and the `identityforge.json` stamp into the project. If the project already has files it did not write, it shows you the conflict instead of overwriting them.
5. **Implement**: follow `DESIGN.md` and wire the tokens into your styling layer, whether CSS variables, a Tailwind `@theme` block, or shadcn.

The more concrete your description, the better the match.

### Ids and slugs

Every kit has an opaque `id` and a `slug`, and either one addresses it directly, so once you have a kit you can skip discovery. They differ in durability:

- The **id** never changes. It is minted once, is never reassigned, and always resolves to the same kit.
- The **slug** is a public handle its owner can rename. A retired slug keeps resolving through an alias, so a rename alone does not break you. But a different kit can later claim that freed slug, and the live kit wins, so a stored slug can quietly start resolving to a **different** kit rather than failing loudly.

Pass the slug when a person typed it. Store the id for anything your agent keeps: a config value, a version stamp, a choice it repeats in a later session. `list_themes` prints both.

Image directions, interface styles, and page recipes carry ids too, and the same advice applies more strongly: they have no alias table, so a renamed slug there simply stops resolving.

</details>

<details>
<summary><strong>Full CLI command reference</strong></summary>

## CLI commands

```bash
npx -y identityforge@latest login    # browser sign-in (PKCE loopback)
identityforge login --key ifk_…      # or paste a key (headless)
identityforge whoami                 # plan, scopes, quota, credits, saved-kit slots (free)
identityforge logout                 # remove stored credentials
identityforge themes                 # list kits
identityforge themes -q "fintech dashboard, calm and trustworthy"
identityforge themes get <id|slug>   # print DESIGN.md to stdout, writing nothing
identityforge themes get <id|slug> --format tailwind-v4 > tokens.css
identityforge themes get <id|slug> --format json      # the whole kit
identityforge themes get <id|slug> --marker           # stale-write marker only

# Author, fork, and find neighbours (kits:write for the first two)
identityforge themes create --name "Acme" --base bento-noir --overrides o.json
identityforge themes remix <id|slug> --overrides o.json   # copies; original untouched
identityforge themes delete <id|slug> --yes                # permanent; refuses kits still in use
identityforge themes similar <id|slug>                    # nearby published kits
identityforge themes match "#1d4ed8" "#f97316"            # kits closest to colors you hold

# Has this kit moved since I built against it? (read-only)
identityforge themes versions <id|slug>               # version timeline, newest first
identityforge themes version <id|slug> 3              # one past snapshot, whole kit
identityforge themes diff <id|slug> --from 3          # what changed since version 3

# Everything that happened to it, which is a wider record (read-only)
identityforge themes history <id|slug>                # + every apply-to-brand
identityforge themes history <id|slug> --cursor "$NEXT"
identityforge themes snapshot <id|slug> <event-id>    # the kit at that entry

# Build a client brand project and read the feedback back (kits:write)
identityforge brand create --name "Acme rebrand" --brief "Calm fintech"
identityforge brand add-variation --project <uuid> --kit <id|slug> --brand-name Acme --label "Direction A"
identityforge brand share --project <uuid> --password hunter2
identityforge brand update-share --project <uuid> --disable   # pause; token survives
identityforge brand revoke-share --project <uuid> --yes       # permanent, new token next time
identityforge brand get --project <uuid>              # one project in full
identityforge brand layers --project <uuid>           # pinned catalogue records
identityforge brand add-layer --project <uuid> --axis imageDirection --record <id>
identityforge brand remove-layer --project <uuid> --axis imageDirection --record <id> --yes
# The kit's DESIGN.md with every pinned layer composed into it: the one document to build from
identityforge brand export --project <uuid> > DESIGN.md
identityforge brand comments --project <uuid>
identityforge brand projects
# Describe the product once, then ask for grounded proposals
identityforge brand context --project <uuid>          # read the stored context
identityforge brand set-context --project <uuid> --file context.json   # REPLACES it
identityforge brand recommend --project <uuid>        # candidates (3 units, needs a key)
# Queue mockups: one AI credit per variation and scene combination
identityforge brand mockups generate --project <uuid> --variation <uuid> --item tshirt:front
identityforge brand mockups list --project <uuid>
identityforge brand mockups get --project <uuid> --job <uuid>

identityforge brand versions --project <uuid>         # project history
identityforge brand version 3 --project <uuid>        # one stored version, in full
identityforge brand diff --project <uuid> --from 2

# Act on the feedback: revise, retire, reorder (kits:write)
identityforge brand update-variation --project <uuid> --variation <uuid> --label "Warmer" --clear notes
identityforge brand remove-variation --project <uuid> --variation <uuid> --yes
identityforge brand reorder --project <uuid> <variation-uuid> <variation-uuid> <variation-uuid>
identityforge themes update <id|slug> --name "Acme v2" --expected-updated-at "$MARKER"
identityforge image-directions list  # list public imagery judgments
identityforge image-directions get <slug> --format markdown
identityforge interface-styles list  # list public render-grammar judgments
identityforge interface-styles get <slug> --format markdown
identityforge page-recipes list      # list public page communication judgments
identityforge page-recipes get <slug> --format markdown
identityforge apply <slug>           # write DESIGN.md + tokens + stamp into the current dir
identityforge apply <slug> --preview # plan it first, writing nothing
identityforge status                 # read the stamp: has the kit, the document, or its shape moved?
identityforge status --dir apps/web
identityforge mcp                    # run the MCP server over stdio

# Naming commands always print JSON
identityforge naming recipes
identityforge naming projects
identityforge naming create-project --name "My product" --description "Product, audience, market, desired character"
identityforge naming generate --project <uuid> --description "..." --recipes compoundWords,metaphor --count 12 --idempotency-key my-product-run-1
# Persist candidates proposed by the active agent or an authorized offline process (1-50 items)
identityforge naming add-candidates --project <uuid> --file candidates.json
# The same command accepts a JSON array or {"candidates":[...]} on stdin
identityforge naming add-candidates --project <uuid> --file - < candidates.json
identityforge naming candidates --project <uuid> --status shortlisted,finalist
identityforge naming generations --project <uuid>
identityforge naming research-context --project <uuid>
identityforge naming search --file research-tasks.json
identityforge naming trademarks "Candidate name" --project <uuid> --candidate <uuid> --nice-classes 9,42
identityforge naming move <candidate-uuid> --project <uuid> --status finalist --notes "Strong market fit"
identityforge naming rank <candidate-uuid>=1 <candidate-uuid>=2 --project <uuid>
identityforge naming domains candidate.de candidate.com --serp --market "Germany heating retail" --language de-DE
# Registrar evidence alongside DNS and RDAP, the closest this gets to an availability answer
identityforge naming domains candidate.de --registrar
# Record WHY a candidate moved, not only that it did
identityforge naming move <candidate-uuid> --project <uuid> --status rejected --evidence why.json
```

**Guarding a naming write.** `naming move` and `naming rank` take
`--expected-updated-at`, so a candidate that changed since you read it answers `409` instead of
being silently overwritten. Take the marker from `naming candidates`, pass it back byte for byte,
and never parse it: it looks like a timestamp and is compared as an opaque string.

```bash
identityforge naming candidates --project <uuid> --status finalist   # read updatedAt from the row
identityforge naming move <candidate-uuid> --project <uuid> --status selected \
  --expected-updated-at "<marker>"
```

The marker guards **one** candidate, so passing it with several ids is refused before anything is
sent rather than applied to all of them: each row has its own marker, and spreading one across a
batch would guard the wrong rows. Move the guarded candidate on its own. This matters most for
`--status selected`, which also sets the project's chosen brand name.

`--evidence` is different: it is not row-specific, so it applies to every candidate in the batch.
It takes a path or `-` for stdin, and a file that will not parse is refused rather than sent as an
empty object, which would record "no evidence" as though it were the considered answer.

## Editing a saved kit without clobbering a concurrent edit

`PATCH` accepts an `expectedUpdatedAt` marker and answers `409` rather than overwriting a kit that moved since you read it. Read the current marker with `themes get --marker`:

```bash
MARKER=$(identityforge themes get my-kit --marker)
identityforge themes get my-kit --format json > kit.json
# ... edit kit.json, then guard the write with the marker you read
identityforge themes update my-kit --kit kit.json --expected-updated-at "$MARKER"
```

`--kit` is deep merged over the stored kit, so a file holding only what changed is enough. Leave `slug` as it is: it is the kit's public handle, and a payload carrying a different one is rejected with `400 slug_rename_unsupported` rather than quietly ignored. Omitting `--expected-updated-at` still works and still writes; it just overwrites whatever is stored, including an edit someone made since your read, so the command says so on stderr.

**The marker is opaque. Echo it back byte for byte and never parse it.** It crosses the wire as a raw Postgres timestamp rather than ISO-8601, and the guard compares strings, so a client that parses it into a `Date` and serialises it back never matches and gets `409` forever. Parsing also drops the microseconds, so a comparison that normalises both sides can falsely match and let a genuinely stale write through. A curated catalog kit has no marker, because it has no row and cannot be edited.

</details>

<details>
<summary><strong>Authentication, telemetry, and Docker</strong></summary>

## Authentication

Commands authenticate with an Identity Forge API key (`ifk_…`). `login` stores it in `~/.identityforge/config.json` with mode `600`. You can also set it per shell:

```bash
export IDENTITYFORGE_API_KEY=ifk_…
export IDENTITYFORGE_API_URL=https://identityforge.io   # override the API base
export IDENTITYFORGE_TELEMETRY=0                        # optional: disable apply-completion counting
```

Free kits and naming-recipe discovery work without a key. Sign in to keep persistent projects and saved work under an authenticated quota. Owned naming projects and domain research use `naming:read`, generation and board edits use `naming:write`, reading design systems uses `kits:read`, and creating or remixing kits plus building shareable brand projects uses `kits:write`. API calls count against the plan's API quota, while generation separately spends AI credits for successfully persisted unique candidates. Manage keys at <https://identityforge.io/account/api-keys>.

After a successful local apply, the client sends one metadata-only completion request so aggregate builds can be counted. It includes the kit identifier plus the client name and version already present in every API request. It never sends the repository path or file contents, never changes the apply result, and can be disabled with `IDENTITYFORGE_TELEMETRY=0`.

Existing design-only keys are not silently upgraded. If a key reports that it is missing `naming:read` or `naming:write`, create a scoped key or run browser login again.

## Docker

The MCP server also runs as a container over stdio:

```bash
docker build -t identityforge-mcp .
docker run -i --rm -e IDENTITYFORGE_API_KEY=ifk_… identityforge-mcp
```

The image contains no kit payloads. The key is optional: without one, the server still starts and fetches published Free kits from the Identity Forge platform API. Pro kits, saved work, and writes require an account key.

</details>

## Links

- [Source and agent plugin](https://github.com/KasayoDotCom/identityforge-mcp): the public CLI and MCP implementation.
- [Kit gallery](https://identityforge.io/kits): browse every kit with live previews, judged use-case lanes, and search.
- [For agents](https://identityforge.io/for-agents): the full agent integration story.
- [API manifest](https://identityforge.io/api/v1) and [llms.txt](https://identityforge.io/api/v1/llms.txt).
- [Official MCP Registry record](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.identityforge%2Fmcp) and [Glama listing with independent build and security analysis](https://glama.ai/mcp/servers/KasayoDotCom/identityforge-mcp/score).

If Identity Forge earns a place in your workflow, a GitHub star helps other builders find it.

## License

MIT
