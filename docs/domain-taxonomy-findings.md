# Domain Taxonomy Findings — Memory Seeding Pipeline (updated 2026-06-12, round 2)

Evidence from running the memory distillation pipeline (PR #109 + claude-cli
backend) over the **newest ~400 merged cht-core PRs** (two rounds), with the
distiller required to self-report a `domainFit: strong | weak` and a
rationale for every domain pick. Raw drafts: `agent-memory/_pending/`
(Opus 4.8 runs) and `agent-memory/_pending-fable5/` (prior Fable 5 run,
newest-100 window).

## Headline numbers (cumulative, ~400 PRs)

- **125 drafts** distilled from ~534 processed PR outcomes (skips dominate;
  2 flag-for-human judgments, 0 errors across all rounds).
- **49 of 125 drafts (39%) self-report a weak domain fit** — stable across
  rounds (41% in round 1, 37% in round 2), so it's structural, not noise.
- `configuration` is the catch-all: **26 of its 30 drafts (87%) are weak
  fits**. `interoperability` second (5/7). Healthy domains validate the
  method: `forms-and-reports` 0/16, `messaging` 0/9, `tasks-and-targets`
  1/18 weak.

| Domain | drafts | weak | weak % |
|---|---:|---:|---:|
| configuration | 30 | 26 | 87% |
| data-sync | 22 | 10 | 45% |
| tasks-and-targets | 18 | 1 | 6% |
| forms-and-reports | 16 | 0 | 0% |
| contacts | 14 | 5 | 36% |
| interoperability | 7 | 5 | 71% |
| authentication | 9 | 2 | 22% |
| messaging | 9 | 0 | 0% |

## The weak fits cluster into three gaps

### 1. UI Extensions — a whole workstream with no home (13 PRs)

The single largest cluster. One feature area, scattered across three domains,
every placement self-reported weak:

- → `configuration`: 10762, 10764, 10785, 10909, 10918, 10928, 11020
- → `interoperability`: 10773, 10774, 10921, 11022
- → `data-sync`: 10767, 11105

The A/B run confirms the instability: three of these PRs (10921, 11022,
11105) were placed in `configuration` by one model run and moved to
`interoperability`/`data-sync` by the other. When two frontier models can't
agree where a feature lives, the taxonomy — not the classifier — is the gap.

### 2. Infrastructure / CI / build / deploy / upgrade lifecycle (9 PRs)

There is intentionally no domain for ops work, so it lands in
`configuration` (and once each in `authentication`/`tasks-and-targets` when
the PR had a security/test flavor):

- CI & build tooling: 10837 (zizmor), 10857 (secretlint), 10701 (nyc
  coverage), 11122 (release-branch versioning), 10689 (admin-tool scaffold)
- Deploy & upgrade lifecycle: 10826 (Helm crash), 10750 (CouchDB
  entrypoint), 10758 (Docker NODE_ENV), 11141 (skip compaction on upgrade)

11141 was the PR that triggered this investigation; its draft now carries the
honest rationale: *"upgrade-lifecycle/performance PR touching the API's
setup/upgrade service … none of the 8 functional domains is a match."*

### 3. Storage-engine internals + misc webapp UX (5 PRs)

Nouveau/Lucene index hardening (11133, 11137, 10986), UUID v7 migration
(10935) — genuinely cross-cutting CouchDB internals that straddle
`data-sync`/`contacts`; and one a11y/i18n fix (10932) with no UX domain.
These are tolerable as-is; the rationale sections make them auditable.

## Round-2 evidence (PRs ~201–400) — the clusters hold and grow

Round 2 (59 drafts, 22 weak) is an older window, before the UI Extensions
workstream existed — and the same structural gaps appear with different
feature names:

### Infrastructure/deploy/upgrade grows to ~19 PRs total

The strongest case for an `infrastructure`/`operations` domain. New members:
Helm/K8s topology (10181, 10482, 10488, 10500), deployment config (10512,
10583, 10267 HAProxy), admin upgrade-page tooling (10264, 10301, 10557),
HTTP-transport internals (10306, 10327 undici). Combined with round 1's CI/
build/upgrade strays, roughly **1 in 7 distill-worthy PRs is ops knowledge
with no home**.

