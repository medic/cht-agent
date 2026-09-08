# Demo e2e gaps — findings & options (first live run, 2026-07-13)

Source run: `npm run full tickets/demo-echis-pnc-ticket.md --qa` in the agent
container against the seeded 4.21.1-official test env. Research completed and
HC1 was approved; the development supervisor then failed 3/3 iterations and
reached HC2 with zero generated files. Five issues, ordered by demo impact.

## 1. Dev-phase hard failure: `git rev-parse HEAD` (DEMO BLOCKER)

**Observed.** Every code-gen iteration died on
`fatal: not a git repository … /workspace/cht-conf-project`.

**Root cause.** The claude-code-cli module snapshots the dev target before
letting the CLI touch it — `snapshotChtCore()` at
`src/layers/code-gen/modules/claude-code-cli/workspace.ts:71` captures HEAD and
stashes uncommitted work for rollback, and the post-run verifier
(`index.ts:408-481`) cross-checks the LLM's claimed edits against `git diff`.
Both assume the target is a git repo. The config repo is **deliberately
git-less** (DEMO-STEPS: the working copy was handed over without `.git`; its
`postinstall` even fakes `.git/hooks` for its own lint hooks).

**Options.**
- **(a) Operator unblock — make `../demo-conf` a local git repo** (host-side
  `git init` + one commit). Zero code change, works immediately. The
  DEMO-STEPS "never run git in site-config-test" rule targeted the pristine
  partner copies; `demo-conf` is the neutralized demo copy, the repo stays
  remote-less (nothing to push to), and in-container git has the dummy
  identity + system-level push block. Effort: 3 commands. Risk: low; slight
  hygiene deviation, documented here.
- **(b) Workbench fix — no-git fallback in `workspace.ts`**: when
  `git rev-parse --is-inside-work-tree` fails, snapshot by copying the project
  (minus `node_modules`) to a temp dir, restore-on-rollback, and verify edits
  with a recursive diff (the `diff` package is already a dependency) instead
  of `git diff`. Preserves preview + rollback semantics for git-less partner
  repos generally. Effort: ~half-day incl. tests. Risk: medium (touches the
  rollback safety path — needs careful tests).
- **(c) Both**: (a) now for the demo, (b) filed as the durable fix.

**Recommendation: (c).** For the demo run: (a).

## 2. Code-gen is cht-core-shaped for a cht-conf ticket (DEMO BLOCKER once #1 clears)

**Observed.** "Gathering code context from cht-core…", cht-core workspace
prompts, and no config-aware guidance — despite the A1 routing banner
correctly pointing the dev target at `/workspace/cht-conf-project`.

**Root cause.** Three layers deep:
- `prompts.ts:17-19,79-81` hardcode "You are inside the cht-core workspace" —
  the CLI gets no XLSForm/`relevant`-semantics framing for `layer: cht-conf`.
- `code-generation-agent.ts` gathers context via cht-core domain→component
  maps (`gatherCodeContext`, `readFromChtCore`) — for `forms-and-reports` in a
  config repo it maps to nothing useful (see "No component mapping found"
  in the run log).
- **The XLSX trap (subtle, will bite at HC3):** the QA `applyConfig`
  `app-forms` bucket runs `convert-app-forms` *then* `upload-app-forms`
  (`cht-conf-runner.ts:41`). Convert regenerates `forms/app/*.xml` from the
  `.xlsx` source — so an **XML-only fix gets clobbered before upload** and
  GREEN can never pass. The true source is the `.xlsx` binary, which the CLI's
  text tools can't edit.

