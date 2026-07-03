# Reconstructing a partner site to reproduce a config bug

When a partner reports a bug that lives in their **cht-conf configuration** (not in
cht-core itself), the fastest way to work it is to rebuild a throwaway copy of their
site against a disposable CHT instance and reproduce the symptom there. This page is
(1) a checklist of the artifacts to collect, and (2) the exact `cht` (cht-conf)
commands to load them onto the test instance.

Pair this with the ticket template at `tickets/demo-cht-conf-site.md`
(`layer: cht-conf`), which routes the reproduced bug straight to the config layer.

> The agent never runs Docker. cht-conf talks to the already-running instance over
> HTTP, so everything below is a plain `cht ...` invocation.

Command details were verified against the cht-conf **6.5.0** source that ships in this
workbench (`npm root -g` -> `cht-conf/src/...`). File:line citations are inline so you
can re-check them if the pinned version moves.

---

## Part 1 - Artifact checklist

Collect the smallest set of **scrubbed** artifacts that still reproduces the reported
behaviour. Star (*) items are always required; the rest depend on the bug.

### 1. `app_settings` (*)

The settings blob drives almost every deployment-level behaviour (contact hierarchy,
permissions, contact-summary, tasks/targets rules, purge, messaging). Two shapes exist
in the wild - capture whichever the partner uses:

- **Compiled, committed:** a single `app_settings.json` at the config-repo root. This
  is what `upload-app-settings` uploads verbatim (Part 2a).
- **Modular source:** an `app_settings/` folder holding `base_settings.json` (plus
  optional `forms.json`, `schedules.json`, `assetlinks.json`). This is the *source*;
  `compile-app-settings` merges it into `app_settings.json`.

If you can only get one, prefer the compiled `app_settings.json` - it reproduces the
exact running state without needing the partner's full source tree.

### 2. Form XML / xlsx - when the bug is form-level

- `forms/app/<name>.xlsx` (the editable source) **and** the generated
  `forms/app/<name>.xml` if available.
- `forms/app/<name>.properties.json` (title, context, icon) and any
  `forms/app/<name>-media/` directory, if present.
- Contact forms live under `forms/contact/` - grab those if the bug is in a
  place/person edit form.

Keep the xlsx: `convert-app-forms` regenerates the XML from it, so the xlsx alone is
enough to rebuild the running form.

### 3. cht-core version (*)

Behaviour differs across cht-core releases (e.g. declarative-tasks nools boilerplate is
only injected below 4.2, several settings keys are version-gated). Record:

- The partner's **cht-core** version (from `/api/v2/monitoring` `version.app`, or the
  deployment ref) and stand the reproduction instance up on the **same minor** where
  feasible.
- The **cht-conf** version they built/uploaded with (`cht --version`) - put this in the
  ticket's `chtConfVersion` field.

### 4. Scrubbed contact + report sample

A minimal hierarchy that exercises the bug, PII removed:

- One branch of the contact tree: e.g. `district_hospital` -> `health_center` ->
  `clinic` -> `person`, enough to satisfy the config's hierarchy rules.
- A handful of `data_record` (report) docs of the form types the bug touches.
- **Scrub:** replace real names, phone numbers, national IDs, and free-text notes with
  synthetic values; keep `_id`, `type`, `contact_type`, `parent` linkage, form codes,
  and the specific fields the bug depends on. Doc shape and linkage are what reproduce
  the bug.

Ship these as cht-conf seed CSVs (Part 2c) or as ready-made `*.doc.json` files.

### 5. User / role sample

Permissions and role-scoped visibility are a common source of "works for me" config
bugs. Capture:

- The `roles` for the affected user type and the matching `permissions` / `roles`
  config in the settings.
- One representative user row (username, role, place, contact) - no real credentials;
  the reconstruction sets a throwaway password.

Ship these as a `users.csv` (Part 2d).

### Expected project (config-repo) layout

`cht` resolves everything relative to `--source` (default `.`). A reconstructed site
should follow the canonical cht-conf layout
(`cht-conf/src/lib/project-paths.js:4-15`, `fn/initialise-project-layout.js:7-46`):

