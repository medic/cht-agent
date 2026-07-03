# Issue draft — `agent-memory/tasks-and-targets/` corpus (opens in `medic/cht-agent`)

> Follow-up from cht-agent mission 04. **Do not build in mission 04.** The
> corpus half of the reconstruct-rules escape hatch; paired with
> `designs/issue-cht-ai-tools-reconstruct-rules-skill.md` (the skill).

## Problem

The `/reconstruct-rules` skill rebuilds readable `tasks.js` / `targets.js` from
the minified `app_settings.tasks.rules`. Re-deriving predicate bodies
(`appliesIf`, `resolvedIf`, `events[].dueDate`, target `emitCustom`) is an
LLM step that is only reliable when grounded on real, known-good task/target
source — otherwise it hallucinates plausible-but-wrong rules. cht-agent already
seeds a domain-first `agent-memory/domains/**` corpus; task/target rule
authoring needs its own grounding corpus.

## Proposal — seed `agent-memory/tasks-and-targets/`

A curated corpus of known-good, declarative task/target rules paired with the
config context that drives them:

- **Canonical rules.** `tasks.js` / `targets.js` from cht-core `config/default`
  and `config/standard` (and other public reference configs), each rule kept
  with its declarative fields + predicate body.
- **Rule ↔ compiled mapping.** For each canonical rule, the corresponding
  `app_settings.tasks.rules` entry after `compile-app-settings`, so the skill
  can learn the surviving-scaffold → source mapping directly.
- **Emission fixtures.** Representative contact/report inputs + the expected
  `getTasks()`/`getTargets()` emissions (`cht-conf-test-harness`), so the
  reconstruct verification step has ground truth.
- **Idioms index.** Common predicate patterns (visit-due schedules, danger-sign
  follow-ups, pregnancy registration windows) as retrieval targets.

Follow the existing corpus conventions: `agent-memory/schema.json` +
`agent-memory/TEMPLATE.md`, distilled via the existing pipeline, retrievable by
the research/code-context layers the same way `agent-memory/domains/**` is.

## Acceptance criteria
- `agent-memory/tasks-and-targets/` populated from ≥2 public reference configs.
- Each entry carries {declarative source, compiled rules entry, emission
  fixture}; schema-validated against `agent-memory/schema.json`.
- Retrievable by the code-context / research layers.
- Consumed by `/reconstruct-rules` as its grounding corpus.
