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
**1112 passing**. Real-path specs mock `fetch` / `child_process` / `fs`, so the
suite is green with **no instance and no Docker**.

| Layer spec | `it`s |
|---|---|
| `test/utils/cht-conf-runner.spec.ts` | 26 |
| `test/utils/cht-api.spec.ts` | 13 |
| `test/utils/test-data.spec.ts` | 19 |
| `test/agents/test-environment-agent.spec.ts` | 72 |
| `test/utils/cht-readiness.spec.ts` | 4 |
| **Layer total** | **134** |

## 4. Environment seams

- **`CHT_CONF_BIN`** — override the cht-conf binary (default `cht`); lets the
  agent run a deployment-pinned cht-conf and lets specs stub a fake script.
- **`CHT_URL`** — `provision()` falls back to it for the instance URL
  (`options.url` → `CHT_URL` (trimmed; blank ignored) → the on-network default
  `https://nginx`). The resolved `handle.url` is canonicalized (trailing slash
  stripped) and stripped of any embedded basic-auth creds (which survive only as
  an auth fallback, `decodeUserinfo`-decoded, tolerating a raw `%`).
- **`COUCHDB_USER` / `COUCHDB_PASSWORD`** — the instance-auth seam, the same one
  `scripts/test-env-up.sh` uses for the bring-up, so a non-default password needs
  no code change. Auth precedence: `options.auth` → URL-embedded creds →
  `COUCHDB_*` env → the default `medic`/`password`.
- **`ProvisionOptions.url` / `ProvisionOptions.auth`** — the highest-precedence
  target + creds the handle carries; every downstream call reads
  `handle.url`/`handle.auth`.
- **`useMockDocker`** (constructor) — mock mode is the default; `false` selects
  the real paths. This is what keeps CI Docker-free.
- **`scripts/test-env-up.sh <cht-core>`** — the human-gated bring-up seam.

## 5. Standalone guarantee + independent cht-core demo

Zero imports from workflow / cht-conf-extension code. Real-path specs mock
`fetch`/`child_process` → the suite is green with no instance and no Docker.

The demo below exercises the **whole layer in real mode**
(`useMockDocker: false`) against a real dockerized CHT, entirely in Docker:
the CHT stack comes up human-gated on `cht-agent-net`, and the layer runs in
a disposable container on the same network, reaching the instance at the
layer's native `https://nginx` default through the `CHT_URL` seam (§4).

**1. Bring CHT up** (human-gated — the layer itself never runs Docker):

```bash
scripts/test-env-up.sh ~/src/cht-core    # local images + stack, joined to cht-agent-net
```

**2. Start a disposable runner on the same network** (from this repo's root):

```bash
docker run --rm -it --network cht-agent-net \
  -v "$PWD":/app -w /app \
  -v "$HOME/src/cht-core/config/default":/config/default:ro \
  -e CHT_URL=https://nginx \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
  node:22 bash
```

(`NODE_TLS_REJECT_UNAUTHORIZED=0` covers the dev stack's self-signed cert for
the layer's own `fetch`; the cht-conf child already runs with
`--accept-self-signed-certs`.)

**3. Inside the container — build, then drive every layer method:**

```bash
npm ci && npm run build && npm install -g cht-conf
mkdir -p /tmp/demo-data/csv && printf 'name\nDemo CHW\n' > /tmp/demo-data/csv/person.csv

node -e "
const { TestEnvironmentAgent } = require('./dist/agents/test-environment-agent');
(async () => {
  const agent = new TestEnvironmentAgent({ useMockDocker: false });
  const handle = await agent.provision({ chtCorePath: '~/src/cht-core' });
  const config = await agent.discoverConfig(handle);
  console.log('forms deployed:', Object.keys(config.formVersions ?? {}).length);
  const apply = await agent.applyConfig(handle, '/config/default');
  console.log('apply:', apply.actions.map(a => a.action + '=' + a.status).join(', '));
  const seeded = await agent.prepareTestData(handle, config, { dataPath: '/tmp/demo-data' });
  console.log('seeded:', JSON.stringify(seeded));
  await agent.reset(handle, 'couchdb');                 // wipe + reseed the tracked docs
  await agent.teardown(handle);                          // prints the human down-gate
})();"
```

No URL or credentials are passed to any call: `provision()` resolves the
instance from the `CHT_URL` env seam and the default auth, strips/canonicalizes
it onto the handle, and every downstream method reads the handle — the §4
seams doing their job. Expected: the readiness poll returns, discovery reports
the deployed forms, all four upload buckets run, the demo person seeds, the
couchdb-tier reset wipes and reseeds it, and teardown prints the human
down-gate.

Mock mode (`useMockDocker`, the default) mirrors the same call sequence
CI-safe — it is what the spec suite drives. Ticket-driven invocation of this
sequence is #64's scope; this PR ships the layer and the direct-use surface.

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

## 8. Commits (on `66-test-environment-layer-implementation`, rebased onto `origin/main` @ `fdf4af2`)

- `feat(#66): phase-2 parity uplift — cht-conf runner to workbench parity minus excisions`
- `feat(#66): phase 3 — discoverConfig + cht-api, prepareTestData + test-data, couchdb-tier reset`
- `test(#66): layer spec suite ported (agent real paths, cht-api, test-data)`
- `docs(#66): handoff status, PR description, deferred cht-conf-extension map`
- `feat(#66): provision env-seam parity — CHT_URL fallback, cred stripping, COUCHDB_* auth seam`
- `chore(#66): review hygiene — dead doc refs, stale roadmap note, should-style agent spec titles`
- `refactor(#66): sonar round — complexity ≤5 extractions, dedicated matchers, api polish`

(Phases 1–2 groundwork — provision/readiness/scripts/apply shape — is the branch's
pre-existing history, replayed unchanged by the rebase.)
