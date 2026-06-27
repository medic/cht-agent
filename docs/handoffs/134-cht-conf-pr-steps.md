# #134 cht-conf extension — PR steps, commands, and commit messages

Operational companion to `docs/handoffs/134-cht-conf-extension-implementation.md` (the
plan) and `designs/cht-conf-agent-extension.md` (the analysis). This doc records the
**exact** branch layout, commit messages, and per-PR command sequences so the stack can
be reproduced and committed consistently.

> **Constraints (CLAUDE.md):** the agent never runs `git commit`/`git push`, the `gh`
> CLI, or Docker. The commands below are what **you** run. Tests/build use Node 22
> (`~/.nvm/versions/node/v22.18.0/bin`); the default shell is Node 20.

> **Actual landing decision: P0 + PR1 + PR2 ship together as ONE branch/PR.** They are not
> split into separate branches. The per-PR sections below remain the logical decomposition
> (and the plan for PR3–PR6); for the first cut, stage all of P0+PR1+PR2's files in a single
> commit (see §"Combined P0+PR1+PR2 commit"). PR3–PR6 stack off this branch.
>
> **Migrated to main (2026-06-27).** #119 and #133 are now on `main`, so the work was moved
> off `seeding-claude-cli-v2` onto **`main`**. Active branch is now **`134-cht-conf`** (off
> `origin/main`, worktree `.claude/worktrees/134-cht-conf-main`); the old
> `134-cht-conf-pr1` (off seeding-v2) is retained as a fallback with the work stashed.
> **Open the PR with base = `main`.** The migration was a clean carry-over (the base
> content was byte-identical on both bases); the only adjustment was one of main's
> mocked-LLM tests, which now expects `layer: 'cht-core'` on the inference short-circuit.

---

## 0. Base branch and worktree

The stack now bases on **`main`** (it carries #119's single-sourced taxonomy + the #108
schema/const-sync test that PR1 extends, and #133's docker that PR5 needs, both merged
2026-06-27). The active branch is **`134-cht-conf`**.

```bash
# how the current branch was created (off main, after #119/#133 merged):
git fetch origin
git worktree add .claude/worktrees/134-cht-conf-main -b 134-cht-conf origin/main
```

Stack each subsequent PR branch off the previous one (PR3 off this branch, PR4 off PR3, …),
or off the branch it depends on per the dependency graph in the plan.

### Node 22 setup (once per shell)

```bash
N22=~/.nvm/versions/node/v22.18.0/bin
export PATH="$N22:$PATH"   # or: nvm use   (an .nvmrc pinning 22.18.0 is present)
node -v                    # expect v22.18.0
npm ci
npm run build
```

### Standard pre-commit gate (run before every commit)

```bash
N22=~/.nvm/versions/node/v22.18.0/bin
export PATH="$N22:$PATH"
npx tsc --noEmit            # type-check
npx eslint <changed files>  # lint (or: npm run lint)
npm test                    # full suite
git checkout -- agent-memory/_skipped.ndjson 2>/dev/null  # discard pipeline-log churn from test runs
```

> **Note on `agent-memory/_skipped.ndjson`:** the pipeline tests append audit-log lines to
> this file at the default log path. That churn is unrelated to any PR — discard it before
> staging so it never lands in a diff.

---

## Combined P0+PR1+PR2 commit (the actual first cut)

P0, PR1, and PR2 are landing together on `134-cht-conf` (off `main`). Stage the union of
their files (no overlap) and commit once. The per-PR sections below explain each slice;
this is the consolidated command + message.

```bash
N22=~/.nvm/versions/node/v22.18.0/bin
export PATH="$N22:$PATH"
npx tsc --noEmit && npm test          # 571 passing on main, type-clean
git checkout -- agent-memory/_skipped.ndjson 2>/dev/null  # discard test churn

git add \
  src/supervisors/research-supervisor.ts src/cli/display-helpers.ts \
  src/constants/index.ts src/types/index.ts src/utils/context-loader.ts \
  src/utils/ticket-parser.ts src/utils/domain-inference.ts \
  agent-memory/schema.json agent-memory/TEMPLATE.md \
  test/constants/taxonomy-schema-sync.spec.ts test/utils/context-loader.spec.ts \
  test/utils/ticket-parser.spec.ts test/utils/domain-inference.spec.ts \
  test/fixtures/valid-ticket-cht-conf.md test/fixtures/invalid-layer.md \
  docs/handoffs/
git commit  # message below
```

