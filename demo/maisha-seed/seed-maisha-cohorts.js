#!/usr/bin/env node
/*
 * Maisha demo-cohort seeder — per-ticket "household lanes" (runbook §3b).
 *
 * Creates four households under the existing CHV area, each carrying the
 * contacts (+ M4 immunization report / M3 delivery report) a ticket needs.
 * Every doc _id is prefixed `maisha-seed-` so a botched run is trivially
 * identifiable and deletable. The seeder is IDEMPOTENT: it fetches the
 * current _rev for each id and upserts via _bulk_docs, so re-running never
 * duplicates docs (it refreshes them — which also keeps the two newborns
 * younger than 28 days on every run).
 *
 * READ-ONLY against everything it did not create: it discovers the parent
 * chain + CHV lineage from the existing demo_chv user and never PUTs
 * settings/forms or touches non-maisha-seed docs.
 *
 * Usage:
 *   CHT_URL=https://localhost:10443 COUCHDB_USER=medic COUCHDB_PASSWORD=password \
 *     NODE_TLS_REJECT_UNAUTHORIZED=0 node demo/maisha-seed/seed-maisha-cohorts.js
 *   (env vars shown are the defaults; TLS reject-unauthorized is force-disabled
 *    below for the self-signed throwaway instance.)
 *
 * M3_DUPLICATES=N (default 3) also seeds N newborn-PNC reports whose
 * immunization follow-up is due TODAY, so the duplicate-task pile is visible
 * in the Tasks tab immediately instead of three days out. M3_DUPLICATES=0
 * skips them (live-submission-only demo).
 */
'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // self-signed throwaway instance

const CHT_URL = (process.env.CHT_URL || 'https://localhost:10443').replace(/\/$/, '');
const USER = process.env.COUCHDB_USER || 'medic';
const PASS = process.env.COUCHDB_PASSWORD || 'password';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

const CHV_USER = process.env.DEMO_CHV_USER || 'demo_chv';

