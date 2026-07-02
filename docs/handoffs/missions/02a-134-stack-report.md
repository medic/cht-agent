# Mission 02a report — #134 stack: PR3 → PR4 → PR5

Session: 2026-07-02, cht-workbench container, ultracode mode.
Mission file: `/workspace/missions/02a-134-stack.md` (branches `134-pr3`, `134-pr4`, `134-pr5` only).

## Branches produced

| Branch | Tip | Commits | Tests | Lint | Build |
|---|---|---|---|---|---|
| `134-pr3` (off `134-cht-conf` @ `8822abb`) | `26e31ea` | `3a81eaa` feat + `26e31ea` review fix | **592 passing** | clean | clean |
| `134-pr4` (off `134-pr3`) | `3d4274e` | `e89ac68` feat + `3d4274e` review fix | **612 passing** | clean | clean |
| `134-pr5` (off `134-pr4`) | `dc29925` + this report commit | `c1ce30e` feat + `dc29925` review fix | **652 passing** | clean | clean |

Every branch was verified **standalone**: fresh `npm ci`, `npm run build`,
`npm run lint`, `npm test` in its own worktree (`.claude/worktrees/m02a*`),
each green at the tips above. Baseline on `134-cht-conf` was 571 passing.

Note for test runs in the workbench: the session exports `ANTHROPIC_MODEL=claude-fable-5`,
which leaks into `code-gen-registry.spec.ts`'s default-model expectation (a
pre-existing test, unrelated to this stack). Gates were run with
`env -u ANTHROPIC_MODEL npm test`; with the variable present, exactly that one
unrelated test fails.

## What each PR delivers

### `134-pr3` — Code Context: layer-aware target selection
- `layer`/`configArtifact` lifted from the ticket into LangGraph state at init
  (`ResearchStateAnnotation` channels) and passed explicitly into
  `CodeContextAgent.search(issue, routing)`; direct callers fall back to the
  ticket's own `technical_context`.
- DeepWiki target by layer: `cht-conf` → only the cht-conf wiki; `investigate`
  → the domain-based repos plus the cht-conf wiki, merged, with every insight
  stamped `sourceRepo`; `cht-core`/absent → today's domain-based selection,
  unchanged. (The live OpenDeepWiki serves `medic/cht-conf` — 90 docs —
  through the same parameterized client, so **`src/mcp/deepwiki-client.ts`
  needed no change**; target selection lives in the agent. Deviation from the
  mission's file list, with rationale.)
- Plan-prompt insight lines render a `[<repo>]` label **only for investigate
  tickets**, keeping every other ticket's prompt byte-identical (review fix —
  the first cut labelled unconditionally, violating the zero-behavior-change
  gate).
- Config tickets bias wiki-document selection with `configArtifact`/
  `artifactName` terms.
- Tests: mocked routing for all three layer values (real-client stubs + mock
  mode), `determineRepos` matrix, supervisor plumbing through the real graph
  (stubbed agents/planner), routing precedence (supervisor value over ticket)
  for both layer and configArtifact, `formatInsightLine` on/off/unlabelled,
  plan-prompt labelling on/off.

### `134-pr4` — Context Analysis: config-aware scoring (closes #135 criteria 3/4/5)
- `findSimilarIssues` filters by layer **first** (investigate keeps both
  layers), then scores, then de-duplicates by issue id keeping the
  highest-scoring draft per issue. Dedupe key = `issue_number`, falling back
  to the draft id; the loader now derives a file-based fallback id when a
  draft has neither field (review fix — previously all such drafts collided on
  `cht-core-unknown`).
- `calculateSimilarityScore`: core↔core pairs keep the original scoring
  byte-for-byte; any cht-conf side switches to config-shaped scoring —
  category 0.2 + layer match 0.3 (investigate treats both layers as
  compatible; review fix — the bonus could never fire for the one mixed-pool
  case) + configArtifact match 0.3 + mechanism-named-in-ticket 0.2, with
  core-shaped component overlap dropped. Mechanism matching is word-boundary
  (review fix — `'prevents'.includes('events')` had produced false +0.2
  boosts).
