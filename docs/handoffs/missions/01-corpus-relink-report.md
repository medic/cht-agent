# Mission 01 — Corpus: promote-branch rebuilds + issue relink — Report

Session 2026-07-02, cht-workbench container (Node 22). All work is local to
this clone; nothing pushed. Orchestration: 3 parallel rebuild subagents (one
per worktree, 2–3 domains each) + 8 independent per-branch verifier agents.

## Branches produced (tip SHAs)

| Branch | Tip | Shape (`git log --oneline main..B`) |
|---|---|---|
| fix/filter-spec-skipped-pollution | 138c777 | main + 2 test-isolation commits |
| memory/promote-data-sync | this commit | toolchain + A.4 schema (d9346a7) + dedup worklist (6559ed2) + this report |
| memory/promote-messaging | c291306 | promote 2f97c59 + relink c291306 |
| memory/promote-infrastructure | 395695e | promote c88ae94 + relink 395695e |
| memory/promote-forms-and-reports | caf3dff | promote 24f47b9 + relink caf3dff |
| memory/promote-tasks-and-targets | d9798a3 | promote bd4f8d5 + relink d9798a3 |
| memory/promote-authentication | cbe882d | promote c854944 + relink cbe882d |
| memory/promote-contacts | 0734ee0 | promote 15dfed1 + relink 0734ee0 |
| memory/promote-interoperability | 4a66ba7 | promote 3612695 + relink 4a66ba7 |
| memory/promote-configuration | 6c39c85 | promote 06c242c + relink 6c39c85 |

Original (pre-reset) promote tips, recorded before `git branch -f B main`:
messaging d1e01ff, infrastructure 89d3473, forms-and-reports 573ca6b,
tasks-and-targets 80e45db, authentication d2f9344, contacts 3e30890,
interoperability 8d81af5, configuration 1720724. Each was verified beforehand
to be the single `chore(memory): promote …` insertions-only commit touching
only `agent-memory/`. Verifiers additionally confirmed by `git patch-id` that
cherry-picked promote commits are faithful to the originals (spot-checked on
infrastructure, forms-and-reports, contacts, configuration).

## Task 1 — Preflight + fix/filter-spec-skipped-pollution

- Baseline on the main tree: `npm ci` clean; `npm test` = **557 passing,
  1 failing**. The failure is environmental: `ClaudeApiCodeGenModule should
  default to documented model name` reads `ANTHROPIC_MODEL`, which the
  workbench harness exports (`claude-fable-5`). The run also appended one line
  to the tracked `agent-memory/_skipped.ndjson` — the isolation bug this
  branch fixes (appended line verified to be from this session, then restored).
- Root cause: in `test/scripts/filter.spec.ts`, the
  `touchesMultipleServices: single service` test was the only `filterPR` call
  without an explicit `logPath`; its `skipLlm: true` flag-for-human path
  writes a skip-log entry, which fell through to `DEFAULT_PIPELINE_LOG_PATH`
  (the real tracked file). Full audit found no other unguarded write path.
- Commits:
  - 6def2d7 `test(#108): redirect filter spec skip-log write to a tmpfile`
  - 138c777 `test(#108): isolate code-gen spec from ambient ANTHROPIC_MODEL`
    (addition beyond the strict mission scope: same class of isolation bug;
    without it `npm test` can never be green inside this container)
- Gates after fix: `npm run build` green, `npm test` = **558 passing, 0
  failing**, `eslint .` clean, `git status` clean (no `_skipped.ndjson`
  modification).

## Task 2 — Schema Part A.4 (memory/promote-data-sync)

- `agent-memory/schema.json`: `issueNumber` type → `["integer","null"]`
  (integer minimum 1 retained); added optional `resolvedIssue` boolean.
- New `test/scripts/schema-utils.spec.ts` (7 tests) locks the A.4 contract:
  null issueNumber accepted, resolvedIssue boolean accepted/enforced, integer
  minimum retained, string issueNumber rejected, additionalProperties still
  strict.
- Gates: `npm run validate-schema` = 64 passed / 0 failed over the branch
  corpus; relink/gh-classify/issue-linkage specs green (full suite
  `env -u ANTHROPIC_MODEL npm test` = **618 passing**); build + lint green.
- Commit: d9346a7 `fix(#135): schema A.4 — nullable issueNumber +
  resolvedIssue field`.

## Task 3 — Rebuild of the 8 stale promote branches

Method per branch, exactly as missioned: `git branch -f B main` (reset +
cherry-pick, not rebase) → cherry-pick recorded tip T in a worktree → borrow
`relink-issues.ts`/`gh-classify.ts`/`issue-linkage.ts` from
memory/promote-data-sync uncommitted → dry-run + conditionality review →
BLOCKING gh gate → `--apply` → restore borrowed files → one metadata-only
`fix(#135)` commit → `npm run validate-schema`. All 8 branches completed; no
branch had to stop for gh unavailability (gh stayed online throughout; no
rate limits).

