# feat(#66): Test Environment Layer — provisioning, config discovery, test data, config apply

Closes #66. Enables #64 (QA Supervisor pipeline invocation).

## 1. What this PR delivers

The **Test Environment Layer** for the cht-agent QA Supervisor: a deterministic
(no-LLM) orchestrator that stands up a live CHT instance, applies a cht-conf
config, reads the deployed config back, seeds conforming test data, and resets
between runs — all **human-gated for Docker** (the agent runs no Docker; a human
brings the environment up/down) and **credential-safe** (creds ride the cht-conf
`--url` arg / the HTTP `Authorization` header, never a log line).

It is the layer that drove the closed-loop demo's QA phase live; this PR ships it
at **workbench parity minus the cht-conf-extension pieces** (which land in their
own PR — see the deferred map in §7). The pipeline/LangGraph wiring that *invokes*
this layer arrives with #64; this PR ships the layer + its direct-use surface.

### Real paths implemented
- **`provision`** — human-gated bring-up (`scripts/test-env-up.sh <cht-core>`) +
  a bounded, backing-off readiness poll of `/api/v2/monitoring`.
- **`applyConfig`** — one `cht` invocation per upload bucket (app-settings /
  app-forms / contact-forms / resources), status parsed from stdout
  (`uploaded` / `skipped` / `failed`), buckets independent so one failure does
  not abort the rest.
- **`discoverConfig`** — `GET /api/v1/settings` + the `form:` `_all_docs` range,
  parsed into `DiscoveredConfig` (contact types, roles, permissions, transitions,
  forms, and `formVersions` — each installed form's rev, the change-detection
  hash for the apply → verify loop).
- **`prepareTestData`** — cht-conf `csv-to-docs` + `upload-docs` seed the
  instance, then `create-users` when `users.csv` exists; seeded doc ids are
  tracked per environment.
- **`reset('couchdb')`** — the one reset the agent performs itself over the
  CouchDB HTTP API: wipe the tracked docs at their **current** revs, then reseed
  pristine copies (reseed source pre-flighted before the destructive wipe, so a
  vanished data project fails closed). `restart`/`full` stay human-gated.
- **`teardown`** — prints the human `docker compose down -v` gate and clears the
  per-env tracking.

## 2. Implementation map

| File | Role |
|---|---|
| `src/utils/cht-conf-runner.ts` | `child_process` isolation for cht-conf: `runChtConf` (generic, ordered verb list) + `runBucket` (config-upload buckets), `classifyChtConfOutput`, `minimalEnv` (secret-free child env), `resolveChtConfBin` (`CHT_CONF_BIN` seam). |
| `src/utils/cht-api.ts` | `fetch` isolation for CHT/CouchDB: `fetchSettings`, `fetchFormRevs`, `fetchDocRevs`, `bulkDocs` (bounded, authed, cred-safe). |
| `src/utils/test-data.ts` | fs isolation + cht-conf stdout parsers: `readSeededDocs`, `cleanSeededDocs`, `classifySeededDocs`, `parseUploadDocsSummary`, `countCreatedUsers`, `hasUsersCsv`. |
| `src/agents/test-environment-agent.ts` | The orchestrator (mock + real paths). Docker-free; delegates every side effect to the isolation modules above. |
| `src/agents/test-environment-agent.mock-data.ts` | Deterministic mock fixtures (CI-safe, no instance). |
| `src/types/index.ts` | Layer types (Config/Discovery/Provision/Runner/apply sets; `app-settings-only`; `instanceUrl` REQUIRED). |
| `src/utils/cht-readiness.ts` | Readiness poll (Phase 1). |
| `scripts/test-env-up.sh`, `scripts/test-env-down.sh`, `docker/cht-agent-net.override.yml` | Human-gated bring-up/teardown + compose override (Phase 1). |

## 3. Test surface

`build` + `test` + `lint` are green after **every** commit (Node 22). Full suite:
**1104 passing**. Real-path specs mock `fetch` / `child_process` / `fs`, so the
suite is green with **no instance and no Docker**.