**Combined commit message**
```
feat(#134): add cht-conf layer taxonomy, canonical-corpus loader, and layer-aware tickets

Foundation for extending the Research Supervisor to cht-conf. Bundles three slices:

P0 — skip unsupported sampling params (temperature/top_p/top_k) for Opus
4.6/4.7/4.8 and Fable, which 400 on them via @langchain/anthropic's injected
top_p/top_k = -1; add a RESEARCH_MODEL env override.

PR1 — add a single-sourced layer/configArtifact/mechanism taxonomy (constants +
schema.json + drift-lock test), extend ResolvedIssueContext, and fix the Context
Analysis loader to read the canonical agent-memory/domains/<domain>/issues/ corpus
(dropping the empty legacy path and the phase: completed filter). layer defaults
to cht-core, so cht-core behavior is unchanged. Resolves the context-analysis
memory-pipeline schema-bridge issue (Option 1).

PR2 — accept and infer layer/configArtifact on tickets: optional layer,
configArtifact, artifactName, chtConfVersion, deploymentRef on technical_context
(validated when present); the parser leaves layer unset so inference fills the
gap; domain-inference parses them tolerantly (absent/invalid layer -> cht-core,
unknown configArtifact dropped) and enrichIssueTemplate merges with frontmatter
precedence.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

> The individual P0 / PR1 / PR2 commit messages below are retained for reference in case
> the slices are ever split out; for the combined landing, use the message above.

---

## P0 — Opus 4.6/4.7/4.8 sampling-param fix ✅ implemented

Independent of #134; land first because it unblocks running the supervisor on Opus
anywhere. `@langchain/anthropic@0.3.33` injects `top_p/top_k = -1`, which Opus 4.6/4.7/4.8
and Fable reject (HTTP 400). For those models, override `temperature`/`top_p`/`top_k` to
`undefined` via `invocationKwargs` (spread last; `undefined` values are dropped from the
request). Companion: a `RESEARCH_MODEL` env override so the model is selectable at runtime.

**Files**
- `src/supervisors/research-supervisor.ts` — planner construction.
- `src/cli/display-helpers.ts` — `RESEARCH_MODEL` env override.

**Commands**
```bash
export PATH="$N22:$PATH"
npx tsc --noEmit && npx eslint src/supervisors/research-supervisor.ts src/cli/display-helpers.ts && npm test
git add src/supervisors/research-supervisor.ts src/cli/display-helpers.ts
git commit  # message below
```

**Commit message**
```
fix: skip unsupported sampling params for Opus 4.6/4.7/4.8 and Fable

@langchain/anthropic@0.3.33 injects top_p/top_k = -1 by default. Opus
4.6/4.7/4.8 and Fable 5 removed the sampling params and return HTTP 400 when
any of temperature/top_p/top_k is sent. For those models, override the three
to undefined via invocationKwargs (spread last, dropped from the request when
undefined) so the planner runs on Opus. Add a RESEARCH_MODEL env override so
the planner model is selectable at runtime.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## PR1 — Schema unification + canonical-corpus loader (foundation) ✅ implemented

Adds the `layer` dimension to the single-sourced taxonomy and makes the Context Analysis
loader read the **real** corpus (`domains/<domain>/issues/`). Resolves the
context-analysis loader bug (`docs/issues/context-analysis-memory-pipeline-schema-bridge.md`,
"Option 1": make `domains/<domain>/issues/` canonical, drop the empty legacy path and the
`phase: completed` filter). **No behavior change for cht-core** — `layer` defaults to
`cht-core`.

**Files**
- `src/constants/index.ts` — `CHT_LAYERS`, `CONFIG_ARTIFACTS`, `CONFIG_MECHANISMS`.
- `src/types/index.ts` — `CHTLayer`/`ConfigArtifact`/`ConfigMechanism` unions; optional
  config fields on `ResolvedIssueContext`.