- `extractPatterns`/`extractDesignDecisions`: cht-conf entries emit the config
  snippet as the reusable pattern — the loader lifts the draft's
  `## Config Pattern` section into `ResolvedIssueContext.fix`, fence-aware in
  both the heading search (review fix — a fenced quotation of the heading
  derailed extraction) and the section scan, capped at 4000 chars. Config
  entries no longer pollute core component grouping; they yield a
  "fix at the config layer" design decision.
- Synthetic `historicalSuccessRate` removed end-to-end: type, agent, plan
  prompt, keyFindings, CLI display, and specs.
- The dedupe test uses a relinked-corpus-shaped fixture (distinct drafts
  sharing a trustworthy `issueNumber`), per the mission's gate — not the raw
  corpus. A mutation-guard test pins the layer filter itself (a cross-layer
  entry that would clear the 0.3 threshold is still excluded).

### `134-pr5` — Canonical diff + mounts + container deps
- `src/utils/canonical-diff.ts`: `CHT_CONF_PATH` (deployment config mount) vs
  `CANONICAL_CONF` (default `$CHT_CORE_PATH/config/standard`). Per-artifact
  candidate paths; **every facet present on both sides is compared** (review
  fix — first-found-only reported drifted forms as identical when only
  `.properties.json` differed); mixed one-sided facets report a facet
  mismatch, not `missing-in-canonical`. Text artifacts get an LCS line diff
  with common prefix/suffix trimmed first (review fix — the size cap used to
  eat the diff for app_settings-sized files), unchanged-run collapse, 4000-char
  truncation with marker; differing `.xlsx` falls back to the converted `.xml`
  when both sides have it. Never throws — everything degrades to a
  `CanonicalDiffResult` (`unavailable` etc.).
