---
name: pr-review
description: Review, fix, verify, and merge a GitHub PR end-to-end - checkout, rebase, run review, fix findings, apply local D1 migrations, run tests, run verify, then push and squash-merge after explicit user confirmation. Use when the user asks to review or merge a PR in the-list-services.
disable-model-invocation: true
---

# Review, fix, verify, merge a PR end-to-end

Orchestrate the standard PR workflow. Honor stop conditions at every step — do not paper over
failures. Adapted for Cloudflare Pages (auto-deploy on merge to `main`) + D1 + wrangler. (Mirrors
KLAARIKS `/pr-review`.)

## Step 0: Preconditions
```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
git fetch origin main
```
- Dirty working tree -> STOP, surface to user. Do not stash silently.
- Note the starting branch to return to on abort.

## Step 1: Pick the PR
If arguments contain a number, use it. Otherwise:
```bash
gh pr list --state open --limit 20 --json number,title,headRefName,author,isDraft,mergeable,statusCheckRollup
```
Ask the user which PR (AskQuestion). Then capture metadata:
```bash
gh pr view <PR#> --json number,headRefName,baseRefName,mergeable,statusCheckRollup,title,url
```
Base must be `main`. If CI is failing, surface it and ask whether to proceed.

## Step 2: Checkout
```bash
gh pr checkout <PR#>
git branch --show-current
```

## Step 3: Rebase against main
```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD   # <behind> <ahead>
```
If behind > 0: `git rebase origin/main`. Conflict -> STOP, list conflicting files, do not
auto-resolve. If the branch added a migration, check for an index collision with main:
```bash
git diff origin/main...HEAD -- migrations/
```
Two branches adding `00NN_*.sql` with the same index -> flag and stop. Do not push yet.

## Step 4: Run review (diff mode, fresh eyes)
```bash
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --stat
```
Invoke the [review](../review/SKILL.md) skill in diff mode; run the core review as an independent
subagent (only the diff + changed-file list + PR title). Capture every finding.

## Step 5: Fix findings
For each finding: fix in place, commit each logical fix separately with a clear message. Re-run
review if fixes were substantial. Do not advance until every finding is fixed or explicitly
acknowledged out-of-scope with the user.

## Step 6: Local migration (only if the branch added one)
```bash
git diff --name-only origin/main...HEAD -- 'migrations/*.sql'
```
If present: apply to the local D1 copy first, then confirm:
```bash
npx wrangler d1 migrations apply list-parking-log --local
npx wrangler d1 execute list-parking-log --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```
Never edit an already-applied migration. If it fails -> STOP. Note that a later abort leaves the
local DB ahead of remote.

## Step 7: Tests (merge gate)
```bash
npm run typecheck
npm run test
```
(Add `tsconfig.json` / vitest if missing — note the gap.) A new failure on this branch -> STOP and
fix (treat as a Step 5 finding). Confirm pre-existing failures against main before blaming the PR;
report them but don't block.

## Step 8: Run verify (conditional)
- Function behavior changed -> run [verify](../verify/SKILL.md) API flow against `npm run dev`.
- Static form changed -> run verify browser flow.
- Pure docs/config/types -> skip, say so with the reason.
If verify fails -> STOP, do not push.

## Step 9: Push confirmation gate (CRITICAL)
Summarize (PR#, branch, commits added, rebased?, migration applied?, review findings fixed, tests,
verify outcome). Then AskQuestion:
- "Yes — push, squash-merge, delete branch"
- "Push only — leave merge for later"
- "Stop here — keep branch checked out, no push"
Match the action exactly to the choice.

## Step 10: Push (option 1 or 2)
```bash
git push --force-with-lease   # if rebased
git push                      # otherwise
```
Never plain `--force`, never `--no-verify`. Then `gh pr checks <PR#>` (watch if merging).

## Step 11: Merge & cleanup (option 1)
```bash
gh pr merge <PR#> --squash --delete-branch
git checkout main && git pull origin main && git branch -D <branch>
```
Cloudflare Pages auto-deploys `main` (~30s).

## Step 12: Final summary
```
<emoji> pr-review — <verdict>
```
- `✅ pr-review — PR #N merged, branch cleaned, on main at <sha>`
- `⚠️ pr-review — PR #N pushed, awaiting CI / merge`
- `🚨 pr-review — blocked at step N — <why>`

If a migration ran locally, put a 🚨 reminder at the TOP: run
`npx wrangler d1 migrations apply list-parking-log --remote` after the deploy lands (migrations do
NOT run automatically on deploy — see `migrations/README.md`). If verify was skipped, list the
manual checks the user should perform.

## Stop-condition checklist
| Step | Stop if |
|---|---|
| 0 | Working tree dirty |
| 1 | CI failing and user declines |
| 3 | Rebase conflict or migration index collision |
| 5 | review findings unresolved |
| 6 | Migration fails |
| 7 | New test/typecheck failure on this branch |
| 8 | verify fails (or server down AND change is high-risk) |
| 9 | User picks "Stop here" |
