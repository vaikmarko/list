# Cursor Skills — the-list-services

Agent Skills for this repo, following the `create-skill` format (frontmatter `name` + `description`,
third person, concise, progressive disclosure). Two groups: integration-specific skills for the
Sharry -> Hausing fault relay, and general quality/process skills ported from the KLAARIKS repo
(`~/Projects/KLAARIKS`, `.claude/commands/` on `origin/main`) and adapted to this stack (Cloudflare
Pages Functions + D1 + wrangler).

## Integration skills

| Skill | Purpose |
|---|---|
| `hausing-api/` | Calling the Hausing Gateway API (general tickets = fault reports, status, chats, files). Auto-invokes on Hausing work. Full ref: `docs/integrations/HAUSING_API.md`. |
| `cloudflare-integration-proxy/` | The secure `functions/api/*.ts` proxy pattern (D1 audit, rate-limit, sanitize, fail-open, secret hygiene), codified from `functions/api/park.ts`. Auto-invokes on new endpoint work. |
| `integration-review/` | Specialization of `review` for API-proxy integrations. |
| `integration-verify/` | Specialization of `verify` with a no-live-keys mock mode. |

## Process skills (ported from KLAARIKS)

| Skill | Mirrors KLAARIKS | Adaptation notes |
|---|---|---|
| `verify/` | `.claude/commands/verify.md` | Static gates -> `npm run typecheck` + `npm run test` (vitest); live check -> `wrangler pages dev` + curl + D1, or cursor-ide-browser for UI. Flags that tsconfig/test-runner must be added. |
| `review/` | `.claude/commands/review.md` | Plan/diff modes, fresh-eyes subagent. Edge-case matrix and security sweep re-pointed at Functions + D1 (`.bind` SQL, secret leaks, idempotency, rate-limit, Estonian copy). |
| `cto-review/` | `.claude/commands/cto-review.md` | Scaled down to a Functions + static-site repo. Saves the brief to `docs/reviews/`. |
| `pr-review/` | `.claude/commands/pr-review.md` | Squash-merge to `main` (Cloudflare auto-deploy). Local D1 migration via `wrangler d1 migrations apply --local`; remote reminder post-deploy. |
| `shipit/` | `.claude/commands/shipit.md` | Branch -> commit -> push -> PR -> delegate to `pr-review`. Linear sync dropped (not used here). |

## Not ported (yet)

KLAARIKS also ships `design-review`, `design-visual-review`, `kirjuta`, `release-digest`,
`linearadd`, plus `.claude/SESSION_RULES.md` and `.claude/runbooks/db-migrations.md`. These are tied
to KLAARIKS's Next.js design system, Linear, and release process and were left out as out-of-scope
for this static-site + Functions repo. Add them if/when the corresponding tooling lands here.

## Conventions

- Process skills set `disable-model-invocation: true` (invoke them by name, like `/verify`).
- Domain skills (`hausing-api`, `cloudflare-integration-proxy`) auto-invoke from context.
- Reference files stay one level deep from each `SKILL.md`.