### Workstream-scatter repeats: Nouveau search (like UI Extensions)

The Nouveau full-text-search migration spans deploy (10181/10482/10488 →
configuration), contact search (10201, 10622 → contacts), query internals
(10986, 11133, 11137 → data-sync/contacts). Second confirmed case of a
cross-cutting workstream shredded across domains — evidence the taxonomy
struggles with *workstreams*, not just ops.

### New small bucket: observability

Telemetry PouchDB isolation (10456) and the monitoring endpoint (10496) —
observability has no domain; both landed in `data-sync` as weak.

### A definition-encoding bug, not a taxonomy gap (FIXED in pipeline)

pt-BR translations (10555) and the partners/branding doc (10278) were marked
weak — but CLAUDE.md canonically defines `configuration` as "App settings,
**translations, branding**, hierarchy config". The shared `DOMAIN_EXAMPLES`
never said so; example 6 now encodes it. Lesson: some "weak" signal is the
*definitions*, not the taxonomy — audit rationales before proposing domains.

## A/B: Fable 5 vs Opus 4.8 (shared newest-100 window)

- **Draft selection identical**: both models distilled exactly the same 31
  PRs — what counts as knowledge-worthy is stable across models.
- **Domain placement: 25/31 unchanged, 6 moved**: 10853
  (forms-and-reports → messaging), 10921/11022 (configuration →
  interoperability), 11105 (configuration → data-sync), 11133/11137
  (data-sync → contacts). All six moves are inside the weak/ambiguous
  clusters above.
- Caveats: the Opus run also carried the improved prompt (shared domain
  definitions + pitfalls + rationale requirement), so moves reflect
  model+prompt, not model alone. Run 1's skip-log entries were not captured,
  so triage divergence on *skipped* PRs is not measurable — only draft sets.

## The architecture already has cross-domain mechanisms — mostly unused

The original agent-memory design anticipated cross-cutting work via **one
primary domain + cross-references**, not more domains:

| Mechanism | Status |
|---|---|
| `related_workflows` frontmatter (`CHTWorkflow` enum — "cross-domain workflow processes") | Enum closed (6 product workflows); distiller never emits it |
| `related_issues` frontmatter ("links to related agent-memory entries") | Distiller hardcodes `[]` |
| `tags` (freeform) | **Working organically**: `ui-extensions` (15 drafts) and `nouveau` (11) already span 4 domains — workstream retrieval via tag grep functions today |
| `agent-memory/indices/component-to-domains.json` (`Record<component, domain[]>` — many-to-many by design) | Only 3 components populated, none multi-domain |

## Recommendations for the squad

1. **House UI Extensions and Nouveau as `CHTWorkflow` enum additions, not
   domains** — extend the schema.json enum and have the distiller emit
   `related_workflows`; the emergent tags already prove the retrieval path.
   A workstream that touches webapp + api + ddocs + Helm is a *workflow* in
   this architecture's vocabulary, and a schema enum change is far lighter
   than changing `CHTDomain` in src/types/index.ts.
2. **Add an `infrastructure` (or `operations`) domain** for CI/build/deploy/
   upgrade-lifecycle knowledge (~19 of ~400 recent PRs) — it is neither a
   workflow nor a domain today, so the existing cross-reference mechanisms
   cannot absorb it. This remains the one true taxonomy gap.
3. **Have the seeding pipeline feed the dormant mechanisms** (follow-up
   work): emit `related_workflows` once the enum grows; populate
   `related_issues` with a deterministic post-pass cross-linking same-tag
   drafts; derive `component-to-domains.json` entries from the drafts'
   `entities` fields — the pipeline is the natural producer for that index.
4. **Keep the `domainFit` + `## Domain Rationale` mechanism permanently** —
   it converts taxonomy drift into measurable evidence and gives the
   `_pending` review pass a `grep '\*\*Fit:\*\* weak'` triage handle.