async function cdb(path, opts = {}) {
  const res = await fetch(`${CHT_URL}${path}`, {
    ...opts,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!res.ok && res.status !== 404) {
    throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return { status: res.status, body };
}

// ---- date helpers (dob is content; newborns are computed relative to now) ----
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const yearsAgo = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
};
const NOW = Date.now();

async function main() {
  // 1. Discover the CHV user -> contact (CHV person) -> its parent lineage.
  const us = await cdb(`/medic/org.couchdb.user%3A${CHV_USER}`);
  if (us.status === 404) throw new Error(`CHV user-settings org.couchdb.user:${CHV_USER} not found`);
  const chvContactId = us.body.contact_id;
  const chvPerson = (await cdb(`/medic/${encodeURIComponent(chvContactId)}`)).body;
  const chvLineage = chvPerson.parent; // {_id: CHV_AREA, parent:{... county}}
  if (!chvLineage || !chvLineage._id) throw new Error('CHV person has no parent lineage');
  const chvAreaId = chvLineage._id;
  const countyId = chvLineage.parent.parent.parent._id;

  console.log(`Discovered: CHV user=${CHV_USER} person=${chvContactId} area=${chvAreaId} county=${countyId}`);

  // household.parent is the CHV person's own lineage (CHV area + ancestry).
  const hhParent = () => JSON.parse(JSON.stringify(chvLineage));
  // f_client.parent = the household, wrapped over the CHV-area lineage.
  const clientParent = (hhId) => ({ _id: hhId, parent: hhParent() });

  const household = (id, name) => ({
    _id: id, type: 'contact', contact_type: 'e_household', name,
    parent: hhParent(), reported_date: NOW,
  });
  const client = (id, hhId, name, sex, dob, extra = {}) => ({
    _id: id, type: 'contact', contact_type: 'f_client', name, sex,
    date_of_birth: dob, parent: clientParent(hhId), reported_date: NOW, ...extra,
  });

  // 2. Build the four lanes.
  const HH = {
    m8: 'maisha-seed-hh-m8', m7: 'maisha-seed-hh-m7',
    m4: 'maisha-seed-hh-m4', m3: 'maisha-seed-hh-m3',
  };
  const docs = [];

  // --- HH-M8 / HH-M7: households with an adult member (register live in demo) ---
  docs.push(household(HH.m8, 'Maisha M8 Household (Seed)'));
  docs.push(client('maisha-seed-m8-adult', HH.m8, 'Miriam Otieno (M8 Seed)', 'female', yearsAgo(31)));

  docs.push(household(HH.m7, 'Maisha M7 Household (Seed)'));
  docs.push(client('maisha-seed-m7-adult', HH.m7, 'Joseph Wanjiru (M7 Seed)', 'male', yearsAgo(38)));

  // --- HH-M4: newborn who is complete-for-age (BCG+OPV0) PLUS one extra dose,
  //     so requiredVaccines.length (3) !== countTotalVaccinesByAge (2) => BUGGY 'yes',
  //     while every age-DUE vaccine (bcg) is received => CORRECT 'no'.
  //     Newborn (<28d) so is_immunization_defaulter renders (contact-summary + newborn PNC task). ---
  const M4_CHILD = 'maisha-seed-m4-newborn';
  docs.push(household(HH.m4, 'Maisha M4 Household (Seed)'));
  docs.push(client('maisha-seed-m4-mother', HH.m4, 'Agnes Kamau (M4 Seed)', 'female', yearsAgo(29)));
  docs.push(client(M4_CHILD, HH.m4, 'Baby Kamau (M4 Seed)', 'male', daysAgo(14), {
    created_by_doc: 'maisha-seed-m4-delivery', place_of_birth: 'facility',
  }));
  docs.push({
    _id: 'maisha-seed-m4-immz', type: 'data_record', form: 'immunization_service',
    content_type: 'xml', reported_date: NOW,
    contact: { _id: chvContactId, parent: chvPerson.parent },
    fields: {
      inputs: { contact: { _id: M4_CHILD } },
      patient_uuid: M4_CHILD,
      group_vaccines: {
        vaccines_given: 'bcg opv_0 opv_1', // bcg+opv0 = complete-for-age; opv_1 = the extra dose (over-count)
        optional_vaccines_given: '',
        optional_malaria_vaccine: '',
      },
    },
  });

  // --- HH-M3: mother + newborn in the state where the newborn PNC form is
  //     launchable on the newborn. Launchability is 100% doc-seedable (context
  //     expression reads only contact-summary derivations of contact fields).
  //     The duplicate-task submissions are a LIVE Enketo step (see report). ---
  const M3_NEWBORN = 'maisha-seed-m3-newborn';
  docs.push(household(HH.m3, 'Maisha M3 Household (Seed)'));
  docs.push(client('maisha-seed-m3-mother', HH.m3, 'Esther Njoki (M3 Seed)', 'female', yearsAgo(27)));
  docs.push(client(M3_NEWBORN, HH.m3, 'Baby Njoki (M3 Seed)', 'female', daysAgo(10), {
    created_by_doc: 'maisha-seed-m3-delivery', place_of_birth: 'home',
  }));
  // Minimal but realistic delivery report so created_by_doc / delivery linkage resolves.
  docs.push({
    _id: 'maisha-seed-m3-delivery', type: 'data_record', form: 'postnatal_care_service',
    content_type: 'xml', reported_date: NOW - 10 * 24 * 3600 * 1000,
    contact: { _id: chvContactId, parent: chvPerson.parent },
    fields: {
      inputs: { contact: { _id: 'maisha-seed-m3-mother' } },
      patient_uuid: 'maisha-seed-m3-mother',
      place_of_birth: 'home',
      is_in_postnatal_care: 'yes',
      is_maternal_death: 'no',
      baby_doc_ids: M3_NEWBORN,
      group_delivery_outcome: { babies_delivered: '1', babies_alive: '1' },
    },
  });

  // --- HH-M3 duplicate pile (M3_DUPLICATES, default 3) ---------------------
  //  The reported symptom is N unresolved "PNC newborn immunization referral"
  //  tasks on ONE baby. Each newborn-PNC report emits its own task, keyed by
  //  the SOURCE REPORT id (emission `<reportId>~newborn-immunization-follow-up`),
  //  and the broken resolvedIf (typo'd form id, no sourceID) never clears them.
  //
  //  Why seed these at all: the task event is `{start: 0, end: 14}` with
  //  dueDate = the form-calculated `immunization_follow_up_date` = today + 3,
  //  so a LIVE submission's task sits in state `Draft` (invisible in the Tasks
  //  tab) for three days. These seeded reports are byte-shaped like a real
  //  submission (captured from one) but carry `immunization_follow_up_date`
  //  = TODAY, so their tasks are `Ready` — the pile is visible immediately.
  //  DATE-SHIFT IS THE ONLY SYNTHETIC PART: form id, fields and the emission
  //  path are exactly what Enketo produces. Set M3_DUPLICATES=0 to skip.
  //
  //  Each report also sets needs_danger_signs_follow_up='no' so the pile is
  //  PURE immunization duplicates (no danger-signs referral noise).
  const dupCount = Number.parseInt(process.env.M3_DUPLICATES ?? '3', 10);
  const todayIso = new Date().toISOString().slice(0, 10) + 'T00:00:00.000-06:00';
  const newbornSnapshot = {
    _id: M3_NEWBORN, name: 'Baby Njoki (M3 Seed)', date_of_birth: daysAgo(10),
    sex: 'female', place_of_birth: 'home',
    parent: { _id: HH.m3, parent: { link_facility_code: '', link_facility_name: '', chu_code: '', chu_name: '' } },
  };
  for (let i = 1; i <= (Number.isFinite(dupCount) ? dupCount : 3); i += 1) {
    docs.push({
      _id: `maisha-seed-m3-pncdup-${i}`,
      form: 'postnatal_care_service_newborn',
      type: 'data_record',
      content_type: 'xml',
      // staggered so the pile reads as three separate home visits
      reported_date: NOW - (dupCount - i + 1) * 24 * 3600 * 1000,
      contact: { _id: chvContactId, parent: chvPerson.parent },
      hidden_fields: ['meta'],
      fields: {
        inputs: { source: 'contact', source_id: '', contact: newbornSnapshot },
        patient_id: M3_NEWBORN,
        patient_name: 'Baby Njoki (M3 Seed)',
        patient_age_in_years: '0', patient_age_in_months: '0', patient_age_in_days: '10',
        place_of_birth: 'home',
        is_immunization_defaulter: 'yes',
        is_patient_available: 'true',
        // exactly ONE task per report: immunization follow-up, due TODAY
        needs_immunization_follow_up: 'yes',
        immunization_follow_up_date: todayIso,
        needs_danger_signs_follow_up: 'no', danger_signs_follow_up_date: '',
        needs_missed_visit_follow_up: 'no', missed_visit_follow_up_date: '',
        newborn_home_visit_count: String(i - 1),
        delivery_uuid: 'maisha-seed-m3-delivery',
        visited_contact_uuid: HH.m3,
        group_danger_signs: {
          newborn_danger_signs: 'none',
          has_updated_immunization_status: 'no', // the field that calculates the follow-up need
        },
      },
    });
  }

  // 3. Idempotent upsert: fetch current _rev per id, then _bulk_docs.
  const ids = docs.map((d) => d._id);
  const existing = await cdb('/medic/_all_docs', {
    method: 'POST', body: JSON.stringify({ keys: ids }),
  });
  const revById = {};
  for (const row of existing.body.rows || []) {
    if (row.id && row.value && row.value.rev && !row.value.deleted) revById[row.id] = row.value.rev;
  }
  const summary = [];
  for (const d of docs) {
    if (revById[d._id]) { d._rev = revById[d._id]; summary.push([d._id, d.contact_type || d.form, 'upsert']); }
    else summary.push([d._id, d.contact_type || d.form, 'create']);
  }

  const res = await cdb('/medic/_bulk_docs', { method: 'POST', body: JSON.stringify({ docs }) });
  const errors = (res.body || []).filter((r) => r.error);
  if (errors.length) {
    console.error('BULK ERRORS:', JSON.stringify(errors, null, 2));
    process.exitCode = 1;
  }

  // 4. Summary table.
  console.log('\n=== SEED SUMMARY ===');
  console.log('lane   id                          type/form              action   result');
  const laneOf = (id) => (id.match(/m[0-9]/) || ['?'])[0].toUpperCase();
  for (const [id, kind, action] of summary) {
    const r = (res.body || []).find((x) => x.id === id);
    const result = r ? (r.ok ? `ok rev=${r.rev.split('-')[0]}` : `ERR ${r.error}`) : '??';
    console.log(
      `${('HH-' + laneOf(id)).padEnd(6)} ${id.padEnd(27)} ${String(kind).padEnd(22)} ${action.padEnd(8)} ${result}`
    );
  }
  console.log(`\nAll under CHV area ${chvAreaId} (replicates to ${CHV_USER}).`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