- `agent-memory/schema.json` — `CHTLayer`/`ConfigArtifact`/`ConfigMechanism` defs +
  optional `layer`/`configArtifact`/`mechanism` frontmatter.
- `agent-memory/TEMPLATE.md` — config frontmatter, a "Config Pattern" note, and a cht-conf
  worked example.
- `src/utils/context-loader.ts` — read `domains/<domain>/issues/`, map pipeline
  frontmatter → `ResolvedIssueContext`; drop the empty legacy reader.
- `test/constants/taxonomy-schema-sync.spec.ts` — sync assertions for the 3 new enums.
- `test/utils/context-loader.spec.ts` — draft-mapping tests (core, cht-conf fields,
  invalid-enum guard, skip-stray).

**Commands**
```bash
export PATH="$N22:$PATH"
npx tsc --noEmit
npx eslint src/constants/index.ts src/types/index.ts src/utils/context-loader.ts \
  test/constants/taxonomy-schema-sync.spec.ts test/utils/context-loader.spec.ts
npm test                                   # full suite green
npx ts-node src/scripts/validate-schema.ts # corpus still validates against the new schema
git add src/constants/index.ts src/types/index.ts src/utils/context-loader.ts \
  agent-memory/schema.json agent-memory/TEMPLATE.md \
  test/constants/taxonomy-schema-sync.spec.ts test/utils/context-loader.spec.ts
git commit  # message below
```

**Commit message**
```
feat(#134): add layer/config taxonomy and read the canonical memory corpus

Add a `layer` discriminator (cht-core | cht-conf | investigate) plus
`configArtifact` and `mechanism` enums, single-sourced in src/constants and
mirrored in agent-memory/schema.json with the #108 taxonomy-schema-sync test
extended to lock them. Extend ResolvedIssueContext with optional config fields
(layer, configArtifact, mechanism, fix, chtConfActions, relatedArtifacts) and
TEMPLATE.md with config frontmatter, a Config Pattern section, and a cht-conf
worked example.

Fix the Context Analysis loader: findResolvedIssuesByDomain now reads the
canonical pipeline corpus at agent-memory/domains/<domain>/issues/ and maps the
draft frontmatter onto ResolvedIssueContext, dropping the empty legacy
knowledge-base/resolved-issues/by-domain path and the phase: completed filter
that left the agent with zero contexts. layer defaults to cht-core, so cht-core
behavior is unchanged; unrecognized enum values are dropped.

Resolves the context-analysis memory-pipeline schema bridge (Option 1).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Manual test (no container)**
```bash
export PATH="$N22:$PATH"
npm test   # all pass incl. new loader + taxonomy tests
# cht-core regression check (needs a real key):
ANTHROPIC_API_KEY=… RESEARCH_MODEL=claude-opus-4-8 \
  npm run research -- tickets/demo-data-sync-replication.md
# expect Context Analysis to return real contexts (layer defaults to cht-core)
```

---

## PR2 — Ticket template + domain inference (layer-aware) ✅ implemented

**Depends on:** PR1 (enums). Adds `layer`/`configArtifact` to the ticket input and has
domain inference emit them. **No behavior change for cht-core** — `layer` defaults to
`cht-core`.

**Locked contracts** (decided after the scoping/verify pass):
- **Tolerant LLM parsing:** `parseLLMResponse` parses `layer`/`configArtifact` as optional;
  an absent or unrecognized `layer` defaults to `cht-core`, an unrecognized `configArtifact`
  is dropped. It never throws on these new fields, so older/cached responses still parse.
- **Frontmatter precedence:** an explicit `layer`/`configArtifact` on the ticket wins;
  inference only fills a gap.
- **Short-circuit preserved:** when `domain` + `components` are already present,
  `inferDomainAndComponents` returns without the LLM and carries through the ticket's
  `layer`/`configArtifact` (defaulting `layer` to `cht-core`).
- **Validators fire only when present:** `validateLayer`/`validateConfigArtifact` mirror
  `validateDomain` (throw on an invalid *present* value); the parser defaults `layer` to
  `cht-core` at the `technical_context` construction site.

**Files**
- `src/types/index.ts` — `IssueTemplate.technical_context` gains optional `layer`,
  `configArtifact`, `artifactName`, `chtConfVersion`, `deploymentRef`.
- `src/utils/ticket-parser.ts` — `validateLayer`/`validateConfigArtifact`; parse + default
  `layer`; `mapErrorMessage` patterns for the new validators.
- `src/utils/domain-inference.ts` — exported `InferenceResult`; tolerant `layer`/
  `configArtifact` parse; prompt additions; short-circuit carry-through; frontmatter-
  precedence merge in `enrichIssueTemplate`.
- `test/utils/ticket-parser.spec.ts`, `test/utils/domain-inference.spec.ts` — 6 new tests.
- `test/fixtures/valid-ticket-cht-conf.md`, `test/fixtures/invalid-layer.md` — fixtures.

**Commands**
```bash
export PATH="$N22:$PATH"
npx tsc --noEmit
npx eslint src/types/index.ts src/utils/ticket-parser.ts src/utils/domain-inference.ts \
  test/utils/ticket-parser.spec.ts test/utils/domain-inference.spec.ts