| Domain | Files | Relinked | Flagged (no-issue) | validate-schema | Verifier |
|---|---|---|---|---|---|
| messaging | 17 | 3 | 9 | 67 passed / 0 failed | CONFIRMED 6/6 gh |
| infrastructure | 49 | 2 | 21 | 99 / 0 | CONFIRMED 7/7 |
| forms-and-reports | 47 | 5 | 21 | 97 / 0 | CONFIRMED 10/10 |
| tasks-and-targets | 35 | 2 | 14 | 85 / 0 | CONFIRMED 2/2 |
| authentication | 39 | 3 | 16 | 89 / 0 | CONFIRMED 6/6 |
| contacts | 44 | 7 | 24 | 94 / 0 | CONFIRMED 10/10 |
| interoperability | 6 | 1 | 0 | 56 / 0 | CONFIRMED 3/3 |
| configuration | 10 | 2 | 2 | 60 / 0 | CONFIRMED 4/4 |

Totals: **25 files relinked**, **107 left flagged** (see Follow-ups),
**0 blanket rewrites** (every relink's `from` equaled the source-PR alias or
gh-classified as a PR; verifiers confirmed each relink commit touches only the
`id:`/`issueNumber:`/`issueUrl:` frontmatter lines). The 25 relinks:
messaging 10442→10446 (gh overrode stale token 10428), 10803→10802,
9364→9341; infrastructure 10750→8816, 8996→9118 (tokenless);
forms-and-reports 10304→9739, 10730→10729 (tokenless), 8759→8074, 9513→9488,
9608→9604; tasks-and-targets 9277→9275, 9650→9612; authentication
10414→6784, 8928→8877, 9723→9213; contacts 10083→9835, 8995→8994, 9007→9006,
9230→9229, 9276→9264, 9278→9265, 9625→9586; interoperability 9021→8917;
configuration 10198→8026, 10278→8027.

Each `env -u ANTHROPIC_MODEL npm test` per worktree: **558 passing, 0
failing** (g1, g2, g3).

## Task 4 — Edge cases

### Tokenless files (mission anticipated 6; 11 identified, all gh-verified)

Files with `source_pr` but no `<pr>-<type><issue>-` filename token. Six
required action (2 relinked + 4 flagged), matching the mission's count; five
more were tokenless but already carried the correct issue:

