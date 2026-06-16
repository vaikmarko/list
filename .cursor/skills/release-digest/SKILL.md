---
name: release-digest
description: Generate an Estonian summary of what shipped on the-list-services (merged PRs and/or commits to main) since a chosen time, for sharing with the team and Rotermann stakeholders. Covers product changes (parking, fault relay) AND internal tooling (skills, docs, CI). Use after merging/pushing work, or when the user asks for a release summary, changelog, or "mis muutus".
disable-model-invocation: true
---

# Release digest — what shipped, in Estonian

Summarize recently shipped work for copy-paste to the team / Rotermann stakeholders. Covers **all
work** — product changes and internal tooling (new skills, docs, CI). (Mirrors KLAARIKS
`/release-digest`, minus Linear/KLA tickets — this repo has none.)

## Input
Optional argument:
- `8h`, `24h` / `3d`, `1w` — lookback window
- `today` — since 00:00 EEST today
- `--from <git-ref-or-ISO>` — since a specific commit/tag/timestamp
- (none) — use the cursor in `.cursor/state/release-digest-last.txt`; if absent, ask (default `7d`)

## Step 1: Resolve the window + repo
```bash
mkdir -p .cursor/state
STATE_FILE=".cursor/state/release-digest-last.txt"
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)   # e.g. vaikmarko/list
```
Compute `SINCE` (ISO-8601 UTC) from the argument or the state file (macOS: `date -u -v-Nd`). Print
the chosen window in one line for the user to confirm, e.g. `Window: since 2026-06-16T12:00:00Z (last 24h)`.

## Step 2: Gather what shipped
This repo sometimes uses PRs and sometimes pushes straight to `main` — gather both.

```bash
# Merged PRs in the window (preferred source — has Summary bodies)
gh pr list -R "$REPO" --state merged --search "merged:>${SINCE} base:main" \
  --json number,title,body,mergedAt,url,files --limit 50
# Direct commits to main not captured by a PR
git log --since="$SINCE" --first-parent main --pretty='%h %s' --name-only
```
If both are empty: reply one line — *"Pärast ${SINCE} pole midagi merge'itud/pushitud. Pole millestki kokkuvõtet teha."* Do not update the state file. Exit.

For each item read the title (conventional-commit prefix), the body's `## Summary` if present, and
the **file list** — the diff often ships more than the title says. Watch which surface changed:
- `functions/api/*.ts` + matching `*/index.html` + `*/app.js` — a user-visible flow (parking,
  veateade) → usually *Uus* or *Parandused*.
- `migrations/*.sql` — data/schema change (frame the user outcome, not the SQL).
- `.cursor/skills/**`, `docs/**`, `*.yml`, config — internal tooling → *Tagaplaanil*.

## Step 3: Compose the digest (Estonian)
Three outcome-based sections; include one only if it has a bullet. Lead each bullet with the
**user-visible outcome**, not the mechanism. 1-2 sentences each. Tag with the PR `#N` or short sha.

```
🚀 Mis Rotermanni teenustes muutus [täna / sel nädalal — by window]

*Uus*
• [new capability in plain Estonian] (#N)

*Parandused*
• [what was broken → what's fixed] (#N)

*Tagaplaanil*
• [infra / quality / tooling — new skills, docs, CI; note when no direct user impact] (#N)
```

Classification by prefix: `feat(` → *Uus* (infra-feat → *Tagaplaanil*); `fix(` → *Parandused*;
`refactor(` → *Parandused* if it fixes a visible bug, else *Tagaplaanil*; `chore/ci/docs` →
*Tagaplaanil*. Skip only auto-generated dependency bumps.

**Tone:** audience is the team + Rotermann (non-engineers). No coding jargon (proxy, middleware,
mock, regex, rollup). Estonian heading is `*Uus*` (not `*Uut*`). Target 150-300 words. Combine
related items into one bullet; split one PR into multiple bullets if it ships multiple surfaces.

## Step 3.5: Audit pass (mandatory)
Walk the full list once more. For each PR/commit, name the bullet it appears in, or write the skip
reason (only dependency bumps qualify). If something can't be placed, add a bullet. Print a
`Skipped: ...` note under the digest.

## Step 4: Output + advance the cursor
Print the digest inside a fenced code block (clean copy-paste). Then, unless the user passed
`--from` (a custom one-off window):
```bash
date -u +%Y-%m-%dT%H:%M:%SZ > .cursor/state/release-digest-last.txt
```
Tell the user one line: *"Cursor uuendatud — järgmine `release-digest` katab tööd pärast [timestamp]."*

## Notes
- Uses local `gh` auth (`vaikmarko/list`). No remote secrets.
- The state file lives in `.cursor/state/` (gitignored, per-clone).
- This is a reporting skill — read-only. Never push, tag, or modify history here.