```
site-config/
  .eslintrc                       # REQUIRED by compile-app-settings (see 2a note)
  app_settings.json               # compiled settings (upload-app-settings reads THIS file)
  app_settings/
    base_settings.json            # modular source (only needed if you recompile)
    forms.json  schedules.json
  contact-summary.templated.js    # compiled INTO app_settings.json
  tasks.js  targets.js            # compiled INTO app_settings.json
  forms/
    app/       <name>.xlsx  <name>.xml  [<name>.properties.json]  [<name>-media/]
    contact/
  resources.json   resources/
  translations/
  csv/                            # csv-to-docs INPUT  (contact*/person*/place*/report.*/users*.csv)
  json_docs/                      # csv-to-docs OUTPUT + upload-docs INPUT (*.doc.json)
  users.csv                       # create-users INPUT (project root)
```

`cht --source=. initialise-project-layout` scaffolds exactly this tree if you start
empty (`fn/initialise-project-layout.js`; `requiresInstance:false`, so no `--url`).

---

## Part 2 - The exact cht-conf upload path

### Instance convention: https://nginx on cht-agent-net

This repo runs cht-conf against a **containerised CHT instance on the shared
`cht-agent-net` Docker network**, reachable at **`https://nginx`** with a self-signed
cert. A human brings the stack up (the agent never runs Docker) by layering
`docker/cht-agent-net.override.yml` onto cht-core's compose files
(`docker/cht-agent-net.override.yml:9-17`):

```bash
# HUMAN-run, once, to attach nginx to cht-agent-net:
docker compose -f cht-couchdb.yml -f cht-core.yml -f cht-agent-net.override.yml up -d
```

cht-conf then talks to it over HTTP with credentials embedded in `--url`. `getApiUrl`
requires **exactly one** of `--local` / `--instance` / `--url` / `--archive`, parses
`--url` with `new URL(...)`, and appends `medic` to the path for you - so pass the base
URL only, not `/medic` (`cht-conf/src/lib/get-api-url.js:8-13,38-42`):

```
--url=https://<admin-user>:<password>@nginx
--accept-self-signed-certs          # self-signed cert -> sets NODE_TLS_REJECT_UNAUTHORIZED=0 (main.js:150-152)
```

The repo default base URL is `https://nginx` (`.env.example:59-60`; self-signed cert
noted at `.env.example:69`).

### Autonomous flags

Without these, cht-conf blocks on stdin prompts (git status, overwrite confirmation,
the `upload-docs` / `create-users` "are you sure" prompt). This repo's runner applies
exactly this set (`src/utils/cht-conf-runner.ts:48-56`); use the same by hand. `--force`
answers every confirmation yes (`lib/user-prompt.js` `keyInYN` returns `true` when
`environment.force`):

```
--force --skip-git-check --skip-version-check --skip-dependency-check \
  --skip-translation-check --accept-self-signed-certs --verbose
```

In the examples below, `$URL` = `https://<admin-user>:<password>@nginx` and `$FLAGS` =
the autonomous flag set above. Actions are positional and run **in the order listed**.

### The `--` requirement (why extra args need a separator)

cht-conf's `main.js` parses argv with `minimist(..., { '--': true })`. Every bare
positional lands in `cmdArgs._` and is treated as an **action name**; `buildActions`
throws `Unsupported action(s): ...` for anything not in the supported-actions list
(`cht-conf/src/lib/main.js:81-84,207-213`). Only args after a literal `--` reach
`cmdArgs['--']`, which becomes `environment.extraArgs` (`main.js:154-157`) - the channel
the single-form filter (`lib/args-form-filter.js`) and `upload-docs --docDirectoryPath`
(`fn/upload-docs.js:20-22`) read. So a form filter or a `--docDirectoryPath` value
**must** follow `--`, exactly as the repo runner emits `['--', ...extraArgs]`
(`src/utils/cht-conf-runner.ts:84-97`):

```bash
# WRONG - pnc_followup parsed as an action -> "Unsupported action(s): pnc_followup"
cht --url=$URL --source=. convert-app-forms upload-app-forms pnc_followup
# RIGHT - the form filter rides after --
cht --url=$URL --source=. convert-app-forms upload-app-forms -- pnc_followup
```

### 2a. app-settings - when `app_settings.json` is ALREADY compiled