| Layer spec | `it`s |
|---|---|
| `test/utils/cht-conf-runner.spec.ts` | 26 |
| `test/utils/cht-api.spec.ts` | 13 |
| `test/utils/test-data.spec.ts` | 19 |
| `test/agents/test-environment-agent.spec.ts` | 64 |
| `test/utils/cht-readiness.spec.ts` | 4 |
| **Layer total** | **126** |

## 4. Environment seams

- **`CHT_CONF_BIN`** — override the cht-conf binary (default `cht`); lets the
  agent run a deployment-pinned cht-conf and lets specs stub a fake script.
- **`ProvisionOptions.url` / `ProvisionOptions.auth`** (and the on-network
  defaults `https://nginx`, `medic`/`password`) — the instance target + creds
  the handle carries; every downstream call reads `handle.url`/`handle.auth`.
- **`useMockDocker`** (constructor) — mock mode is the default; `false` selects
  the real paths. This is what keeps CI Docker-free.
- **`scripts/test-env-up.sh <cht-core>`** — the human-gated bring-up seam
  (`COUCHDB_USER`/`COUCHDB_PASSWORD` are the compose creds seam it already uses).

> **Scope note on `provision` env resolution.** `provision()` is kept at its
> Phase-1 shape (already on the branch). The workbench lineage later grew
> `provision` an env-driven resolver (`CHT_URL` fallback, `COUCHDB_USER/PASSWORD`
> auth, embedded-cred stripping, `decodeUserinfo`); that evolution is **not** in
> this PR because `provision` is not in this PR's port scope (only
> `discoverConfig`/`prepareTestData`/`reset('couchdb')` were ported). Callers set
> the target via `ProvisionOptions.url`/`auth` today. Porting the `provision`
> env-seam resolver is a clean, self-contained follow-up if wanted.

## 5. Standalone guarantee + independent demo recipe

Zero imports from workflow / cht-conf-extension code. Real-path specs mock
`fetch`/`child_process` → suite green with no instance, no Docker.

Independent cht-core demo (real mode, `new TestEnvironmentAgent({ useMockDocker: false })`):

```
scripts/test-env-up.sh <cht-core-checkout>     # human brings the env up
provision({ chtCorePath: '<cht-core>' })       # waits until healthy
discoverConfig(handle)                          # reads /api/v1/settings + form revs
applyConfig(handle, 'config/default')          # cht-conf upload buckets
prepareTestData(handle, config, { dataPath })  # csv-to-docs → upload-docs → create-users
reset(handle, 'couchdb')                        # wipe + reseed the tracked docs
teardown(handle)                                # prints the human down gate
```

Mock mode (`useMockDocker` default) mirrors the same call sequence CI-safe.

## 6. Excision proof (no cht-conf-extension code)

```
$ grep -rn "fetchFormXml\|verifyArtifact\|fetchDeployedFormXml\|runOfflineConvert\
\|createConvertSandbox\|skipValidate\|xform-inspect\|config-type\|cht-conf-tier2\
\|qa-workflow\|XlsformBindDiff" src/ test/
$ echo $?
1        # no matches → empty → clean
```

## 7. Deferred cht-conf-extension map (verbatim boundary)

**Ported with excisions** (the stripped items are the cht-conf extension):

| Workbench source | Stripped in this PR |
|---|---|
| `src/agents/test-environment-agent.ts` | `verifyArtifact`, `fetchDeployedFormXml`, and their imports (`fetchFormXml`, `verifyFormBinds`) |
| `src/utils/cht-api.ts` | `fetchFormXml` |
| `src/utils/cht-conf-runner.ts` | offline-convert block (`runOfflineConvert`, `createConvertSandbox`, `CONVERT_VERBS`, `SANDBOX_EXCLUDES`, `OfflineConvertOptions`), `skipValidate`; `instanceUrl` restored to REQUIRED |
| `src/types/index.ts` | `VerifyArtifact*`, `QaInput`/`QaResult`/`QaTier2Result`, `XlsformBindDiff`, offline-convert optionals |
| spec files | describes for the stripped exports (`fetchFormXml`, `verifyArtifact`, `runOfflineConvert`, `createConvertSandbox`, F2/F5 xform describes) |

**Not ported at all** (whole files → cht-conf-extension PR):
`xform-inspect.ts`, `config-type.ts`, `cht-conf-tier2.ts`, `cht-conf-test-spec.ts`,
`qa-workflow.ts`, `orchestrator.ts` wiring, CLI flags.

