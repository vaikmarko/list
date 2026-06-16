---
name: review
description: Stress-test a plan or a code diff for edge cases, security, and breaking points before it ships. Use when reviewing a plan before implementation, reviewing a diff/PR, or when the user asks for a code review in the-list-services.
disable-model-invocation: true
---

# Review Plan or Diff for Edge Cases and Breaking Points

Stress-test work before it ships. Do not skip steps. In plan mode do not write code; in diff mode
do not fix silently. Adapted for Cloudflare Pages Functions + D1. (Mirrors KLAARIKS `/review`.)

## Mode switch (decide FIRST, state it in line 1)

- **Plan mode** — a plan exists, implementation has NOT started. Steps 1-4 interrogate the plan;
  Step 5 is skipped; findings are fixed by rewriting the plan.
- **Diff mode** — code is written. Establish exactly what changed first:
  ```bash
  git diff origin/main...HEAD --stat   # committed / PR branches
  git diff HEAD --stat                 # uncommitted
  git log origin/main..HEAD --oneline
  ```
  Steps 1-5 apply. Findings are reported, not auto-fixed (the caller decides).

## Fresh eyes (diff mode)

A review by the same session that wrote the code inherits its blind spots. In diff mode, run the
core review as an **independent subagent** that receives only the diff, the changed-file list, and
this checklist — no authorship context. Synthesize with your own pass. If subagents are
unavailable, state that this is a self-review.

## Step 1: Trace every affected path

For each change, trace the full execution path: the static form (`*/app.js`) -> the `fetch('/api/...')`
call -> the Function handler (`functions/api/*.ts`) -> upstream API and/or D1. If multiple forms hit
the same endpoint, find them all. Output a table: form action -> endpoint URL -> handler.

If there is no UI, trace from the entry point (Function, scheduled job) instead.

## Step 2: Find all paths that touch the affected data

For each D1 table/column the change reads or writes, grep across `functions/` for every read/write.
Check the create path, the status-poll path, the admin-log path, and any migration. Output a
numbered list with file:line. Critical question: does the change update ALL of them?

## Step 3: Dependency ordering and stale data

For each path: what depends on this data, is the ordering correct (mutate before evaluate), and are
there stale-copy risks (read from D1, mutate in memory, a stale copy used elsewhere)?

## Step 4: Edge case matrix

Be specific to the actual change. Include only relevant rows:

| Category | Scenario | How handled | Risk |
|---|---|---|---|
| Null/empty | missing/empty field, empty `context` | | |
| Upstream failure | API down, non-2xx, non-JSON body, timeout | | |
| Duplicate/idempotency | same `client_request_id` twice; double submit | | |
| Rate limit | per-IP and per-email caps; D1 query failure (fail-open?) | | |
| Secret hygiene | key leak to client / logs / git | | |
| Auth headers | missing `X-Hausing-Company` / wrong token | | |
| Migration/rollback | re-run safe? old rows still valid? | | |
| Localization | Estonian resident copy correct, no English leak | | |

## Step 5: Code quality sweep (diff mode only)

- **Correctness** — races (read-then-write D1 without guard), off-by-one (pagination, date ranges,
  rate-limit windows), dead/unreachable branches.
- **Performance** — queries in loops, unbounded `SELECT` without `LIMIT`, missing indexes for new
  query patterns.
- **Hygiene** — unused vars, hardcoded values that should be constants/env, duplicated logic that
  should reuse a `functions/api/_*.ts` helper, local re-implementations of shared helpers.
- **Security** — request body validated before use; no string interpolation into D1 SQL (use
  `.bind(...)`); no secrets/tokens/internal IDs leaked in responses or returned upstream bodies;
  every new endpoint rate-limited and (for admin) auth-guarded.
- **i18n** — resident-facing strings are Estonian; status enums mapped to friendly Estonian labels.
- **Tests** — each new `functions/api/_<vendor>.ts` function has a unit test (mocked `fetch`)
  covering happy path, boundary, and error paths. Flag missing tests.

## Step 6: Verdict

Open with the banner line:

```
<emoji> review — <verdict>
```

- `✅ review — <plan|code> is solid, no gaps`
- `⚠️ review — <plan|code> is sound, N concerns (non-blocking)`
- `🚨 review — <plan|code> needs changes (N gaps)`

State the mode and (diff mode) whether it was fresh-eyes or self-review. List each gap on its own
line with a leading emoji (🚨 blocker, ⚠️ concern), user-facing impact first.

## What to do with findings

- **Plan mode:** rewrite the affected parts of the plan with fixes incorporated — solve, don't just
  list.
- **Diff mode:** report; do not fix silently. The caller decides.

For external-API integrations, layer on the [integration-review](../integration-review/SKILL.md)
specialization.
