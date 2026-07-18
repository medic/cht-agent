/**
 * CHT / CouchDB HTTP helpers for the Test Environment Layer.
 *
 * Isolates every `fetch` against a running instance (the way cht-readiness.ts
 * isolates the readiness poll), so the Test Environment Agent stays
 * orchestration-only. CHT proxies CouchDB behind the same nginx front end, so
 * both the API (`/api/v1/settings`) and the medic database
 * (`/medic/_all_docs`, `/medic/_bulk_docs`) share the handle's base URL and
 * admin credentials. Credentials travel only in the Authorization header —
 * never in a URL, a log line, or an error message.
 *
 * See: designs/layer_recommendations/test-environment-layer.md (Config
 *      Discovery + reset tiers)
 */

import { EnvironmentHandle } from '../types';

type ChtAuth = EnvironmentHandle['auth'];

/** Per-request bound so a hung connection fails fast (same default as readiness). */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface ChtRequestOptions {
  /** Per-request timeout in ms. */
  requestTimeoutMs?: number;
}

/** A row of a CouchDB _all_docs response, flattened for callers. */
export interface DocRevRow {
  id: string;
  /** Present when the doc exists (deleted docs keep their tombstone rev). */
  rev?: string;
  /** True when the doc exists only as a deletion tombstone. */
  deleted?: boolean;
  /** True when the doc has never existed. */
  missing?: boolean;
}

/** A row of a CouchDB _bulk_docs response. */
export interface BulkDocResultRow {
  id?: string;
  ok?: boolean;
  rev?: string;
  error?: string;
  reason?: string;
}

/** Minimal shape of a doc submitted to _bulk_docs (deletions add _deleted). */
export type BulkDoc = { _id: string } & Record<string, unknown>;

// Raw CouchDB _all_docs row: value carries rev/deleted, error marks missing keys.
interface AllDocsRow {
  id?: string;
  key?: string;
  value?: { rev?: string; deleted?: boolean };
  error?: string;
}

const basicAuth = (auth: ChtAuth): string => {
  const encoded = Buffer.from(`${auth.user}:${auth.password}`).toString('base64');
  return `Basic ${encoded}`;
};

/**
 * Bounded, authenticated request. Throws on a non-2xx status with the path
 * and status only (the base URL is the handle's cred-free URL, so the full
 * message stays safe to log). The single options object carries the per-request
 * timeout plus the method and JSON body for the POST callers.
 */
const request = async (
  url: string,
  auth: ChtAuth,
  path: string,
  options: ChtRequestOptions & { method?: string; body?: string } = {}
): Promise<unknown> => {
  const method = options.method ?? 'GET';
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const hasBody = options.body !== undefined;
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      Authorization: basicAuth(auth),
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: options.body } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`CHT request failed: ${method} ${path} -> HTTP ${response.status}`);
  }
  return response.json();
};

/**
 * Read the deployed app settings (GET /api/v1/settings) — contact_types,
 * roles, permissions, transitions, and the rest of the app_settings doc.
 */
export const fetchSettings = async (
  url: string,
  auth: ChtAuth,
  options: ChtRequestOptions = {}
): Promise<Record<string, unknown>> => {
  const settings = await request(url, auth, '/api/v1/settings', options);
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('CHT request failed: GET /api/v1/settings returned a non-object body');
  }
  return settings as Record<string, unknown>;
};

// _all_docs key range covering every `form:<id>` doc. \ufff0 is the
// conventional high-sentinel: it sorts after any real form id character.
const FORM_RANGE_QUERY = new URLSearchParams({
  startkey: JSON.stringify('form:'),
  endkey: JSON.stringify('form:\ufff0'),
}).toString();

/**
 * List the installed form docs (id + current rev) straight from the medic
 * database. The rev doubles as the form's change-detection hash — see
 * DiscoveredConfig.formVersions.
 */
export const fetchFormRevs = async (
  url: string,
  auth: ChtAuth,
  options: ChtRequestOptions = {}
): Promise<Array<{ id: string; rev: string }>> => {
  const body = (await request(url, auth, `/medic/_all_docs?${FORM_RANGE_QUERY}`, options)) as {
    rows?: AllDocsRow[];
  };
  return (body.rows ?? [])
    .filter((row): row is AllDocsRow & { id: string } => typeof row.id === 'string' && !row.value?.deleted)
    .map((row) => ({ id: row.id, rev: row.value?.rev ?? '' }));
};

/**
 * Fetch the CURRENT revision of each requested doc id (POST /medic/_all_docs
 * with keys). The couchdb reset needs live revs, not the revs from seeding
 * time — sentinel transitions bump seeded docs' revs behind our back.
 */
export const fetchDocRevs = async (
  url: string,
  auth: ChtAuth,
  ids: string[],
  options: ChtRequestOptions = {}
): Promise<DocRevRow[]> => {
  if (ids.length === 0) {
    return [];
  }
  const body = (await request(url, auth, '/medic/_all_docs', {
    ...options,
    method: 'POST',
    body: JSON.stringify({ keys: ids }),
  })) as { rows?: AllDocsRow[] };
  return (body.rows ?? []).map((row) => {
    if (row.error || !row.value) {
      return { id: row.key ?? row.id ?? '', missing: true };
    }
    return {
      id: row.id ?? row.key ?? '',
      rev: row.value.rev,
      ...(row.value.deleted ? { deleted: true } : {}),
    };
  });
};

/**
 * Submit docs to POST /medic/_bulk_docs (the couchdb reset submits
 * {_id, _rev, _deleted: true} tombstones). Returns the per-doc outcome rows;
 * callers decide whether an `error` row (e.g. a conflict) is fatal.
 */
export const bulkDocs = async (
  url: string,
  auth: ChtAuth,
  docs: BulkDoc[],
  options: ChtRequestOptions = {}
): Promise<BulkDocResultRow[]> => {
  if (docs.length === 0) {
    return [];
  }
  const body = await request(url, auth, '/medic/_bulk_docs', {
    ...options,
    method: 'POST',
    body: JSON.stringify({ docs }),
  });
  return Array.isArray(body) ? (body as BulkDocResultRow[]) : [];
};