npm test   # 550 passing
git add src/types/index.ts src/utils/ticket-parser.ts src/utils/domain-inference.ts \
  test/utils/ticket-parser.spec.ts test/utils/domain-inference.spec.ts \
  test/fixtures/valid-ticket-cht-conf.md test/fixtures/invalid-layer.md
git commit  # message below
```

**Commit message**
```
feat(#134): accept and infer layer/configArtifact on tickets

Add optional layer, configArtifact, artifactName, chtConfVersion, and
deploymentRef to a ticket's technical_context, validated against the PR1 enums
(validateLayer/validateConfigArtifact mirror validateDomain, firing only when the
field is present). The ticket parser defaults layer to cht-core. domain-inference
emits layer and configArtifact: the LLM prompt requests them, parseLLMResponse
parses them tolerantly (absent/invalid layer defaults to cht-core, unknown
configArtifact dropped) so older responses still parse, the existing-domain
short-circuit carries them through, and enrichIssueTemplate merges them with
frontmatter precedence. cht-core tickets are unaffected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Manual test**
```bash
# parser accepts the cht-conf ticket and defaults layer:
export PATH="$N22:$PATH"
npm test  # incl. the new cht-conf parser + short-circuit tests
# author a layer: cht-conf ticket (e.g. the PNC miscarriage skip-logic) and confirm
# the parser accepts layer/configArtifact and inference emits them when omitted.
```

**Manual test**
```bash
# author a layer: cht-conf ticket (e.g. the PNC miscarriage skip-logic) and confirm:
#  - the parser accepts layer/configArtifact
#  - inference emits them when omitted
```

---

## PR3 — Code Context: layer-aware target selection

**Depends on:** PR2. Plumb `layer`/`configArtifact` through graph state into
`CodeContextAgent.search()`; select the DeepWiki target by layer (`cht-core` →
`cht-core-wiki`, `cht-conf` → `cht-conf-wiki`, `investigate` → both, merged/labelled).

**Files:** `src/agents/code-context-agent.ts`, `src/mcp/deepwiki-client.ts`,
`src/supervisors/research-supervisor.ts`.

**Commit message**
```
feat(#134): select the DeepWiki target by layer in Code Context

Plumb layer/configArtifact from the ticket through graph state into
CodeContextAgent.search() and choose the OpenDeepWiki target by layer: cht-core
queries cht-core-wiki (today's behavior), cht-conf queries cht-conf-wiki, and
investigate queries both and merges/labels by source. Target selection only —
no new indexing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## PR4 — Context Analysis: config-aware scoring + patterns

**Depends on:** PR1 (schema); soft-depends PR2 (layer in state). Add a strong `layer`
match + `configArtifact`/`mechanism` overlap to `calculateSimilarityScore`; filter
`findSimilarIssues` by `layer` first; emit the config snippet as the pattern for cht-conf
entries. **Also addresses the remaining schema-bridge concerns:** de-duplicate similar
issues by id and drop the synthetic `historicalSuccessRate`.

**Files:** `src/agents/context-analysis-agent.ts` (+ its spec).

**Commit message**
```
feat(#134): score and surface config context by layer

calculateSimilarityScore adds a strong layer match plus configArtifact/mechanism
overlap, and drops core-shaped service/component overlap for cht-conf entries;
findSimilarIssues filters by layer first so core fixes never surface for a config
ticket (or vice-versa). extractPatterns/extractDesignDecisions emit the config
snippet as the reusable pattern for cht-conf. De-duplicate similar issues by id
and remove the synthetic historicalSuccessRate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## PR6 — Memory pipeline: public config mining + private local distillation

**Depends on:** PR1. Parallel track (can land any time after PR1). Extends the #119
scraper/filter/distiller to mine `medic/cht-conf` issues/PRs, reference configs, and
config-tagged cht-core issues; tag `layer: cht-conf`; pattern = config snippet. Private
path: read-only org GH token + manual issue approval → distill (Claude-CLI, no API key)
into a **local, gitignored** memory root; never committed, never Kapa-indexed.

**Files:** `src/scripts/{scraper,filter,distiller}.ts`, pipeline CLI flags,
`src/utils/context-loader.ts` (read the extra local root), `.gitignore`.

**Commit message**
```
feat(#134): mine cht-conf config knowledge into agent-memory

Extend the scraper/filter/distiller to mine medic/cht-conf issues/PRs, reference
configs (as exemplar patterns), and config-tagged cht-core issues, tagging
layer: cht-conf with the config snippet as the pattern. Add a private path: a
read-only org GH token plus a manually approved issue list distill (via the
Claude-CLI provider, no API key) into a local gitignored memory root that is
never committed and never Kapa-indexed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## PR5 — Canonical-config diff + local mount + container/test-env deps

**Depends on:** PR3 **and #133 on `main`** (it edits the docker files #133 introduces).
Keep in draft until #133 lands; develop/test on a local integration branch meanwhile (see
the plan §3). Adds `CANONICAL_CONF` (default standard config) + `CHT_CONF_PATH` mount; diff
the suspect artifact vs the canonical baseline at the matching version; toggle dev/qa gates
to the cht-conf toolchain.

**Files:** `src/agents/code-context-agent.ts` (or a new `canonical-diff` util),
`docker/docker-compose.cht-agent.yml`, `docker/Dockerfile`, test-env config.

**Commit message**
```
feat(#134): diff deployment config against a canonical baseline

Add CANONICAL_CONF (default standard config) and a CHT_CONF_PATH mount for the
deployment's config repo. Read the deployment config from the mount, diff the
suspect artifact against the canonical baseline at the matching version, and
surface the diff in CodeContextFindings. Ensure the test-env image carries the
XLSForm generation/conversion deps and toggle the dev/qa gates to the cht-conf
toolchain.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## Recommended review sequence

```
P0 → PR1 → PR2 → PR3 → PR4 → PR6 → PR5
```

PR5 is last because of the #133 gate (now satisfied — #133 is on `main`). PR4 and PR6 can
open in parallel once the combined P0+PR1+PR2 PR merges.

## ✅ Migration to main (done 2026-06-27)

#119 and #133 merged to `main`. #119 went in **squashed**, so its individual commits are
not in main's history (main has the equivalent `ed07177`); a literal `git rebase` would
replay phantom commits. Because every file the work touches was byte-identical on
`seeding-claude-cli-v2` and `main`, the work was carried over via stash → new branch off
`main`, not a rebase:

```bash
# (already executed) old worktree:
git -C .claude/worktrees/134-cht-conf stash push -u -m "134 wip (migrate to main)"
# new worktree + branch off main:
git worktree add .claude/worktrees/134-cht-conf-main -b 134-cht-conf origin/main
git -C .claude/worktrees/134-cht-conf-main stash apply stash@{0}   # clean, 0 conflicts
```

Result: active branch `134-cht-conf` off `origin/main`; old `134-cht-conf-pr1` retained as
a fallback (work stashed in `stash@{0}`). One of main's mocked-LLM tests was updated to
expect `layer: 'cht-core'` on the inference short-circuit. Open the PR with **base = `main`**.