5. **Don't add a "refuse to classify" escape hatch yet** — weak-but-drafted
   preserves the knowledge and the audit trail; a refusal path would route
   to flag-for-human and reduce yield while the taxonomy question is open.

---

## Update (2026-06-23) — recommendations implemented + production-run evidence

The recommendations above drove the seeding-pipeline changes; the analysis above
is the pre-implementation rationale and is left intact. Status and new evidence:

### Recommendation status

| # | Recommendation | Status |
|---|---|---|
| 1 | UI Extensions/Nouveau as `CHTWorkflow`, not domains | **Done.** `CHTWorkflow` += `ui-extensions`, `nouveau-search`, `observability` (the 3rd added on empirical evidence — see below); distiller emits `related_workflows`. |
| 2 | Add `infrastructure` domain | **Done.** Added to `CHTDomain` (+ `CHT_DOMAINS`, schema enum, types). **Scoped** to operational lifecycle (CI/build/deploy/upgrade, Docker/Helm/HAProxy, runtime-deps) with an explicit exclusion of in-application/data-layer internals (see over-capture note). |
| 3 | Feed dormant mechanisms | **Partial.** `related_workflows` now emitted. `related_issues` post-pass and `component-to-domains.json` derivation still deferred (follow-up). |
| 4 | Keep `domainFit` + `## Domain Rationale` | **Done.** `domainFit` is frontmatter (queryable) + body rationale section. |
| 5 | No "refuse to classify" hatch | **Kept.** Weak-but-drafted retained; deferred drafts now routed to **Stream C** for the fit discussion rather than refused. |

### Production-run evidence (newest ~1000 merged PRs, claude-cli / Opus 4.8 / max)

338 drafts distilled; `validate-schema --pending-only` = 0 failures. Weak-fit by domain:

| Domain | drafts | weak | weak % |
|---|---:|---:|---:|
| data-sync | 52 | 38 | 73% |
| configuration | 28 | 18 | 64% |
| interoperability | 8 | 2 | 25% |
| contacts | 51 | 7 | 14% |
| forms-and-reports | 52 | 5 | 10% |
| authentication | 43 | 4 | 9% |
| tasks-and-targets | 37 | 2 | 5% |
| **infrastructure** | **50** | **1** | **2%** |
| messaging | 17 | 0 | 0% |
| **Total** | **338** | **77** | **23%** |

- **`configuration` (64%) and `data-sync` (73%) remain the catch-alls**, as predicted. data-sync now intentionally absorbs cross-cutting CouchDB/storage internals (UUID, Nouveau) per the scoping decision below — auditable via the rationale sections.
- **`infrastructure` at 2% weak validates the new domain** — this window was genuinely infra-heavy (CouchDB 3.5.x, Nouveau Helm/k3d, HAProxy, CI), so 50 strong drafts are real ops knowledge, not over-capture.

### `observability` added as a 3rd workflow (new vs round-2)

Empirically `observability`/`telemetry` tags spanned all 8 domains in the corpus —
the strongest cross-cutting signal after UI Extensions/Nouveau — so it was added to
`CHTWorkflow` alongside them rather than left homeless.

### Infrastructure over-capture — caught and fixed mid-run

Initial guidance let `infrastructure` absorb data-layer internals: PR 10935 (UUID
v4→v7) landed `infrastructure(strong)` though it was `data-sync(weak)` in both prior
runs and belongs to the "storage-engine internals, leave as-is" bucket. Fixed by
tightening `DOMAIN_EXAMPLES`/`DOMAIN_PITFALLS` (example 8 + pitfall 6) to scope
infrastructure to operational lifecycle and exclude code refactors / storage-engine
internals (UUID/ID gen, Nouveau/Lucene index docs, B-tree). 10935 now bins to
`data-sync`. Lesson reinforced: a new domain needs an explicit *exclusion* boundary,
not just an inclusion example.

### Still open → Stream C

The 77 weak-fit drafts are held in `agent-memory/_stream-c/` for a dedicated WIP PR +
squad discussion on domain-fit (esp. the data-sync/configuration catch-alls and whether
further workflows/sub-domains are warranted). Strong-fit drafts promote first (Stream B).
