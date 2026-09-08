#!/usr/bin/env node
/*
 * Neutralize a partner cht-conf project for demo use — deterministic + idempotent.
 *
 * Run this ONCE on a fresh clone of the partner config repo, before it is ever
 * pointed at a test instance. It performs the edits the eCHIS demo setup did by
 * hand (recorded in docs/handoffs/DEMO-STEPS.md "State going in"), then SCANS for
 * whatever identifying material is left and reports it for a human decision.
 *
 * What it CHANGES (all idempotent — re-running is a no-op):
 *   1. Deletes Windows download artefacts (`*:Zone.Identifier`) — 653 of them in
 *      the original handover; they break nothing but pollute every diff.
 *   2. `branding.json`  → title = the demo title (default "CHT Demo").
 *   3. `README.md`      → first H1 = "<title> config".
 *   4. `app_settings/base_settings.json`:
 *        - DELETE `oidc_provider`  → password login (the demo has no SSO IdP)
 *        - `outbound` = {}         → no partner integrations fire from a test env
 *        - `app_url`  = the test instance URL (default https://nginx)
 *      This is also what removes the last `env.*` placeholders, so
 *      `compile-app-settings` runs with no environment file.
 *
 * What it SCRUBS (v2 — deterministic, idempotent; the scan below verifies):
 *   5. `README.md`      → replaced with a neutral stub. The partner ops docs,
 *      deployment targets, GitHub org links and Google Sheets URLs all live
 *      there; dropping the file beats word-salad token replacement.
 *   6. `package.json`   → `name` loses the org token.
 *   7. `resources.json` → org-named icon FILES are renamed on disk and the
 *      references rewritten (keys stay — settings/forms bind to keys, not
 *      filenames).
 *   8. `scripts/**`     → org tokens replaced, non-allowlisted URLs rewritten
 *      to https://example.invalid/removed (allowlist: CHT/medic/xlsform/ODK/
 *      CouchDB/StackOverflow docs — see urlAllowed()).
 *
 * What it only REPORTS (never edits): whatever the scan still finds after the
 *   scrub — e-mail addresses, phone numbers, and any org/URL the rules above
 *   missed. `--strict` exits 1 while anything remains.
 *
 * It NEVER runs git, npm or docker, and never touches `forms/`, `tasks.js`,
 * `targets.js`, the contact-summary, `translations/` or `app_settings/`
 * beyond §4 — the bugs under demo must stay intact and the deployed bytes
 * must match the baseline.
 *
 * Usage:
 *   node demo/setup/neutralize-config.js --config <path-to-config-repo> \
 *        [--title "CHT Demo"] [--app-url https://nginx] [--org "eCHIS,Ministry of Health"] \
 *        [--check] [--strict]
 *
 *   --check   report only; make no edits (use to verify a repo is already clean)
 *   --strict  exit 1 when the scan still finds identifying material
 *   --org     extra comma-separated names to scan for, on top of the defaults
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const CONFIG = path.resolve(flag('config', process.env.CHT_CONF_PATH || '.'));
const TITLE = flag('title', 'CHT Demo');
const APP_URL = flag('app-url', 'https://nginx');
const CHECK_ONLY = has('check');
const STRICT = has('strict');
const EXTRA_ORGS = (flag('org', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!fs.existsSync(path.join(CONFIG, 'app_settings'))) {
  console.error(`✗ ${CONFIG} does not look like a cht-conf project (no app_settings/).`);
  process.exit(2);
}

const changes = [];
const skipped = [];
const note = (done, msg) => (done ? changes : skipped).push(msg);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');

// ---- 1. Windows download artefacts -----------------------------------------
const zoneFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(':Zone.Identifier')) zoneFiles.push(full);
  }
})(CONFIG);
if (zoneFiles.length === 0) {
  note(false, 'Zone.Identifier artefacts: none');
} else if (CHECK_ONLY) {
  note(false, `Zone.Identifier artefacts: ${zoneFiles.length} present (would delete)`);
} else {
  for (const f of zoneFiles) fs.unlinkSync(f);
  note(true, `Deleted ${zoneFiles.length} :Zone.Identifier artefact(s)`);
}

// ---- 2. branding title ------------------------------------------------------
const brandingPath = path.join(CONFIG, 'branding.json');
if (fs.existsSync(brandingPath)) {
  const branding = readJson(brandingPath);
  if (branding.title === TITLE) {
    note(false, `branding.json title already "${TITLE}"`);
  } else if (CHECK_ONLY) {
    note(false, `branding.json title is "${branding.title}" (would set "${TITLE}")`);
  } else {
    const was = branding.title;
    branding.title = TITLE;
    writeJson(brandingPath, branding);
    note(true, `branding.json title "${was}" → "${TITLE}"`);
  }
  // The logo/favicon files stay on disk: the demo deliberately never runs
  // `upload-branding`, so partner artwork never reaches the test instance.
  const art = Object.values(branding.resources || {});
  if (art.length) {
    note(false, `branding artwork left on disk (${art.join(', ')}) — never run upload-branding`);
  }
}

// ---- 3. README H1 -----------------------------------------------------------
const readmePath = path.join(CONFIG, 'README.md');
if (fs.existsSync(readmePath)) {
  const lines = fs.readFileSync(readmePath, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('# '));
  const wanted = `# ${TITLE} config`;
  if (i === -1) note(false, 'README.md has no H1 to rewrite');
  else if (lines[i] === wanted) note(false, `README.md H1 already "${wanted}"`);
  else if (CHECK_ONLY) note(false, `README.md H1 is "${lines[i]}" (would set "${wanted}")`);
  else {
    const was = lines[i];
    lines[i] = wanted;
    fs.writeFileSync(readmePath, lines.join('\n'), 'utf8');
    note(true, `README.md H1 "${was}" → "${wanted}"`);
  }
}

// ---- 4. base_settings neutralization ---------------------------------------
const basePath = path.join(CONFIG, 'app_settings', 'base_settings.json');
if (!fs.existsSync(basePath)) {
  console.error(`✗ ${basePath} not found — cannot neutralize auth/integrations.`);
  process.exit(2);
}
const base = readJson(basePath);
let baseDirty = false;

if ('oidc_provider' in base) {
  if (CHECK_ONLY) note(false, 'base_settings.oidc_provider PRESENT (would delete → password login)');
  else { delete base.oidc_provider; baseDirty = true; note(true, 'Deleted base_settings.oidc_provider (→ password login)'); }
} else note(false, 'base_settings.oidc_provider already absent');

const outboundEmpty = base.outbound && typeof base.outbound === 'object' && Object.keys(base.outbound).length === 0;
if (!outboundEmpty) {
  const had = Object.keys(base.outbound || {});
  if (CHECK_ONLY) note(false, `base_settings.outbound has ${had.length} push config(s) (would empty)`);
  else { base.outbound = {}; baseDirty = true; note(true, `Emptied base_settings.outbound (dropped: ${had.join(', ') || 'n/a'})`); }
} else note(false, 'base_settings.outbound already {}');

if (base.app_url !== APP_URL) {
  if (CHECK_ONLY) note(false, `base_settings.app_url is "${base.app_url}" (would set "${APP_URL}")`);
  else { const was = base.app_url; base.app_url = APP_URL; baseDirty = true; note(true, `base_settings.app_url "${was}" → "${APP_URL}"`); }
} else note(false, `base_settings.app_url already "${APP_URL}"`);

if (baseDirty) writeJson(basePath, base);

// ---- 5-8. scrub identifying prose (deterministic, idempotent) ---------------
// The scan used to only REPORT these; for the demo the judgement is settled:
// the partner must not be identifiable from the working copy.

/** Hosts a demo config may legitimately reference. Everything else is scrubbed. */
const urlAllowed = (url) =>
  /^https?:\/\/(?:[\w-]+\.)*(communityhealthtoolkit\.org|medicmobile\.org|xlsform\.org|couchdb\.org|stackoverflow\.com|opendatakit\.github\.io|example\.invalid)(?=[/:?#]|$)/i.test(url) ||
  /^https?:\/\/github\.com\/medic(?=[/:?#]|$)/i.test(url) ||
  /^https?:\/\/(nginx|localhost|127\.0\.0\.1)(?=[/:?#]|$)/i.test(url);

const URL_RE = /https?:\/\/[^\s)"'`<>\]]+/g;
const SCRUBBED_URL = 'https://example.invalid/removed';

/** Org phrases → neutral text. Longest/most specific first. --org extras append. */
const SCRUB_PHRASES = [
  [/\beCHIS[ -]?KE\b/gi, 'CHT-Demo'],
  [/Ministry of Health/gi, 'the partner org'],
  [/\bechis\b/gi, 'cht-demo'],
  [/\bMOH\b/g, 'partner'],
  [/\bMoH\b/g, 'partner'],
  [/\bKenya\b/gi, 'the demo region'],
  [/county government/gi, 'local government'],
  ...EXTRA_ORGS.map((org) => [
    new RegExp(`\\b${org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
    'partner',
  ]),
];

const scrubText = (text) => {
  let out = text.replace(URL_RE, (url) => (urlAllowed(url) ? url : SCRUBBED_URL));
  for (const [re, sub] of SCRUB_PHRASES) out = out.replace(re, sub);
  return out;
};

// ---- 5. README.md → neutral stub ---------------------------------------------
const STUB = `# ${TITLE} config

Neutralized copy of a partner CHT configuration, prepared for cht-agent
pipeline demonstrations. Partner operational documentation, deployment
targets and internal links were removed by \`demo/setup/neutralize-config.js\`.

- Forms live in \`forms/app\` and \`forms/contact\` (XLSForm \`.xlsx\` + generated \`.xml\`).
- \`tasks.js\` / \`targets.js\` / \`contact-summary.templated.js\` compile via
  \`cht-conf compile-app-settings\`.
- Tests: \`npm test\` (cht-conf-test-harness; options in \`harness.defaults.json\`).
`;
if (fs.existsSync(readmePath)) {
  const current = fs.readFileSync(readmePath, 'utf8');
  if (current === STUB) {
    note(false, 'README.md already the neutral stub');
  } else if (CHECK_ONLY) {
    note(false, `README.md is ${current.split('\n').length} line(s) of partner docs (would replace with the stub)`);
  } else {
    fs.writeFileSync(readmePath, STUB, 'utf8');
    note(true, `README.md (${current.split('\n').length} lines of partner docs) → neutral stub`);
  }
}

// ---- 6. package.json name -----------------------------------------------------
const pkgPath = path.join(CONFIG, 'package.json');
if (fs.existsSync(pkgPath)) {
  const pkg = readJson(pkgPath);
  const scrubbedName = scrubText(pkg.name || '')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (pkg.name === scrubbedName) {
    note(false, `package.json name already neutral ("${pkg.name}")`);
  } else if (CHECK_ONLY) {
    note(false, `package.json name is "${pkg.name}" (would set "${scrubbedName}")`);
  } else {
    const was = pkg.name;
    pkg.name = scrubbedName;
    writeJson(pkgPath, pkg);
    note(true, `package.json name "${was}" → "${scrubbedName}"`);
  }
}

// ---- 7. resources.json: rename org-named icon files + rewrite references ------
const resourcesPath = path.join(CONFIG, 'resources.json');
if (fs.existsSync(resourcesPath)) {
  const resources = readJson(resourcesPath);
  let resDirty = false;
  for (const [key, file] of Object.entries(resources)) {
    if (typeof file !== 'string') continue;
    const neutral = file.replace(/echis/gi, 'demo').replace(/MOH/gi, 'demo');
    if (neutral === file) continue;
    if (CHECK_ONLY) {
      note(false, `resources.json ${key}: "${file}" (would rename file + reference to "${neutral}")`);
      continue;
    }
    const from = path.join(CONFIG, 'resources', file);
    const to = path.join(CONFIG, 'resources', neutral);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
    if (fs.existsSync(to)) {
      resources[key] = neutral;
      resDirty = true;
      note(true, `resources: "${file}" → "${neutral}" (file + reference; key "${key}" unchanged)`);
    } else {
      note(false, `resources.json ${key}: "${file}" — file not found on disk, reference left alone`);
    }
  }
  if (resDirty) writeJson(resourcesPath, resources);
}

// ---- 8. scripts/**: org tokens + partner URLs ---------------------------------
const scriptsDir = path.join(CONFIG, 'scripts');
if (fs.existsSync(scriptsDir)) {
  let scrubbed = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(json|js|ts|md|sql|txt|log)$/.test(e.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      const clean = scrubText(text);
      if (clean === text) continue;
      if (CHECK_ONLY) { note(false, `scripts: ${path.relative(CONFIG, full)} carries org/URL material (would scrub)`); continue; }
      fs.writeFileSync(full, clean, 'utf8');
      scrubbed++;
      note(true, `scripts: scrubbed ${path.relative(CONFIG, full)}`);
    }
  })(scriptsDir);
  if (scrubbed === 0 && !CHECK_ONLY) note(false, 'scripts/: nothing left to scrub');
}

// ---- verification: no env.* placeholders left ---------------------------
const settingsDir = path.join(CONFIG, 'app_settings');
const envRefs = [];
for (const f of fs.readdirSync(settingsDir).filter((n) => n.endsWith('.json'))) {
  const text = fs.readFileSync(path.join(settingsDir, f), 'utf8');
  for (const m of text.matchAll(/\{\{\s*env\.[A-Za-z0-9_]+\s*\}\}|"env\.[A-Za-z0-9_]+"/g)) {
    envRefs.push(`${f}: ${m[0]}`);
  }
}

// ---- 6. scan (report only) -------------------------------------------------
const DEFAULT_ORGS = ['eCHIS', 'echis', 'Ministry of Health', 'MoH', 'Kenya', 'county government'];
const ORGS = [...DEFAULT_ORGS, ...EXTRA_ORGS];
const SCAN_FILES = ['README.md', 'privacy-policies.json', 'resources.json', 'branding.json', 'package.json'];
const SCAN_DIRS = ['app_settings', 'scripts'];
const findings = { orgs: [], emails: [], phones: [], urls: [] };
const scanText = (rel, text) => {
  for (const org of ORGS) {
    if (new RegExp(`\\b${org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
      findings.orgs.push(`${rel}: mentions "${org}"`);
    }
  }
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) findings.emails.push(`${rel}: ${m[0]}`);
  for (const m of text.matchAll(/\+254\d{6,}|\+\d{9,}/g)) findings.phones.push(`${rel}: ${m[0]}`);
  for (const m of text.matchAll(URL_RE)) {
    if (!urlAllowed(m[0])) {
      findings.urls.push(`${rel}: ${m[0]}`);
    }
  }
};
for (const rel of SCAN_FILES) {
  const p = path.join(CONFIG, rel);
  if (fs.existsSync(p)) scanText(rel, fs.readFileSync(p, 'utf8'));
}
for (const dir of SCAN_DIRS) {
  const abs = path.join(CONFIG, dir);
  if (!fs.existsSync(abs)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(json|js|ts|md|sql|txt|log)$/.test(e.name)) scanText(path.relative(CONFIG, full), fs.readFileSync(full, 'utf8'));
    }
  })(abs);
}
const dedupe = (a) => [...new Set(a)];

// ---- report -----------------------------------------------------------------
const R = '─'.repeat(72);
console.log(`\n🧼 NEUTRALIZE ${CONFIG}${CHECK_ONLY ? '  (--check: no edits made)' : ''}\n${R}`);
console.log(changes.length ? 'CHANGED' : 'CHANGED: nothing (already neutral)');
for (const c of changes) console.log(`  ✔ ${c}`);
console.log('\nALREADY OK / LEFT ALONE');
for (const s of skipped) console.log(`  · ${s}`);

console.log(`\nVERIFY\n${R}`);
console.log(`  env.* placeholders in app_settings/: ${envRefs.length === 0 ? '✔ none (compile needs no env file)' : `✗ ${envRefs.length}`}`);
for (const e of dedupe(envRefs)) console.log(`      ${e}`);

const total = Object.values(findings).reduce((n, a) => n + dedupe(a).length, 0);
console.log(`\nSCAN — identifying material left for YOUR review (never auto-edited)\n${R}`);
if (total === 0) console.log('  ✔ nothing matched');
for (const [kind, list] of Object.entries(findings)) {
  const items = dedupe(list);
  if (!items.length) continue;
  console.log(`  ${kind.toUpperCase()} (${items.length})`);
  for (const i of items.slice(0, 15)) console.log(`      ${i}`);
  if (items.length > 15) console.log(`      … and ${items.length - 15} more`);
}
console.log(`\n${R}`);
console.log('Not touched (the demo bugs must stay intact): forms/, tasks.js, targets.js,');
console.log('contact-summary*.js, translations/. Partner artwork stays on disk — never');
console.log('run `upload-branding` against the test instance.');
if (STRICT && (total > 0 || envRefs.length > 0)) {
  console.error('\n✗ --strict: identifying material or env.* placeholders remain.');
  process.exit(1);
}