`upload-app-settings` reads `<project>/app_settings.json` from disk and PUTs it to the
instance - it does **not** compile (`fn/upload-app-settings.js:11-12,55`; path is
`app_settings.json` per `lib/project-paths.js:5`). When you already hold the compiled
file, upload it directly and skip compilation:

```bash
cht --url=$URL --source=. $FLAGS upload-app-settings
```

> **Do NOT run `compile-app-settings` on a pre-compiled-only repo.** Compilation reads
> `app_settings/base_settings.json` (or, failing that, `app_settings.json`),
> **re-derives** `contact_summary` / `tasks` / `targets` / `purge` from the source
> files, and rewrites `app_settings.json`
> (`fn/compile-app-settings.js:45,65-66,87-153`). It also **requires a `.eslintrc`** in
> the project and throws if neither `base_settings.json` nor `app_settings.json` exists
> (`compile-app-settings.js:77-86`). If all you have is the compiled artifact,
> recompiling would clobber those keys - just `upload-app-settings`.

If instead you were handed the **modular source** (`base_settings.json` + `.eslintrc`,
and/or edited `contact-summary.templated.js` / `tasks.js` / `targets.js`), compile
first (no instance needed - `compile-app-settings` is `requiresInstance:false`,
`compile-app-settings.js:249`), then upload:

```bash
cht            --source=. $FLAGS compile-app-settings     # writes ./app_settings.json
cht --url=$URL --source=. $FLAGS upload-app-settings
```

### 2b. Forms - when the bug is form-level

`convert-app-forms` turns each `forms/app/*.xlsx` into Enketo XML (no instance needed -
`fn/convert-app-forms.js:6-15`, `requiresInstance:false`); `upload-app-forms` uploads
the `forms/app/*.xml` (`fn/upload-app-forms.js`; `APP_FORMS_PATH = forms/app`,
`requiresInstance:true`). Naming a `upload-*-forms` action auto-inserts the matching
`validate-*-forms` before it unless you pass `--skip-validate` (`main.js:231-241`):

```bash
cht --url=$URL --source=. $FLAGS convert-app-forms upload-app-forms
```

Target a **single form** by base filename (no extension) after `--`:

```bash
cht --url=$URL --source=. $FLAGS convert-app-forms upload-app-forms -- pnc_followup
```

Gotcha: a form's XML **internal id** (with `-` mapped to `:`) must equal its filename,
or upload throws `... does not match the id in the xml ...`
(`lib/upload-forms.js:18,77-80`). Contact-form bugs use the same pattern against
`forms/contact/`: `convert-contact-forms upload-contact-forms`
(`project-paths.js:7`).

### 2c. Seed data (contacts + reports)

Put the scrubbed CSVs under `<project>/csv/`. `csv-to-docs` converts them into
`<project>/json_docs/<_id>.doc.json` (no instance needed - `fn/csv-to-docs.js:23,29,36`,
`requiresInstance:false`); the file **prefix before the first dot** picks the doc type
(`contact*`, `person*`, `place*`, `report.<form>.csv`, `users*` -
`csv-to-docs.js:63-70`). `upload-docs` then bulk-writes every `json_docs/*.doc.json` to
the instance (`fn/upload-docs.js:16,22,28`; `requiresInstance:true`; needs `--force`
because it prompts before writing):

```bash
cht            --source=. $FLAGS csv-to-docs          # csv/ -> json_docs/*.doc.json (local only)
cht --url=$URL --source=. $FLAGS upload-docs          # json_docs/*.doc.json -> instance
```

To upload docs from a non-default directory, pass it after `--`:
`... upload-docs -- --docDirectoryPath=some_dir` (`upload-docs.js:20-22`).

### 2d. Users / roles

`create-users` reads `<project>/users.csv` (project **root**, not `csv/`) and POSTs each
row to the instance (`fn/create-users.js:63,94`; `requiresInstance:true`; `--force`
skips the replication-size confirmation). The `roles` column is **colon-separated**, and
`contact.*` / `place.*` columns are nested onto the user (`create-users.js:22-30`):

```bash
cht --url=$URL --source=. $FLAGS create-users
```

Example `users.csv`:

```csv
username,password,roles,place,contact.name
demo_chw,Secret_123,chw:district_admin,<place_id_or_place.*_cols>,Demo CHW
```

### 2e. Full reconstruction in one invocation

cht-conf runs the named actions in sequence, so the whole site can be rebuilt in one
call. Order matters - settings and forms before the docs/users that depend on them.
**Only use `compile-app-settings` here if you have the full source tree + `.eslintrc`
(see 2a);** for a pre-compiled artifact drop it and keep `upload-app-settings` alone:

```bash
cht --url=$URL --source=. $FLAGS \
  compile-app-settings upload-app-settings \
  convert-app-forms upload-app-forms \
  csv-to-docs upload-docs \
  create-users
```

---

## Part 3 - Doing it the way the agent does it

`src/utils/cht-conf-runner.ts` wraps the same verbs into "buckets"
(`CONFIG_ACTION_COMMANDS`, `cht-conf-runner.ts:35-40`):

| bucket          | verbs it runs (in order)                                             |
| --------------- | ------------------------------------------------------------------- |
| `app-settings`  | `compile-app-settings` -> `upload-app-settings`                     |
| `app-forms`     | `convert-app-forms` -> `upload-app-forms`                           |
| `contact-forms` | `convert-contact-forms` -> `upload-contact-forms`                   |
| `resources`     | `upload-resources` -> `upload-branding` -> `upload-custom-translations` |

The runner always applies the autonomous flags above and passes a single-form filter
after `--`. **Caveat for a demo with a pre-compiled artifact:** the `app-settings`
bucket runs `compile-app-settings` first, which needs the full source tree + `.eslintrc`
(see 2a). If all you have is a compiled `app_settings.json`, drive `upload-app-settings`
on its own (2a) rather than the bucket. The seed-data verbs (`csv-to-docs`,
`upload-docs`, `create-users`) are driven directly by the runner in the same way.

---

## Part 4 - Reproduce the bug

With settings, forms, seed docs, and users uploaded, log in as the sample user and drive
the workflow named in the ticket. The bug should now reproduce against the reconstructed
state - hand that repro to the fix layer.

---

## Part 5 - Recovering config from a LIVE deployment (no cht-conf source repo)

The checklist above assumes you can collect scrubbed source artifacts. When you have
**admin API access but NOT the partner's cht-conf source repo**, most of the config is
recoverable directly from the running deployment (verified against cht-conf 6.5.0 source
+ CHT docs). One piece is not.

### 5a. Settings - fully recoverable (upload WITHOUT recompiling)

`cht --url=<admin-url> backup-app-settings` writes the deployed settings JSON (it calls
`api().getAppSettings()`) - the compiled, running state. Rename the timestamped output to
`<root>/app_settings.json` and upload it **verbatim**, skipping compilation:

```bash
cht --url=$URL backup-app-settings                    # writes app_settings.<ts>.json
mv app_settings.<ts>.json <root>/app_settings.json
cht --url=$URL --source=<root> $FLAGS upload-app-settings   # NO compile-app-settings
```

**Do NOT `compile-app-settings`** on a deployment-recovered, pre-compiled artifact:
recompilation re-derives `contact_summary`/`tasks`/`targets`/`purge` from a source tree
you do not have and would clobber them. The agent's runner exposes this as the
**`app-settings-only`** bucket (`upload-app-settings` with no compile;
`src/utils/cht-conf-runner.ts` `CONFIG_ACTION_COMMANDS`); keep the compile+upload
`app-settings` bucket only for when a real source tree + `.eslintrc` are present.

### 5b. Form XML - recoverable

`cht --url=<admin-url> backup-all-forms` fetches each form doc with attachments and writes
the deployed `.xml` (+ a `context.json`) per form. Place `<name>.xml` under
`<root>/forms/app/`. You can `upload-app-forms` from `.xml` directly (no `convert` needed).

### 5c. Form XLSX - NOT recoverable (the one gap)