## 8. Per-function parity proof (identical modulo the excisions)

Diffed against the workbench port source
(`~/…/cht-agent-workbench`, demo-final).

- **`src/utils/test-data.ts`** — **byte-identical** to the workbench (`diff` empty).
- **`src/utils/cht-api.ts`** — differs **only** by the removed `fetchFormXml`
  export (function + doc comment). Every other export (`request`, `basicAuth`,
  `fetchSettings`, `fetchFormRevs`, `fetchDocRevs`, `bulkDocs`, the row types,
  `FORM_RANGE_QUERY`) is identical.
- **`src/utils/cht-conf-runner.ts`** — differs **only** by: the removed
  `fs`/`os`/`path` imports and the whole offline-convert block
  (`CONVERT_VERBS`, `SANDBOX_EXCLUDES`, `OfflineConvertOptions`,
  `createConvertSandbox`, `runOfflineConvert`); the removed `skipValidate` line in
  `buildExecArgs`; and `--url` made unconditional (`instanceUrl` REQUIRED). Every
  kept export (`CONFIG_ACTION_COMMANDS` incl. `app-settings-only`,
  `AUTONOMOUS_FLAGS`, `minimalEnv`, `resolveChtConfBin`, `buildChtConfArgs`,
  `classifyChtConfOutput`, `runChtConf`, `runBucket`) is identical.
- **`src/agents/test-environment-agent.ts`** — every ported method
  (`applyConfig`, `discoverConfig`, `prepareTestData`, `reset`,
  `resetCouchdbTier`, `teardown`) and every parse helper (`parseContactTypes`,
  `parseRoles`, `parsePermissions`, `parseTransitions`, `parseDiscoveredConfig`,
  `credentialedUrl`, `toApplyResult`, `describeRunFailure`, `runSucceeded`) is
  identical to the workbench. Excised: `verifyArtifact`, `fetchDeployedFormXml`
  and their imports. **One deliberate divergence:** `provision()` is kept at the
  branch's Phase-1 shape rather than the workbench's later env-seam resolver (see
  §4 scope note); its `decodeUserinfo` helper and `CHT_URL`/`COUCHDB_*` logic are
  therefore not present.
- **Types / mock fixtures** — the layer type set + mock fixtures match the
  workbench minus the `VerifyArtifact*`/`Qa*`/`XlsformBindDiff`/offline-convert
  members.

## 9. Sonar sweep

Local static sweep against `.sonarcloud.properties` (the sandbox has no
`sonar-scanner` and no SonarCloud network, so this is the local first pass; the
authoritative scan runs on the PR CI). The four house rules are **zero** on the
layer files:

- **No `any` in `src/`** — `eslint --max-warnings 0` on the layer src is clean
  (the `no-explicit-any` warning count is 0).
- **≥1 assertion per test** — no assertion-less `it()` in the ported specs.
- **No nested template literals** — none.
- **`_`-prefixed unused params** — eslint-enforced, clean.

**Cognitive complexity:** the ported functions are byte-identical to the
sonar-sanctioned workbench parity source, so this PR introduces no new
complexity relative to that baseline. `prepareTestData` is the longest method
and may be flagged by the S3776 gate; it is left at parity here to preserve the
per-function parity guarantee (§8) and avoid restructuring code that cannot be
exercised against a live instance in-container. A behavior-preserving helper
extraction is an available follow-up if the PR's SonarCloud run flags it.

## 10. Commits (on `66-test-environment-layer-implementation`, rebased onto `origin/main` @ `fdf4af2`)

- `feat(#66): phase-2 parity uplift — cht-conf runner to workbench parity minus excisions`
- `feat(#66): phase 3 — discoverConfig + cht-api, prepareTestData + test-data, couchdb-tier reset`
- `test(#66): layer spec suite ported (agent real paths, cht-api, test-data)`
- `docs(#66): handoff status, PR description, deferred cht-conf-extension map`

(Phases 1–2 groundwork — provision/readiness/scripts/apply shape — is the branch's
pre-existing history, replayed unchanged by the rebase.)

All work stays on the local branch; the operator owns the push and `gh pr create`.
