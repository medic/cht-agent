---
id: cht-core-10559
category: feature
domain: infrastructure
domainFit: weak
issueNumber: 10559
issueUrl: https://github.com/medic/cht-core/issues/10559
title: Add zizmor static analysis to GitHub Actions CI and harden all workflows (pin action SHAs, scope GITHUB_TOKEN permissions, fix script injection)
lastUpdated: '2026-10-08'
summary: CHT Core's GitHub Actions workflows carried supply-chain and privilege risks (unpinned actions, no explicit token permissions, a script-injection vector). This PR integrates the zizmor static analyzer into CI, fixes most findings across all 9 existing workflows and the two deploy composite actions, and lists the findings it accepts in .github/zizmor.yml, but names each workflow there by path while zizmor matches ignore entries only against a file's basename, so those entries suppress nothing (on master at the merge commit zizmor still reported 27 findings, 16 of them secrets-outside-env findings in .github/workflows/build.yml, the file the secrets-outside-env entry names).
services:
  - api
  - webapp
  - sentinel
  - admin
techStack:
  - github-actions
  - yaml
  - zizmor
  - dependabot
  - sarif
tags:
  - ci
  - security
  - supply-chain
  - static-analysis
  - github-actions
  - least-privilege
  - action-pinning
  - script-injection
  - dependabot
  - sarif
related_workflows: []
source_pr: medic/cht-core#10837
source_sha: 58547e47671d5c008852825ace505bafcf80bbc0
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - .github/workflows/zizmor.yml
  - .github/zizmor.yml
  - .github/dependabot.yml
  - .github/workflows/release-notes.yml
  - .github/workflows/stale-prs.yml
concepts:
  - CI supply-chain hardening
  - least-privilege GITHUB_TOKEN permissions
  - action pinning to immutable commit SHAs
  - static analysis in CI
  - script/template injection prevention
  - SARIF Code Scanning integration
  - automated dependency updates
related_issues: []
stale: true
---

## Problem

Before this PR, 65 `uses:` references in the YAML under `.github/` pointed at mutable tags rather than commit SHAs; seven of the nine workflows had no `permissions:` block (only `.github/workflows/codeql.yml` and `.github/workflows/stale-prs.yml` declared one); `.github/workflows/release-notes.yml` interpolated its `workflow_dispatch` inputs, including the free-text `milestone`, straight into the shell step that runs `scripts/release-notes/index.js` (`node index.js ${{ github.event.inputs.milestone }} ${{ github.event.inputs.skip_commit_checks }}`); `.github/workflows/stale-prs.yml` requested `actions: write`; and the composite actions `.github/actions/deploy-conf/action.yml` and `.github/actions/deploy-with-medic-conf/action.yml` interpolated their `username`, `password` and `hostname` inputs into the `--url` of their `run:` commands. There was also no automated detection to catch such issues going forward.

## Root Cause

GitHub Actions accepts tag references for actions and, without a `permissions:` block, gives a job the repository's default `GITHUB_TOKEN` scopes; the workflows were authored without minimum-privilege `permissions:` blocks or SHA pinning, and a free-text `workflow_dispatch` input was interpolated straight into a shell `run:` step (classic template injection).

## Solution

