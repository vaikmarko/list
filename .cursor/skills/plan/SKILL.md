---
name: plan
description: Turn a feature request into a paired design spec + implementation plan (KLAARIKS superpowers format) before any code is written. Use when starting a non-trivial change in the-list-services, when the user asks for a plan or spec, or before implementing a new integration/endpoint. Hands off to the review skill (plan mode) when done.
disable-model-invocation: true
---

# Plan a change — design spec + implementation plan

Produce the two paired documents this repo plans with, BEFORE writing code, so the work is
reviewable and the implementation is mechanical. (Mirrors the KLAARIKS `docs/superpowers/` plan+spec
convention.) Canonical example to copy the shape from:
[specs/2026-06-16-sharry-hausing-fault-relay-design.md](../../../docs/superpowers/specs/2026-06-16-sharry-hausing-fault-relay-design.md)
+ [plans/2026-06-16-sharry-hausing-fault-relay.md](../../../docs/superpowers/plans/2026-06-16-sharry-hausing-fault-relay.md).

## When to use
- A non-trivial change (new endpoint, integration, migration, multi-file feature).
**Skip** for a one-file fix or a typo — just do it.

## Step 0: Brainstorm first (do NOT skip to writing)
Interrogate the request before committing it to a doc. Ask the user only what you cannot infer:
scope, the system of record, auth model, failure stance, what's explicitly out of scope. Read the
existing pattern it should mirror (almost always `functions/api/park.ts` + `migrations/`). Capture
each resolved choice as a one-line decision — these become the "Decisions captured" table.

## Step 1: Write the design spec
Path: `docs/superpowers/specs/YYYY-MM-DD-<kebab-slug>-design.md`. Sections (omit ones that don't
apply, keep the order):

1. **Header** — Date, Status, Repo, References (API docs, the mirrored pattern).
2. **Summary** — what + why in 3-6 sentences; name the system of record and what D1 holds.
3. **Decisions captured** — a table of `Topic | Decision`. This is the load-bearing section.
4. **Data flow** — a `mermaid` sequence/flow diagram of the end-to-end path.
5. **Data model** — D1 tables/columns + indexes (note the migration number), or interface shapes.
6. **Endpoints / interfaces** — method, path, request/response shape. State what the client never sees.
7. **Validation, security, resilience** — inherit from `park.ts`: input caps, `sanitizeContext`,
   rate-limit (fail-open), secret hygiene, idempotency key, critical-path vs fail-open writes.
8. **Localization** — resident-facing copy is Estonian; logs/code/docs English; map status enums.
9. **Open questions** — what must be resolved at/after handover (keys, ids, vendor confirmations).

## Step 2: Write the implementation plan
Path: `docs/superpowers/plans/YYYY-MM-DD-<kebab-slug>.md`. Structure:

- A one-line note for agentic workers: implement task-by-task; run `verify` before push, `review`
  after build.
- **Goal**, **Architecture**, **Tech stack**, **Spec** link, **Migration required?** (yes/no + the
  apply commands `--local` then `--remote`).
- **File map** — a `File | Action (create/modify) | Purpose` table covering every file touched.
- **Task-by-task** — numbered tasks, each a short checklist of `- [ ]` steps. Order so each task is
  independently verifiable. Put the toolchain/migration first, the client form last. For an
  external API, do the `_<vendor>.ts` client **test-first (TDD)**. Always end with a Verify task and
  a deferred Live-test task if it depends on credentials you don't have yet.
- **Notes** — load-bearing constraints (e.g. "Hausing has no webhooks — polling + dedup are not
  optional"; "Pages Functions have no cron").

## Step 3: Hand off to review
Run the [review](../review/SKILL.md) skill in **plan mode** on the spec+plan (layer
[integration-review](../integration-review/SKILL.md) for an API-proxy change). Fold its findings
back into the docs — solve, don't just list. Only then start implementing.

## Conventions
- The spec and plan are a **pair**; cross-link them. Date-prefix both filenames with the same date.
- In plan mode do not write product code. The plan's checkboxes are filled in by the implementer,
  not edited away during review.
- Keep specs/plans in English (engineering-doc convention); resident-facing strings are Estonian.

## Verdict
Close with a banner line and the two file paths:
```
✅ plan — spec + implementation plan written, reviewed, ready to implement
```
- `✅ plan — <slug>: spec + plan ready (N tasks), review clean`
- `⚠️ plan — <slug>: ready, but N open questions block live work`