- `CodeContextFindings.canonicalDiff` attached by the agent for
  `layer: cht-conf` + `configArtifact` tickets only (layer-gated; tested
  against artifact-only and investigate tickets), and rendered into the plan
  prompt **even when the wikis returned zero insights** (review fix), inside a
  four-backtick fence (review fix — content containing ``` closed the block).
- Placeholder sentinel: compose mounts the committed `docker/conf-placeholder`
  by default and the image bakes `ENV CHT_CONF_PATH`, which made every
  "mount absent" fail-closed path unreachable (review finding). The placeholder
  now carries a `.cht-conf-placeholder` marker; `resolveDeploymentConfigRoot`
  treats a marked root as not mounted, so the diff degrades to `unavailable`
  and the dev gate fails closed on core-only sessions.
- Dev/qa gate: `src/utils/dev-target.ts#resolveDevelopmentTarget` —
  `cht-conf` → the deployment config mount with the cht-conf toolchain, never
  cht-core; fails closed without a real mount; refuses undisambiguated
  `investigate`.
- Container: `@anthropic-ai/claude-code` baked at the documented extension
  point; the read-only `.credentials.json` OAuth mount is now the documented
  runtime auth (API key kept as fallback); `CHT_CONF_PATH` mount (rw, placeholder
  default) + `CANONICAL_CONF` env in compose and Dockerfile; healthcheck also
  requires the `claude` binary.
- Sandbox hardening (review CRITICAL): the writable conf mount had no
  push-blocking layer, and embedded-credential URLs
  (`https://user:token@github.com/...`) bypass the `github.com`-prefix
  rewrites entirely. Added **catch-all `https://` and `http://`
  `pushInsteadOf` rewrites** at the system git level (in-container pushes to
  any host now fail; ssh is already purged), extended the pre-push hook and
  the start-up verifier to the deployment config repo, and updated the baked
  agent rules (`docker/agent/CLAUDE.md`) with the cht-conf write target and
  placeholder semantics.
- `convert-app-forms` verification: cht-conf's `xls2xform-medic` is a
  **self-contained pyxform zipapp** (bundles pyxform/openpyxl/xlrd/defusedxml)
  needing only system Python ≥ 3.10 — the Dockerfile's existing `python3`
  (bookworm = 3.11) suffices. Verified in the workbench image (same base +
  global cht-conf) by generating a real XLSForm and converting it
  end-to-end (`Conversion complete!`). **No new deps required.**

## Conflicts and their resolution

- One conflict, during the `134-pr5` rebase onto the fixed `134-pr4`:
  `src/supervisors/research-supervisor.ts` — PR5's new
  `formatCanonicalDiffSection` landed adjacent to the PR3-fix rewrite of
  `formatInsightLine`'s doc comment/signature. Resolved by keeping both
  methods (union); the four-backtick-fence and render-without-insights fixes
  were folded into the rebased PR5 commit during resolution.
- The `134-pr4` rebase onto the fixed `134-pr3` was clean.
- `agent-memory/_skipped.ndjson` picked up pipeline-test append churn during
  test runs; restored via `git checkout --` each time (verified session-local),
  per the conventions.

## Review process (ultracode)

Adversarial multi-agent review ran as a Workflow over the stack: 7 finder
lenses (correctness + spec/tests per PR, plus a stack-wide consistency/sandbox
lens) produced 29 raw findings; each finding was to be adjudicated by 2
independent refuters. **Deviation:** the org session limit was hit twice
(first during the PR3-only review — fully lost, substituted by inline
self-review — then mid-verify on the stack review), so only 2 findings were
machine-adjudicated (both CONFIRMED); I triaged the remaining 27 inline as
the acting adjudicator. Outcome: 13 findings fixed across the three fix
commits (`26e31ea`, `3d4274e`, `dc29925` — including one CRITICAL sandbox
hole), the rest rejected as wrong, out-of-scope, or noise; the two deliberate
rejections worth recording are below.

## Deviations from the mission

1. `src/mcp/deepwiki-client.ts` unchanged in PR3 (mission listed it): the
   client is already fully parameterized by repo (`?owner=medic&name=<repo>`),
   and the live server serves the cht-conf wiki through it — target selection
   belongs in the agent.
2. `resolveDevelopmentTarget` is not wired into an execution path: this
   codebase has no Development supervisor yet, and the claude-cli provider's
   `workingDirectory` (`src/llm/factory.ts`) is constructed without ticket
   context, so wiring it there would misroute non-development uses. The gate
   ships as the utility + tests + baked agent rules; wiring is a follow-up for
   the Development phase work (#8 lineage).
3. Review adjudication partially inline instead of fully adversarial (session
   limits, above).

## Follow-ups for the operator

- **Image verification (operator-run, per mission):** rebuild
  `cht-agent:local` and confirm — `claude --version` works and the
  healthcheck passes; `init-agent-git.sh` reports the two new catch-all
  rewrite checks OK; `cht ... convert-app-forms` converts a real form
  in-image; with a real config repo mounted at `CHT_CONF_PATH`, the pre-push
  hook lands in it and a push attempt fails; with defaults (placeholder), a
  cht-conf ticket's canonical diff reports `unavailable`.
- Wire `resolveDevelopmentTarget` into the Development supervisor when it
  lands (see deviation 2).
- `docs/docker-agent-runbook.md` still describes the pre-#134 mount set;
  worth a refresh when PR5 is opened upstream.
- The upstream PR for `134-pr4` should say **Closes #135** (criteria 3/4/5;
  criteria 1/2 landed with the PR1 loader work on `134-cht-conf`).
- Rejected review findings worth a second opinion at PR time: rendering
  `sourceRepo` labels for multi-repo *domain* searches (configuration/
  data-sync tickets) — deliberately withheld to honor the zero-behavior-change
  gate; and per-facet aggregated reporting (all drifted facets, not first) —
  the current single-result shape matches `CanonicalDiffResult` and the plan
  prompt's needs.

## How to consume this stack (mission 03)

Merge order: `134-pr3` → `134-pr4` → `134-pr5` (linear; each already contains
its predecessors). Do not collapse the branches; they map 1:1 to future
upstream PRs with the commit messages already shaped for them.