Added zizmor static analysis: the new `.github/workflows/zizmor.yml` runs `zizmorcore/zizmor-action` on every pull request with `online-audits: false` (step `Run zizmor (offline — PR)`), and with online audits on push to master and on a weekly schedule (`cron: '0 6 * * 0'`, Sundays 06:00 UTC); its job grants `security-events: write`, commented as required for uploading SARIF to GitHub Code Scanning. The new `.github/zizmor.yml` records each accepted finding with a rationale and a risk-acceptance date: `template-injection` ignored for `.github/workflows/release-notes.yml`, `cache-poisoning` for `.github/workflows/release-helm-charts.yml`, `credential-persistence` (a key that names no zizmor audit; zizmor's `persist-credentials` check is the `artipacked` audit) and `secrets-outside-env` for `.github/workflows/build.yml`, plus a `dependabot-cooldown` setting of `days: 7`.

Remediations: `.github/workflows/release-notes.yml` now passes both inputs through `env:` (`MILESTONE: ${{ github.event.inputs.milestone }}`, `SKIP_COMMIT_CHECKS: ${{ github.event.inputs.skip_commit_checks }}`) and runs `node index.js "$MILESTONE" $SKIP_COMMIT_CHECKS`; the two composite actions pass their inputs through `DB_USER`, `DB_PASS` and `DB_HOST` env vars; `actions: write` is removed from `.github/workflows/stale-prs.yml`, leaving `pull-requests: write`; the seven workflows without one gain `permissions:` (top-level `contents: read` in five, `contents: write` in `.github/workflows/release-helm-charts.yml`, job-level blocks in `.github/workflows/build.yml`); every external action reference in the workflow YAML is pinned to a full 40-character commit SHA with the version tag kept as a trailing comment; every `actions/checkout` step gains `persist-credentials: false`; and `.github/dependabot.yml` gains a `github-actions` ecosystem entry (weekly, on Saturday, `chore` commit prefix) so the pinned SHAs are kept current. In `.github/workflows/release-notes.yml`, `actions/checkout@v6` and `actions/setup-node@v6` were replaced by v4 commit SHAs.

> **Changed on master after landing (`stale-as-written`):** `.github/workflows/stale-prs.yml` requests `actions: write` again (restored by PR #11390 to allow cache updates), the pinned SHAs have since been bumped (e.g. `actions/checkout` to v6.0.2), and `.github/zizmor.yml` has gained further entries, including an `unpinned-uses` policy that allows a ref pin for `medic/cht-core/.github/actions/andrabot`. PR #11310 and PR #11432 rewrote `.github/workflows/release-helm-charts.yml`: it now runs on `workflow_run` when a `Build and test` run completes (its `branches` filter is `'[0-9]+.[0-9]+.[0-9]+'`), proceeds only if that run succeeded and was push-triggered, and publishes the committed `scripts/build/helm-releases` directory to GitHub Pages; its two jobs declare `contents: read`, `pages: write` and `id-token: write` in place of the top-level `contents: write`; its checkout no longer sets `persist-credentials: false`; the `actions/setup-node` step with the inline `cache-poisoning` ignore and the `gh release upload` step are gone; and the `cache-poisoning` comment in `.github/zizmor.yml` now rests on the new trigger.

## Code Patterns

Pin actions to immutable SHAs while keeping readability: `uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4` at this PR (.github/workflows/*.yml). Neutralize untrusted workflow inputs by binding them to env vars rather than interpolating into the shell — `MILESTONE: ${{ github.event.inputs.milestone }}` under `env:`, then `node index.js "$MILESTONE" $SKIP_COMMIT_CHECKS` (.github/workflows/release-notes.yml). Add a minimal top-level `permissions:` block per workflow scoped to only what it needs (e.g. `contents: read` in .github/workflows/cleanup.yml). Document accepted-not-fixed findings in .github/zizmor.yml with rationale. Automate SHA freshness via the `github-actions` Dependabot ecosystem in .github/dependabot.yml.

## Design Choices

zizmor runs with `online-audits: false` on pull requests to avoid GitHub API rate limits. Full 40-char SHA pinning was chosen over tag pinning for true immutability against tag-moving supply-chain attacks. The `template-injection` entry names `.github/workflows/release-notes.yml` by path, but zizmor matches an `ignore:` entry only against the basename of the file a finding is in (the expected form is `release-notes.yml`, optionally with `:line` or `:line:col`), so none of the four path entries in `.github/zizmor.yml` suppresses anything (on master at the merge commit, zizmor still reported 16 `secrets-outside-env` findings in `.github/workflows/build.yml`, among them the `personal_token` line that the `secrets-outside-env` entry describes); the only inline suppression is a `# zizmor: ignore[cache-poisoning]` comment on the `actions/setup-node` step of `.github/workflows/release-helm-charts.yml`. The `template-injection` comment argues that both inputs now go through `env:` vars — `"$MILESTONE"` quoted, and `$SKIP_COMMIT_CHECKS` a constrained `choice` input ('' or '--skip-commit-validation' only) — and that workflow_dispatch is only triggerable by org members with Actions write access. The `cache-poisoning` suppression rests on `.github/workflows/release-helm-charts.yml` triggering, at this PR, only on pushes of tags matching `'v*'`. The `github-actions` Dependabot ecosystem was added so SHA pinning doesn't impose ongoing manual maintenance. SARIF upload surfaces findings in the Code Scanning UI.

## Related Files

- .github/actions/deploy-conf/action.yml
- .github/actions/deploy-with-medic-conf/action.yml
- .github/dependabot.yml
- .github/workflows/build.yml
- .github/workflows/cleanup.yml
- .github/workflows/codeql.yml
- .github/workflows/conventional-commits.yml
- .github/workflows/helm-validation.yml
- .github/workflows/release-helm-charts.yml
- .github/workflows/release-notes.yml
- .github/workflows/scalability.yml
- .github/workflows/stale-prs.yml
- .github/workflows/zizmor.yml (added)
- .github/zizmor.yml (added)

## Testing

No tests were added; the diff is CI configuration only (12 modified files under `.github/` plus the added `.github/workflows/zizmor.yml` and `.github/zizmor.yml`). The new zizmor workflow re-checks the workflows on every PR, on push to master, and weekly. The PR description's test plan reports local checks: a `zizmor --offline .github/workflows/` run with all findings remediated or documented in `.github/zizmor.yml`, a YAML syntax check, and a check that no unpinned external action reference remained. At this PR every external action reference in the YAML under `.github/` is pinned to a 40-character SHA, but the zizmor run on master at the merge commit still reported 27 findings: 18 `secrets-outside-env` (16 in `.github/workflows/build.yml`, 2 in `.github/workflows/scalability.yml`), 8 `ref-version-mismatch` (6 in `.github/workflows/build.yml`, 2 in `.github/workflows/codeql.yml`) and 1 `dependabot-cooldown` (in `.github/dependabot.yml`).

## Related Issues

- #10559: "Implement static analysis of github CI to check for security vulnerabilities" — this draft's issue; it proposed adopting zizmor because unpinned or loosely pinned CI versions are hard to audit.
- PR medic/cht-docs#2185: "docs(#10559): add guidelines for zizmor static analysis" — companion docs PR adding a zizmor section to the cht-docs Static Analysis page (SHA pinning, Dependabot updates, running zizmor locally).

## Domain Rationale

**Fit:** weak

Every file in the diff is GitHub Actions configuration under `.github/` (the nine workflows, two composite actions, `.github/dependabot.yml`, and the added zizmor workflow and config), with no change to API, Sentinel, webapp or admin code. The pipeline it edits is infrastructure, but the change's purpose is security hardening of that pipeline — least-privilege tokens, SHA-pinned actions, no shell interpolation of inputs, a security scanner — which is a security concern rather than build/deploy operations; with no security domain, infrastructure is the least-bad home rather than a principled fit.
