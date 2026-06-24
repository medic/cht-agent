---
id: cht-core-10559
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 10559
issueUrl: https://github.com/medic/cht-core/issues/10559
title: Add zizmor static analysis to GitHub Actions CI and harden all workflows (pin action SHAs, scope GITHUB_TOKEN permissions, fix script injection)
lastUpdated: '2026-06-22'
summary: CHT Core's GitHub Actions workflows carried supply-chain and privilege risks (unpinned actions, broad default token permissions, a script-injection vector). This PR integrates the zizmor static analyzer into CI and remediates every finding across all 9 existing workflows.
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
stale: false
---

## Problem

Running zizmor against the repo surfaced systemic CI security issues: 45+ unpinned action references (mutable @vN tags vulnerable to silently-moved tags), 7 of 9 workflows with no explicit permissions block (granting GITHUB_TOKEN broad write access by default), a script-injection vulnerability in release-notes.yml where the free-text workflow_dispatch input `milestone` was interpolated directly into a `run:` shell command, an over-privileged stale-prs.yml carrying unneeded `actions: write`, and non-existent `@v6` tags on actions/checkout and actions/setup-node. There was also no automated detection to catch such issues going forward.

## Root Cause

GitHub Actions permits unpinned/loosely-pinned action references and grants broad default token scopes; the workflows were authored without minimum-privilege `permissions:` blocks or SHA pinning, and a free-text `workflow_dispatch` input was interpolated straight into a shell `run:` step (classic template injection).

## Solution

Added zizmor static analysis: new .github/workflows/zizmor.yml runs offline on every PR (to avoid API rate limits), on push to master, and weekly on Sundays, uploading results to the GitHub Security tab as SARIF; .github/zizmor.yml holds one documented suppression. Remediated all findings: fixed the release-notes.yml script injection by routing the `milestone` input through a quoted env var ("$MILESTONE") instead of raw template interpolation; removed `actions: write` from stale-prs.yml (only `pull-requests: write` is needed); added minimum-scoped `permissions:` blocks to all 9 workflows; pinned every external action to a full 40-char commit SHA with the version tag preserved as a trailing comment; fixed the @v6 typos. Added the `github-actions` ecosystem to dependabot.yml so weekly PRs keep the pinned SHAs current automatically.

## Code Patterns

Pin actions to immutable SHAs while keeping readability: `uses: actions/checkout@<40-char-sha>  # v4` (.github/workflows/*.yml). Neutralize untrusted workflow inputs by binding them to a quoted env var rather than interpolating into the shell — `env: { MILESTONE: ${{ github.event.inputs.milestone }} }` then `run: node index.js "$MILESTONE"` (.github/workflows/release-notes.yml). Add a minimal top-level `permissions:` block per workflow scoped to only what it needs (e.g. stale-prs.yml → `pull-requests: write`). Document accepted-not-fixed findings in .github/zizmor.yml with rationale. Automate SHA freshness via the `github-actions` Dependabot ecosystem in .github/dependabot.yml.

## Design Choices

zizmor runs in `--offline` mode on PRs to avoid GitHub API rate limits. Full 40-char SHA pinning was chosen over tag pinning for true immutability against tag-moving supply-chain attacks. One finding (template-injection on the `skip_commit_checks` input in release-notes.yml) was suppressed rather than fixed, with documented justification: the input is a `choice` constrained to `['', '--skip-commit-validation']` (no shell metacharacters possible) and workflow_dispatch is only triggerable by org members with Actions write — whereas the genuinely risky free-text `milestone` input was fixed, not suppressed. Dependabot was added so SHA pinning doesn't impose ongoing manual maintenance. SARIF upload surfaces findings in the Code Scanning UI.

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
- .github/workflows/zizmor.yml
- .github/zizmor.yml

## Testing

Validated locally pre-merge (no runtime unit tests, as this is CI configuration): ran `zizmor --offline .github/workflows/` with all findings either remediated or documented in .github/zizmor.yml; validated YAML syntax for all 12 modified/new files with no parser errors; confirmed all 19 unique action SHAs are exactly 40 hex characters (none truncated); confirmed no unpinned external action references remain. The new zizmor.yml workflow provides ongoing automated validation in CI on every PR, push to master, and weekly.

## Related Issues

- #10559: GitHub CI permits unpinned/loosely-pinned action versions, creating supply-chain and audit security risks; requests adopting the zizmor static analyzer
- medic/cht-docs#2185: parallel docs PR documenting how zizmor works and how pinned SHAs are kept current via the cron/Dependabot job

## Domain Rationale

**Fit:** strong

This is CI/CD security tooling — adding a GitHub Actions static analyzer and hardening all workflow files. CI/build/deploy/supply-chain work is canonically the infrastructure domain (not configuration, per the stated pitfalls).