- **Relinked (2):** infrastructure `8996-feat-use-helm-repo-for-cht-deploy.md`
  → 9118 (PR 8996 closes #9118); forms-and-reports
  `10730-fix-correct-typos-and-two-bugs-in-smsparserjs.md` → 10729 (sole
  closing ref).
- **Flagged, no linked issue — do not guess (4):** infrastructure
  `10689-app-skeleton.md` and `8693-kubernetes-configuration-…md`,
  tasks-and-targets `8838-fix-bug-to-correctly-record-tasks-telemetry.md`,
  authentication `8843-featna-script-to-bulk-change-list-of-users-passwords.md`
  — each source PR has EMPTY closingIssuesReferences and no issue ref in its
  title (gh-verified individually).
- **Already correct (5):** messaging 10945 (carries 10944), interoperability
  9855 (carries 9854), forms-and-reports 8904 (8308, member of multi-ref
  [8072, 8308]) and 9840 (9844), configuration 10555 (10556) — every stored
  value matches the PR's closing refs.

### SUSPECT files (4 named by the mission; all gh-verified, none guessed)

- **infrastructure 10557 → expect 10610: already correct.** No file carries
  issueNumber 10557; the promote snapshot already stores cht-core-10610.
  gh: PR 10557 closingIssuesReferences=[10610]; 10610 is a real issue.
- **authentication 9955 → expect 9735: already correct.** File (source_pr
  #9955) already stores 9735. gh: PR 9955 body "Closes #9735",
  closingIssuesReferences=[9735].
- **contacts 9311 → expect 9241: already correct.** File already stores 9241.
  gh: PR 9311 closingIssuesReferences=[9193, 9241]; 9241 ("Create API endpoint
  for getting people") matches this people-pagination draft; 9193 is the
  umbrella epic.
- **tasks-and-targets 9232 → expect 137: mission expectation is a repo
  misattribution — FLAGGED, left unchanged.** The file already carries
  cht-core-137, which gh shows is wrong: cht-core#137 is "Restyle data
  records" (2013, unrelated). PR 9232's sole cht-core closing ref is
  **#9231** ("Allow users to view aggregate targets and filter by
  facility_id…"); the "137" in the PR body is `medic/care-teams#137`, a
  different repo. Correcting to a value other than the mission-expected one
  was not authorized, so the file still carries the wrong cht-core-137
  identity — operator decision required (recommended: relink to cht-core#9231).

### Collision groups

**17 materialized (10 within-domain, 7 cross-domain) + 1 latent** — full
worklist with file lists and gh evidence in `docs/handoffs/135-dedup-worklist.md`
(commit 6559ed2). Both mission-named examples confirmed (messaging
10802, contacts 9835); messaging 9467 is latent (draft 9559's PR has empty
closing refs, so it was flagged rather than relinked into the collision). The
mission's estimate of 13 predates the whole-tree sweep, which also finds
cross-domain groups invisible to the per-domain tool scan (5 of the 17).
Nothing was merged, deleted, or renamed.

## gh-gate evidence summary

- Blocking gate per branch before `--apply`: 100% of relinks sampled (each
  branch had ≤15, so sampling = all of them: 25/25 passed), plus 100% of
  tool-reported collision members (20 files), 100% of tokenless files (11),
  and the single TOKEN-MISMATCH line (messaging 10442). Zero gate failures.
- Verification method: `gh pr view <pr> --json closingIssuesReferences,title`
  (target must be a closing ref, or an unambiguous title ref when closing refs
  are empty) + issue-realness check per target.
- Independent verify pass: 8/8 branches CONFIRMED (48 verifier gh checks, all
  passed), including commit-shape, additions-only combined diffs, frontmatter-
  only patches, and id/issueNumber/issueUrl consistency at every branch tip.
- Sandbox note: `gh api repos/<repo>/issues/<n>` was denied by the sandbox
  permission layer in most agent sessions; agents substituted the equivalent
  read-only `gh issue view <n> --json number,title,url` (a `/pull/` URL marks
  a PR, `/issues/` a real issue — discriminator behavior verified against
  known PRs). One verifier session had `gh api` working and cross-confirmed
  the substitute method's conclusions.
- Volume kept modest: results cached per unique PR/issue number; roughly 30
  gh calls per rebuild agent plus ≤12 per verifier.

## Deviations from the mission

1. `npm run relink-issues -- --domain <domain>` does not exist on the rebuilt
   branches (script + flag live only on the toolchain branch); used the tool's
   documented invocation `npx ts-node src/scripts/relink-issues.ts --dir
   agent-memory/domains/<domain> [--apply]` instead.
2. Second commit on fix/filter-spec-skipped-pollution (ANTHROPIC_MODEL spec
   isolation) — see Task 1.
3. Test gating on branches without that fix uses `env -u ANTHROPIC_MODEL
   npm test` (the container exports the variable).
4. Three of the four mission SUSPECT premises were already corrected in the
   recorded promote tips (no file carried the "from" value); recorded with
   evidence rather than edited. The fourth (t&t 137) contradicts gh — flagged.
5. `relink-issues.ts --apply` exits 1 when flagged files remain even though
   writes succeed; treated as signaling after confirming APPLIED output and
   diffs matched the dry run exactly.
6. The A.4 schema borrow fallback for validate-schema was never needed (the
   tool writes only real issue numbers, never null/resolvedIssue).
7. `npm test` on pre-fix branches appends one line to
   `agent-memory/_skipped.ndjson` (the very bug fixed in Task 1); each
   occurrence was verified session-local and restored per conventions.

## Follow-ups discovered

- **107 drafts remain alias-flagged** ("no-issue": source PR has no resolvable
  closing ref; issueNumber still equals the PR number): 9 messaging,
  21 infrastructure, 21 forms-and-reports, 14 tasks-and-targets,
  16 authentication, 24 contacts, 2 configuration. These are the intended
  consumers of the A.4 `issueNumber: null` + `resolvedIssue` design; per-file
  lists live in the relink commit bodies and the mission worklog.
- **tasks-and-targets draft `9232-feat9231-…`** carries wrong identity
  cht-core-137; gh evidence says cht-core#9231. Needs operator relink.
- **messaging draft `9559-fix9467-…`**: title token says 9467, closing refs
  empty; deciding it creates worklist group 18 (see latent entry).
- infrastructure drafts `10482-fix10481-…` (correctly at 10481) and
  `10488-fix10481-…` (still at PR number 10488, flagged) share a slug; if
  10488 is ever relinked to 10481 they collide — review together.
- The tracked `agent-memory/_skipped.ndjson` contains 4 committed pollution
  lines from 2026-06-16 (pre-existing on main); removing them is a data change
  left to the operator.
- The 17+1 collision groups need operator adjudication (see worklist).

## Gate summary

- fix/filter-spec-skipped-pollution: build ✓, test 558/0 ✓, lint ✓, clean ✓.
- memory/promote-data-sync: validate-schema 64/0 ✓, suite 618/0 ✓ (env -u),
  build ✓, lint ✓.
- 8 rebuilt branches: validate-schema 0 failed on every branch (67/99/97/85/
  89/94/56/60 passed), `env -u ANTHROPIC_MODEL npm test` 558/0 in each group
  worktree, 8/8 independent verifier verdicts CONFIRMED.
