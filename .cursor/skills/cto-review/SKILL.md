---
name: cto-review
description: Periodic zoom-out health audit of the whole repo - architecture, duplication, dead code, security, migrations, types, and tests - producing a verdict, punch list, and a saved senior-engineer brief. Use quarterly, before a milestone, or when the architecture of the-list-services feels off. Not for individual changes (use review for that).
disable-model-invocation: true
---

# CTO Review — Periodic Codebase Health Audit

Holistic, top-down audit of the repo. Not for individual changes (use [review](../review/SKILL.md)).
Adapted for a Cloudflare Pages + Functions + D1 static-site repo. (Mirrors KLAARIKS `/cto-review`,
scaled to this much smaller codebase.)

Two mandatory halves:
1. **Helicopter view (Steps 2-4)** — read the system top-down: what Functions exist, how the static
   forms and D1 connect, semantic duplication, dead code, broken promises.
2. **Compliance audit (Steps 5-9)** — verify the conventions: secret hygiene, migrations,
   types/tests, security, docs-vs-code.

No time budget; thoroughness beats speed. Do not write code. Output is a report. Use read-only
explore subagents for independent steps where helpful.

## Verify-before-flag (CRITICAL)
Before listing any finding as current, check `git log --oneline -5 -- <file>` — it may already be
fixed. Put `git rev-parse --short HEAD` at the top of the report so the reader can skip
already-fixed items later.

## Scope control
Default is the full repo. Honor a narrower scope from arguments and state it in the verdict.

## Step 0: Read the previous review (accountability loop)
```bash
ls -t docs/reviews/CTO_REVIEW_*.md 2>/dev/null | head -1
```
If one exists, extract its punch list and determine each item's status now (fixed / partial /
ignored / worse) from git history and current code. An item ignored across two reviews escalates one
severity level. Output a delta table. If none, say so.

## Step 1: Snapshot
```bash
# Function + form sizes
find functions -name '*.ts' | xargs wc -l | sort -rn
find . -path ./node_modules -prune -o -name 'app.js' -print -o -name 'index.html' -print
# Recent change velocity
git log --since='90 days ago' --pretty=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -20
```
Note any Function over ~500 lines as a candidate to split (`_<vendor>.ts` extraction).

## Step 2: Helicopter view — map the system
Build the picture: each `functions/api/*.ts` endpoint, which static form calls it, what upstream API
it proxies, what D1 tables it touches, and the migrations. Trace the core flows end-to-end against
real code (e.g. parking: form -> `/api/park` -> Europark + D1; fault relay: form -> `/api/fault` ->
Hausing + D1 -> poller). Ask: are responsibilities in the right place? Where does one change touch
4+ places? Output the map + a 3-5 sentence shape assessment.

## Step 3: Semantic duplication
Compare parallel surfaces by reading them: do multiple Functions re-implement the same
validation/audit/rate-limit/jsonResponse instead of sharing a `functions/api/_*.ts` helper? Do the
static forms duplicate the same `collectContext`/submit machinery instead of sharing `app.js`/CSS?
Used 3+ times -> propose an extraction (name + sketch, no code). Output a unify-candidates table.

## Step 4: Dead code & broken promises
List exports/files with no callers; SETUP/docs that promise behavior that does not exist; env-gated
paths permanently on/off. Verify each with a grep for callers before listing. Output verified
dead-code list + broken-promise list (location | claim | reality).

## Step 5: Convention drift
- **Secret hygiene** — grep for any API key/token literal in tracked files; confirm secrets are only
  read from `env`/`.dev.vars` and `.dev.vars` is gitignored. Any leak is Fix-now.
  ```bash
  git grep -nE '(api[_-]?key|token|bearer)\s*[:=]\s*["'"'"'][A-Za-z0-9._-]{12,}' -- ':!*.example' || echo clean
  ```
- **Client never holds secrets** — grep static HTML/JS for secret-looking values or direct upstream
  calls; the client must only call our `/api/*`.
- **Audit + rate-limit** — every write Function logs to D1 and rate-limits; audit is fail-open.

## Step 6: Migration integrity
```bash
ls migrations/*.sql
```
Confirm migrations are append-only and idempotent (`IF NOT EXISTS`), filenames follow
`NNNN_snake_case.sql`, and no applied file was edited in place (`git log -- migrations/`).

## Step 7: TypeScript & tests
```bash
npm run typecheck 2>/dev/null || echo "no typecheck script — flag: add tsconfig.json"
npm run test 2>/dev/null || echo "no test runner — flag: add vitest"
grep -rn 'as any\|@ts-ignore' functions --include='*.ts' | wc -l
```
A missing type-check/test runner is itself a Watch finding for a repo with live integrations.

## Step 8: Security surface
For each `functions/api/*.ts` endpoint: input validated before use; D1 SQL uses `.bind(...)` (no
string interpolation); no secrets/internal IDs/raw upstream bodies leaked to the client; admin
endpoints auth-guarded (`CF_ADMIN_KEY`); rate-limited. Output pass/fail per endpoint.

## Step 9: Docs-vs-code drift
Spot-check `docs/integrations/*` and `docs/superpowers/*` claims against current Functions; note any
that no longer match. Output a drift table (doc | claim | reality | action).

## Output 1: Verdict (render FIRST)
```
<emoji> cto-review — <COLOR>, <one sentence why>
```
GREEN (no Fix-now), YELLOW (Fix-now exist, none threaten prod/security), RED (secret leak, security
miss, migration edited-in-place, or a Function refactored without tests). Second line: "Most urgent
thing". Third line (if prior review): "Since last review: N fixed, N ignored, N worse".

## Output 2: Punch list
Audit commit hash on line 1, then the previous-review delta, then three buckets — **Fix-now** /
**Watch** / **Noted** — each item terse: file:line, what, why, proposed fix. Security/secret issues
are Fix-now regardless of effort.

## Output 3: Senior-engineer brief (saved to disk)
```bash
mkdir -p docs/reviews
# write to docs/reviews/CTO_REVIEW_$(date -u +%Y-%m-%d).md
```
Self-contained for a friend doing a 1-2 hour review: what the repo is, the module map from Step 2,
key invariants (secrets server-side, audit-everything, append-only migrations, client calls only
`/api/*`), a machine-comparable metrics table (audit_commit, audit_date, functions_count,
largest_function, as_any_count, has_typecheck, has_tests, migrations_count), duplication/dead-code
findings, and 3-5 sharp questions worth a second opinion. Populate with real content, no placeholders.
