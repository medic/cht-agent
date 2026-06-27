# PR body — #134: cht-conf layer taxonomy, canonical-corpus loader, layer-aware tickets

> Paste the section below into the PR. **Base = `main`** (#119 and #133 merged 2026-06-27;
> the work was migrated off `seeding-claude-cli-v2`). This single PR on branch
> **`134-cht-conf`** bundles **P0 + PR1 + PR2** (the slices were not split into separate
> branches). See "Included: P0" and "Included: PR2" below.

---

## feat(#134): layer/config taxonomy, canonical-corpus loader, and layer-aware tickets

Foundation PR for [#134 — Extending the Research Supervisor to cht-conf](https://github.com/medic/cht-agent/issues/134).
Adds the `layer` dimension to the single-sourced taxonomy, makes the Context Analysis
Agent read the **real** distilled corpus, and teaches the ticket parser + domain inference
to carry `layer`/`configArtifact`. **No behavior change for cht-core** — `layer` defaults
to `cht-core` everywhere.

### Why

Two things block cht-conf support and the full Research Supervisor demo:

1. **The taxonomy has no way to say "this is a config issue, not a platform issue."**
   Without a `layer` discriminator, a config ticket and a cht-core fix score against each
   other and pollute similarity results.
2. **The Context Analysis Agent reads a path the memory pipeline never writes to.** It
   scanned `agent-memory/knowledge-base/resolved-issues/by-domain/<domain>/` (only a
   `.gitkeep`) and required `phase: completed`, while the pipeline writes
   `agent-memory/domains/<domain>/issues/*.md` with different field names. Result: with the
   corpus fully populated, the agent found **zero** similar issues and silently fell back
   to generic recommendations. (Documented in
   `docs/issues/context-analysis-memory-pipeline-schema-bridge.md`.)

### What this PR does

**Taxonomy (single-sourced, mirrored, drift-locked)**
- `src/constants/index.ts`: `CHT_LAYERS` (`cht-core | cht-conf | investigate`),
  `CONFIG_ARTIFACTS`, `CONFIG_MECHANISMS`.
- `src/types/index.ts`: derives `CHTLayer` / `ConfigArtifact` / `ConfigMechanism`; extends
  `ResolvedIssueContext` with optional `layer`, `configArtifact`, `mechanism`, `fix`,
  `chtConfActions`, `relatedArtifacts`.
- `agent-memory/schema.json`: matching `CHTLayer` / `ConfigArtifact` / `ConfigMechanism`
  definitions + optional `layer` / `configArtifact` / `mechanism` frontmatter properties.
- `test/constants/taxonomy-schema-sync.spec.ts`: extends the #108 drift-lock test with
  three assertions so a const-only or schema-only edit fails CI.

**Loader (the schema-bridge fix — Option 1)**
- `src/utils/context-loader.ts`: `findResolvedIssuesByDomain()` now reads the canonical
  `agent-memory/domains/<domain>/issues/` corpus and maps the pipeline frontmatter onto
  `ResolvedIssueContext`. The empty legacy `knowledge-base/resolved-issues/by-domain` path
  and the `phase: completed` requirement are removed. `layer` defaults to `cht-core`;
  unrecognized enum values are dropped via a small guard.

**Template**
- `agent-memory/TEMPLATE.md`: `layer` / `configArtifact` / `mechanism` frontmatter, a
  "Config Pattern" note (config snippet replaces "Code Patterns" for cht-conf entries), and
  a cht-conf worked example (the PNC miscarriage skip-logic from the design doc).

### Resolves the schema-bridge issue (`context-analysis-memory-pipeline-schema-bridge.md`)

| Concern | How this PR addresses it |
|---|---|
| Reads an empty legacy path / requires `phase: completed` | Reads `domains/<domain>/issues/` directly; legacy path + phase filter dropped |
| Lossy `services`→`components`, `tags`-as-components | Mapping kept for overlap signal, but documented; field-level scoring is PR4 |
| Duplicate issue ids in results | Single canonical source removes the cross-path dup; result-level de-dup is PR4 |
| Synthetic `historicalSuccessRate` | Not introduced here; removal lands with the scoring rewrite in PR4 |

> PR4 (Context Analysis scoring) finishes the schema-bridge acceptance criteria
> (field-level scoring, result de-dup, success-rate removal). PR1 makes the corpus
> readable; PR4 makes it well-scored.

### Included: PR2 (layer-aware tickets + domain inference)

- `IssueTemplate.technical_context` gains optional `layer`, `configArtifact`,
  `artifactName`, `chtConfVersion`, `deploymentRef`.
- The ticket parser validates `layer`/`configArtifact` when present (mirroring
  `validateDomain`) and **leaves `layer` unset when frontmatter omits it**, so inference
  can fill the gap rather than the parser pinning a premature `cht-core`.
- Domain inference asks the LLM for `layer`/`configArtifact` and parses them **tolerantly**:
  an absent or unrecognized `layer` defaults to `cht-core`, an unknown `configArtifact` is
  dropped, and it never throws on these new fields — so older/cached responses still parse.
- `enrichIssueTemplate` merges with **frontmatter precedence** (an explicit ticket value
  wins; inference only fills a gap) and guarantees `layer` is set after enrichment.

### Included: P0 (Opus sampling-param fix)

`@langchain/anthropic@0.3.33` injects `top_p/top_k = -1`, which Opus 4.6/4.7/4.8 and Fable
reject with HTTP 400. The planner now drops the three sampling params via `invocationKwargs`
for those models, and a `RESEARCH_MODEL` env override makes the planner model selectable.
(Independent of #134; bundled so the supervisor is runnable on Opus for the manual test.)

### Testing

- `npm test` — **571 passing** under Node 22 on the `main` base, incl. the new
  layer/config tests (3 taxonomy-sync; 4 loader mapping; 6 ticket/inference: cht-conf parse,
  default-layer-on-enrich, frontmatter-precedence, invalid-layer, short-circuit carry-
  through). One of main's existing mocked-LLM tests was updated to expect `layer: 'cht-core'`
  on the inference short-circuit.
- `npx tsc --noEmit` and `eslint` clean.
- Verified a cht-conf draft validates against the updated schema via
  `src/scripts/validate-schema.ts --pending-only`, and that a bogus enum value is rejected.
- cht-core regression: an existing cht-core ticket still returns real contexts (`layer`
  defaults to `cht-core`).
- An adversarial review of the diff caught and fixed a real bug — the parser was defaulting
  `layer` too early, making LLM-inferred `layer` dead; the default now lives in inference.

### Notes for reviewers

- **`id`/`issueUrl` schema patterns are unchanged** — still require
  `cht-core`/`cht-interoperability`. Pure `cht-conf-…` ids are deferred to PR6
  (corpus-sourcing). Config-tagged cht-core issues (the common case) validate today.
- `ensureAgentMemoryExists()` still scaffolds the legacy `knowledge-base/...` dirs; left
  as-is (out of scope, harmless, `.gitkeep`-tracked).
- Base is `main`. The layer/configArtifact prompt additions merged cleanly on top of #119's
  dynamic 9-domain prompt roster (the earlier "only 7 domains" concern was against the old
  seeding-v2 prompt and no longer applies — `main` already enumerates all domains via
  `CHT_DOMAINS.length`).

Closes nothing on its own; advances #134 and resolves the schema-bridge issue's Option 1.
