# Issue draft — `reconstruct-rules` skill (opens in `medic/cht-ai-tools`)

> Follow-up from cht-agent mission 04. **Do not build in mission 04** — this is
> the escape hatch that turns the config-type boundary's hard stop
> (`src/utils/config-type.ts`, `needs-source-repo`) into a reconstruct-then-fix
> path. Paired with `designs/issue-cht-agent-tasks-targets-memory.md`.

## Problem

`cht-conf compile-app-settings` webpack+terser-minifies task/target **emission
logic** into `app_settings.tasks.rules` (variable-mangled, e.g.
`var e={85:(e,t,n)=>…}`) with no source maps (removed in cht-conf PR #215) and
no server-side source copy. So a site reconstructed from a live deployment
(admin API access, no cht-conf source repo) can recover forms + JSON config but
**not** readable `tasks.js` / `targets.js`. Today cht-agent's guard correctly
refuses a deployment-only task/target-logic fix and asks for the source repo.

## Insight that makes reconstruction possible

The **declarative** task/target *scaffold* survives minification: only the
predicate function BODIES (`appliesIf`, `resolvedIf`, `events[].dueDate`,
target `emitCustom`/`groupBy`) are mangled. `isDeclarative: true` blocks keep
their id/type/icon/title/goal/priority structure and the shape of the rule
array. A skill can walk `app_settings.tasks.rules` + `app_settings.tasks.targets`
and rebuild a readable `tasks.js` / `targets.js` skeleton, re-deriving the
predicate bodies from (a) the surviving declarative fields, (b) the referenced
form/field names, and (c) an LLM grounded on a corpus of known-good rules.

## Proposal — a `/reconstruct-rules` Claude Code skill

Input: `app_settings.json` (from `cht backup-app-settings`) + the deployment's
form list. Output: candidate `tasks.js` / `targets.js` under the config repo.

Verification (the skill must not emit unverified source):
1. **Recompile-diff.** `cht compile-app-settings` on the reconstructed source →
   diff the resulting `app_settings.tasks.rules` against the deployed one.
   Structural/AST equivalence (not byte equality — minifier output varies).
2. **Emission equivalence via `cht-conf-test-harness`.** Seed representative
   contacts/reports; assert `getTasks()` / `getTargets()` emit the same tasks/
   targets (ids, due dates with `setNow`, target values) from the reconstructed
   source as from the deployed rules. This is the real proof, mirroring
   mission 04's tier-2 form check.

Hard stops that remain even with this skill:
- `app_settings.contact_summary` (arbitrary ~76KB bundle) — not declaratively
  scaffolded; stays needs-source.
- Legacy (non-declarative) nools rule strings — no surviving scaffold.

So the guard message stays **qualified**: "needs source repo — or reconstruct
via /reconstruct-rules once available", never an unconditional refusal.

## Acceptance criteria
- Skill reconstructs `tasks.js`/`targets.js` from a real `app_settings.json`.
- Recompile-diff + harness emission-equivalence gate the output; failing either
  aborts with a diagnostic rather than emitting source.
- Backed by the seeded corpus in `designs/issue-cht-agent-tasks-targets-memory.md`.
- Documented limits: contact-summary + legacy nools remain hard stops.
