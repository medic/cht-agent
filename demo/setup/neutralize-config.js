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
 * What it only REPORTS (never edits, because prose needs judgement):
 *   organisation/person names, e-mail addresses, phone numbers and external URLs
 *   left in prose, translations, deploy scripts and analytics SQL.
 *
 * It NEVER runs git, npm or docker, and never touches `forms/`, `tasks.js`,
 * `targets.js` or the contact-summary — the bugs under demo must stay intact.
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

// ---- 5. verification: no env.* placeholders left ---------------------------
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
  for (const m of text.matchAll(/https?:\/\/[A-Za-z0-9._/-]+/g)) {
    if (!m[0].includes('nginx') && !m[0].includes('localhost') && !m[0].includes('communityhealthtoolkit.org')) {
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
      else if (/\.(json|js|md|sql)$/.test(e.name)) scanText(path.relative(CONFIG, full), fs.readFileSync(full, 'utf8'));
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
