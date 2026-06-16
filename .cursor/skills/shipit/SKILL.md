---
name: shipit
description: Ship a change end-to-end - move work off main to a branch if needed, commit, push, open a PR, then delegate review/verify/merge to the pr-review skill. Use when the user says ship it, or wants to go from "code is ready" to "merged on main" in the-list-services.
disable-model-invocation: true
---

# Ship a change end-to-end

Orchestrate the full ship sequence from "code is ready" to "merged on main". Detects state and
skips work already done. Runs largely unattended: it picks the branch name, writes the commit
message, and writes the PR text itself, announcing each in one line. The push/merge confirmation
gate belongs to the delegated `pr-review` skill. (Mirrors KLAARIKS `/shipit`, minus Linear.)

## Step 0: Read working state
```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
git fetch origin main
```
Compute: `dirty` (any porcelain output), `branch`, `onMain` (branch == main), `unpushedCommits`
(`git rev-list --count @{upstream}..HEAD` or "no upstream"), `prNumber`
(`gh pr view --json number --jq .number` or empty). Detached HEAD -> STOP. Render a one-line state
summary.

## Step 1: If on main -> move work to a fresh branch
If `onMain` AND `dirty`:
1. Read the diff, write a 1-line summary.
2. Pick a conventional prefix: `fix/`, `feat/`, `style/`, `chore/`, `docs/`.
3. Generate a 3-5 word kebab-case slug (e.g. `feat/fault-relay-endpoint`).
4. `git checkout -b <name>`, announce in one line — do not ask.
5. If the name exists, append `-2`, `-3`, ... Update `branch`.

If `onMain` AND clean: "Nothing to ship — on main with a clean tree." End.
If `!onMain`: skip.

## Step 2: Commit
If not dirty: skip. If dirty:
1. Show `git diff --stat HEAD`.
2. Match the repo's commit style (`git log -5 --oneline`).
3. Stage files by name (never `git add -A`), commit as one bundled commit with a derived headline +
   body. Announce the headline. Verify a clean tree after.

## Step 3: Push if needed
```bash
git push -u origin <branch>   # no upstream
git push                      # has upstream, unpushed commits
```
Never `--force` without `--force-with-lease`; never `--no-verify`. Push failure -> surface verbatim
and stop.

## Step 4: Open PR if missing
If `prNumber` empty, derive a title from the commit subject and a body
(`## Summary` bullets + `## Test plan` checklist) and create:
```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```
Capture the PR number + URL. If a PR exists, reuse it.

## Step 5: Delegate to pr-review
Invoke the [pr-review](../pr-review/SKILL.md) skill with the PR number. It handles rebase, review,
fixing findings, local D1 migration, tests, verify, the push/merge confirmation gate, squash-merge,
and cleanup. shipit's job ends when control returns; surface pr-review's verdict plus a shipit wrap.

## Final summary
```
<emoji> shipit — <verdict>
```
- `✅ shipit — PR #N merged, branch cleaned, on main at <sha>`
- `⚠️ shipit — PR #N opened, paused at pr-review's push gate`
- `🚨 shipit — blocked at step N — <why>`
- `✅ shipit — nothing to do (on main, clean tree)`

## Stop conditions
| Step | Stop if |
|---|---|
| 0 | Detached HEAD |
| 2 | Commit fails for a non-auto-fixable reason (e.g. hook blocks) |
| 3 | `git push` fails |
| 4 | `gh pr create` fails |
| 5 | Any of pr-review's own stop conditions |

When stopping, leave the tree recoverable — never `git reset --hard`.

## What shipit is NOT
- Not for cherry-picking individual commits (use `git cherry-pick`).
- Not for hotfixes bypassing review.
- Not for changes needing design/product approval before merge — pause at the push gate.