**Options.** (Expanded 2026-07-13 after researching medic/cht-ai-tools — main
+ the unmerged PR #4 `feat/add-cht-form-builder` — and the prior sessions'
memories in the `../cht-agent` project. Verdict: **cht-ai-tools cannot do the
surgical fix today.** Main ships no form-authoring surface at all; the PR #4
form-builder GENERATES new XLSForms from scratch (openpyxl via `uv run`,
PyPI at exec time, LLM-derived `relevant`) and never edits an existing
`.xlsx` in place — and running it would require Bash re-enabled in code-gen,
the posture (b) below already rejects. Mission-04 §A4 had already drawn this
boundary: cht-ai-tools pieces are additive (validate hook, `--compare`
narrative, `/deploy` UI); the surgical fix is owned by our code-gen layer.
Also settled in prior-session memory: the `.xlsx` is unrecoverable from a
live deployment — only converted XML reaches CouchDB — so xlsx-source fixing
only applies to full-source handovers like this engagement's repo.)

- **(a) Demo stopgap — xml-only apply mode** *(NOT yet implemented — the
  bucket in `cht-conf-runner.ts` still hardcodes convert+upload)*:
  layer-aware prompt variant ("you are in a CHT config project; the fix is
  the `relevant` expression of <question> in `forms/app/<form>.xml`"), plus
  an `app-forms-xml-only` bucket that runs `upload-app-forms` *without*
  `convert-app-forms`. Operator report says "apply the same change to the
  XLSForm source upstream". Effort: small. Risk: low; documented xlsx/xml
  divergence on the throwaway env only.
- **(b) Bash-on xlsx editing in code-gen** (python+openpyxl inside the CLI
  sandbox): REJECTED — weakens the sandbox posture; same reason installing
  the PR #4 form-builder into the container is rejected (needs Bash + `uv` +
  PyPI at exec, and still couldn't do surgical edits).
- **(c) DURABLE — first-party Node xlsx surgical editor as an ORCHESTRATOR
  step** *(**IMPLEMENTED — Mission 05, 2026-07-13**;
  `docs/handoffs/missions/05-xlsform-orchestrator-editor-report.md`)*: the
  code-gen CLI stays Read/Write/Edit-only and emits the fix as a structured
  descriptor (`.cht-agent/xlsform-fix.json`: form, edits, and an `expect`
  oracle); a deterministic supervisor node applies it to a sandbox copy of the
  `.xlsx` survey row in-process (**exceljs**, now a real dependency), converts
  offline, and asserts the regenerated bind before staging both artifacts for
  HC2. On approval the corrected `.xlsx` + `.xml` are written to the mount, so
  the *real, unchanged* `app-forms` bucket (convert+upload) no longer clobbers
  anything — the instance and the source stay in lockstep, and the corrected
  `.xlsx` is a partner handback artifact. The exceljs round-trip fidelity risk
  was the P1 decision gate and **passed** against the planted fixture (only the
  target cell changes; only the one bind changes on convert), so the documented
  Python/openpyxl fallback was **not** needed.
- **(d) cht-ai-tools additive garnish** (unchanged from mission-04 §A4):
  `--compare` for design-vs-form narrative in the report, `/deploy` UI as the
  interactive alternative. Not fix engines.

**Recommendation: (c) SHIPPED.** Option (c) — the durable path that meets the
"fix the real source, fully automated" goal — was specified as **Mission 05**
(`docs/handoffs/missions/05-xlsform-orchestrator-editor-mission.md`, with its
verified seam map + risk register in
`docs/handoffs/xlsform-orchestrator-editor-handoff.md`) and **implemented**
2026-07-13 on `feat/mission-05-xlsform-orchestrator`
(`docs/handoffs/missions/05-xlsform-orchestrator-editor-report.md`). The demo
stopgap (a) (an xml-only `app-forms-xml-only` bucket) was therefore **not**
built — (c) makes the unchanged convert+upload bucket legitimate, which is
strictly better than diverging the xlsx/xml. Full research record: the
xlsx-pipeline synthesis of 2026-07-13 (memories + cht-ai-tools main + PR #4).

## 3. No reproduce-before-develop for cht-conf bugs (workflow order)

**Observed.** Research → HC1 → straight into code-gen. The symptom is only
ever verified in the QA phase (reproduce/RED runs before HC3 apply — that
gate exists and is correct), but nothing confirms the bug is live before
development spends iterations on it.

**Options.**
- **(a) Pre-dev reproduce node** (when `--qa` and `layer: cht-conf`): after
  HC1, `discoverConfig` + fetch the deployed form XML and assert the ticket's
  symptom is present (the existing `verifyArtifact`/`fetchFormXml` building
  blocks in `test-environment-agent.ts` cover this; the check inverts to
  "expected-buggy"). Abort with "symptom not present on the target env" before
  any code-gen. Effort: ~a day incl. wiring + HC messaging. Risk: low-medium.
- **(b) Runbook-level manual pre-check** — a one-liner `docker exec … node -e`
  fetch-and-grep of the deployed form before step 5. Effort: minutes.
  Risk: none (human step).
- **(c) Status quo** — rely on QA's RED gate (red still precedes any apply).

**Recommendation: (b) for the demo, (a) as the durable fix** — it matches the
CHT "failing test first" doctrine the runbook already cites.

## 4. Doc search returned no cht-conf sources

**Observed.** All 22 kapa-ai references were cht-core `config/default` /
cht-interoperability analogs of `pregnancy_home_visit` — not the partner form,
not cht-conf tooling docs. (Caveat: the *suggested approach* it produced was
nonetheless exactly right — find the question, fix its `relevant` to exclude
miscarriage — so this degraded gracefully rather than misled.)

**Root cause.** The doc-search agent queries the kapa MCP corpus (CHT docs +
public medic repos). There is no cht-conf/partner-config corpus; the
`cht-conf-wiki` corpus the runbook mentions is an agent-memory target that
does not exist yet (context analysis found 0/0/0 for the same reason — the
seeded memory is cht-core issues).

**Options.**
- **(a) Layer-aware query shaping**: when `layer: cht-conf`, append
  XLSForm/cht-conf terms and the artifact name to the kapa query; cheap,
  incremental gain. Effort: small.
- **(b) cht-conf corpus via the seeder pipeline** (issues/PRs/wiki of
  medic/cht-conf) — **explicitly deferred by Hareet; later goal.**
- **(c) Accept for demo** — research already lands on the correct approach.

**Recommendation: (c) now, (a) opportunistically, (b) later as planned.**

## 5. Local-config alignment inference (deferred by design)

The ask: when `CHT_CONF_PATH` is set, research should read the actual local
artifacts (form XML/XLSX, `app_settings`) and make one inference call
reconciling ticket ↔ local config ↔ docs. Today only the canonical-diff
utility and OpenDeepWiki insights touch the config; nothing reads the target
form into research context. Design sketch: a `local-config-context` node in
the research supervisor, gated on `layer: cht-conf`, feeding code-gen the
actual `relevant` expression it must change (which also de-risks #2).
**Parked per Hareet** until the seeder-on-cht-conf goal; revisit after the
demo.

## Cosmetics noticed in the same run (non-blocking)

- Banner says `Initializing Supervisors with model: claude-opus-4-6` — the
  display default, not what runs; the CLI provider uses `ANTHROPIC_MODEL`
  (`claude-opus-4-8`). Worth aligning the banner with the effective model.
- Context-analysis logs "CHT_CORE_PATH not set?" when it means "no component
  mapping for this domain/layer" — misleading for cht-conf runs.
- Canonical diff reported `baseline not found at
  /workspace/cht-core/config/standard` — expected for a real bug (no
  baseline), but verify the `CHT_CORE_PATH` mount actually contains a
  checkout; an empty mount would also produce this.

## Immediate demo-unblock sequence (operator)

```bash
# 1. Make the config working copy a local, remote-less git repo (HOST side)
cd $CHT_CONF_PATH
git init
git add -A
git commit -m "demo baseline: neutralized live config (buggy PNC form)"
# no remote is configured — nothing can be pushed anywhere

# 2. Re-run the loop (container; ticket already copied)
docker exec -it cht-agent npm run full tickets/demo-echis-pnc-ticket.md --qa
```

Then expect HC2 to show a real diff on
`forms/app/postnatal_care_service.xml`. Watch for the #2 xlsx trap at HC3: if
the QA apply runs `convert-app-forms`, the fix is clobbered before upload —
pause there and apply the xml-only variant (or upload manually with
`upload-app-forms` only) until the workbench fix lands.

## Suggested order of workbench fixes after the demo

1. #1(b) no-git snapshot fallback (unblocks all git-less partner repos)
2. #2(a) layer-aware prompts + xml-only apply bucket
3. #3(a) pre-dev reproduce gate for cht-conf + `--qa`
4. #4(a) layer-aware doc queries; cosmetics batch
5. #5 local-config context node (with the cht-conf seeder corpus)