The `.xlsx` source is never uploaded to CouchDB - only `.xml`/`.properties.json` are. To
*edit* a form you either edit the `.xml` XForm directly, or re-author the xlsx. For a small
`relevant` fix, editing the `.xml` bind and re-uploading is the pragmatic path (this is what
the PNC demo's fix asserts on). For a from-scratch real-site run this gap means form editing
is authoring-only until you rebuild the xlsx.

### 5d. Baseline for the canonical diff

Provide a `CANONICAL_CONF` (or a mounted cht-core exposing `config/standard`) with the same
relative paths, so `diffAgainstCanonical` can isolate the drift. For a bug planted in
`config/default` (like the demo), the meaningful baseline is the **unplanted `config/default`
at the matched cht-core version**, not `config/standard`.

### 5e. `.cht-conf-placeholder` must be ABSENT at the mount root

Its presence makes the diff/gate treat the mount as "no real config"
(`resolveDeploymentConfigRoot` / `isPlaceholderRoot`). A recovered site must not carry it.

### CRITICAL - the config-type boundary (what a deployment alone CANNOT yield)

`compile-app-settings` leaves some artifacts as readable JSON in `app_settings.json` and
webpack+terser-**minifies** others into it. The agentic tool triages the ticket's config
type and, when the fix needs source a deployment cannot yield, **fails loudly / requests the
source repo** rather than editing minified JS (`src/utils/config-type.ts`
`classifyConfigType`/`guardConfigFix`, unit-tested):

| Config type | Fixable from deployment alone? | Mechanism |
|---|---|---|
| App forms (`relevant`, calc, choices) | YES | edit `.xml` bind, re-upload (`.xlsx` lost = authoring only) |
| Permissions / roles | YES | plain JSON in `app_settings.json` |
| Contact hierarchy (`contact_types`) | YES (ID changes need doc updates) | plain JSON |
| Schedules / transitions / purge config | YES | plain JSON |
| Translations / resources | YES if backed up | `.properties` / `resources/` |
| Target **definitions** (id/type/goal/icon/translation_key) | YES | readable JSON in `app_settings.tasks.targets.items[]` |
| **Task/target EMISSION LOGIC + nools rules** | **NO - needs source repo** | webpack+terser-minified & variable-mangled into `app_settings.tasks.rules`; no source maps (cht-conf PR #215), no server-side copy |
| **Contact-summary** | **NO - needs source repo** | ~76KB minified webpack bundle in `app_settings.contact_summary` |

Routing rule: JSON-shaped config + form XML -> fixable from the mount; task/target/
contact-summary LOGIC -> require a mounted source repo (`CHT_CONF_PATH` pointing at real
`tasks.js`/`targets.js`/`contact-summary*.js`), else out of scope for a deployment-only
fix. The guard's message is **qualified** ("needs source repo - or reconstruct via the
reconstruct-rules skill once available", not an unconditional refusal): the declarative
task/target *scaffold* survives minification, so a future `reconstruct-rules` skill can
rebuild readable source and verify by recompile-diff + `cht-conf-test-harness` emission
equivalence (designs: `issue-cht-ai-tools-reconstruct-rules-skill.md` +
`issue-cht-agent-tasks-targets-memory.md`). `contact_summary` and legacy nools stay a hard
stop even then. The PNC demo bug is a form `relevant` (the fixable column), so the closed
loop runs; the guard exists so the tool is honest about the bugs it cannot fix without source.

---

## Part 6 - Seeding dummy data (two supported tools)

- **cht-conf `csv-to-docs`** (the path the QA phase uses). `build-seed-data.ts` turns a
  scrubbed contact/report export + the app_settings hierarchy into `<dataPath>/csv/*.csv`
  (+ `users.csv`), then `csv-to-docs` / `upload-docs` / `create-users` load them (Part 2c/2d).
  Run via `npm run demo:build-seed -- --export <docs.json> --app-settings <app_settings.json>
  --users <users.json> --out <dir>`.
- **`medic/test-data-generator`** (standalone repo) - the faster way to fill an instance with
  plausible *volume* when you have no export to scrub. A JS design file (`export default` a
  `DocDesign`) + Faker generates contacts/reports and pushes CouchDB docs **directly** to the
  instance (no CSV): set `COUCH_URL=http://user:pass@host/medic`, then `npm run generate
  <design.js>` (or global `tdg <design.js>`). It does **not** scaffold config (data only), and
  warns against production use.
