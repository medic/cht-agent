/**
 * Canonical-config diff (#134)
 *
 * Compares the deployment's cht-conf project (mounted at CHT_CONF_PATH) against
 * a canonical baseline (CANONICAL_CONF, defaulting to the standard config that
 * ships with cht-core at $CHT_CORE_PATH/config/standard) and surfaces the
 * suspect artifact's delta, so research findings can point development at the
 * drifted configuration instead of cht-core code.
 *
 * The util never throws: filesystem problems degrade to status 'unavailable'
 * so a missing mount can't fail the research phase.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CanonicalDiffResult, ConfigArtifact } from '../types';

const DEFAULT_CHT_CORE_PATH = '/workspace/cht-core';

/** Bound the inline diff so a huge artifact can't bloat findings or prompts. */
const MAX_DIFF_LENGTH = 4000;

/** Skip the O(n*m) line diff for very large files; report 'differs' without hunks. */
const MAX_DIFF_CELLS = 4_000_000;

const BINARY_EXTENSIONS = new Set(['.xlsx', '.xls', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf']);

/**
 * Marker file committed in docker/conf-placeholder: the compose default mounts
 * that placeholder so core-only sessions need no setup, and the container
 * always has CHT_CONF_PATH set — the marker is how "no real deployment config
 * is mounted" stays detectable, keeping the fail-closed paths reachable.
 */
const PLACEHOLDER_MARKER = '.cht-conf-placeholder';

export const isPlaceholderRoot = (root: string): boolean =>
  fs.existsSync(path.join(root, PLACEHOLDER_MARKER));

/**
 * The deployment config root: the CHT_CONF_PATH mount, unless it is the
 * committed placeholder (then there is no deployment config).
 */
export const resolveDeploymentConfigRoot = (): string | undefined => {
  const root = process.env.CHT_CONF_PATH;
  if (!root) {
    return undefined;
  }
  return isPlaceholderRoot(root) ? undefined : root;
};

/** The canonical baseline root: CANONICAL_CONF, or cht-core's standard config. */
export const resolveCanonicalConfigRoot = (): string => {
  if (process.env.CANONICAL_CONF) {
    return process.env.CANONICAL_CONF;
  }
  const chtCorePath = process.env.CHT_CORE_PATH || DEFAULT_CHT_CORE_PATH;
  return path.join(chtCorePath, 'config', 'standard');
};

/**
 * Where each configArtifact lives in a cht-conf project, in probe order.
 * With no artifactName, form artifacts fall back to their directory (compared
 * by listing). messaging config lives inside app settings; tooling is the
 * project scaffolding itself.
 */
export const artifactCandidatePaths = (
  artifact: ConfigArtifact,
  artifactName?: string
): string[] => {
  switch (artifact) {
    case 'form':
      return artifactName
        ? [
          path.join('forms', 'app', `${artifactName}.xlsx`),
          path.join('forms', 'app', `${artifactName}.xml`),
          path.join('forms', 'app', `${artifactName}.properties.json`),
        ]
        : [path.join('forms', 'app')];
    case 'contact-form':
      return artifactName
        ? [
          path.join('forms', 'contact', `${artifactName}.xlsx`),
          path.join('forms', 'contact', `${artifactName}.xml`),
        ]
        : [path.join('forms', 'contact')];
    case 'task':
      return ['tasks.js'];
    case 'target':
      return ['targets.js'];
    case 'contact-summary':
      return ['contact-summary.templated.js', 'contact-summary.js'];
    case 'app-settings':
      return ['app_settings.json', path.join('app_settings', 'base_settings.json')];
    case 'purge':
      return ['purge.js', 'purging.js'];
    case 'translations':
      return artifactName
        ? [path.join('translations', `messages-${artifactName}.properties`)]
        : ['translations'];
    case 'resources':
      return ['resources.json'];
    case 'messaging':
      return ['app_settings.json', path.join('app_settings', 'base_settings.json')];
    case 'tooling':
      return ['package.json'];
    default:
      return [];
  }
};

const isBinary = (filePath: string, content: Buffer): boolean => {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return true;
  }
  return content.subarray(0, 8000).includes(0);
};

/**
 * Longest-common-subsequence line diff: canonical lines prefixed '-',
 * deployment lines prefixed '+', unchanged lines ' '. Runs of unchanged lines
 * are collapsed to one line of context on each side. The common prefix and
 * suffix are trimmed before the LCS table is built, so a one-line drift in a
 * several-thousand-line app_settings.json stays well under the size cap.
 */
const buildLineDiff = (canonicalText: string, deploymentText: string): string | undefined => {
  const allA = canonicalText.split('\n');
  const allB = deploymentText.split('\n');

  let prefix = 0;
  while (prefix < allA.length && prefix < allB.length && allA[prefix] === allB[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < allA.length - prefix &&
    suffix < allB.length - prefix &&
    allA[allA.length - 1 - suffix] === allB[allB.length - 1 - suffix]
  ) {
    suffix++;
  }

  const a = allA.slice(prefix, allA.length - suffix);
  const b = allB.slice(prefix, allB.length - suffix);

  if (a.length * b.length > MAX_DIFF_CELLS) {
    return undefined;
  }

  // LCS table
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // Walk the table, emitting -/+/space lines
  const raw: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      raw.push(` ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push(`-${a[i]}`);
      i++;
    } else {
      raw.push(`+${b[j]}`);
      j++;
    }
  }
  while (i < a.length) {
    raw.push(`-${a[i]}`);
    i++;
  }
  while (j < b.length) {
    raw.push(`+${b[j]}`);
    j++;
  }

  // Re-add one line of context from the trimmed prefix/suffix
  if (prefix > 0) {
    raw.unshift(` ${allA[prefix - 1]}`);
  }
  if (suffix > 0) {
    raw.push(` ${allA[allA.length - suffix]}`);
  }

  // Collapse long unchanged runs to one context line each side of a change
  const collapsed: string[] = [];
  raw.forEach((line, index) => {
    if (!line.startsWith(' ')) {
      collapsed.push(line);
      return;
    }
    const prevChanged = index > 0 && !raw[index - 1].startsWith(' ');
    const nextChanged = index < raw.length - 1 && !raw[index + 1].startsWith(' ');
    if (prevChanged || nextChanged) {
      collapsed.push(line);
    } else if (collapsed[collapsed.length - 1] !== '…') {
      collapsed.push('…');
    }
  });

  if (prefix > 1) {
    collapsed.unshift('…');
  }
  if (suffix > 1) {
    collapsed.push('…');
  }

  const text = collapsed.join('\n');
  if (text.length > MAX_DIFF_LENGTH) {
    return `${text.slice(0, MAX_DIFF_LENGTH)}\n… (diff truncated)`;
  }
  return text;
};

/** Shallow directory comparison: which entries exist on only one side. */
const diffDirectories = (
  canonicalDir: string,
  deploymentDir: string
): { added: string[]; removed: string[] } => {
  const list = (dir: string): string[] =>
    fs.existsSync(dir) ? fs.readdirSync(dir).toSorted((x, y) => x.localeCompare(y)) : [];

  const canonicalEntries = new Set(list(canonicalDir));
  const deploymentEntries = new Set(list(deploymentDir));

  return {
    added: [...deploymentEntries].filter((entry) => !canonicalEntries.has(entry)),
    removed: [...canonicalEntries].filter((entry) => !deploymentEntries.has(entry)),
  };
};

export interface CanonicalDiffOptions {
  artifact: ConfigArtifact;
  artifactName?: string;
  /** Defaults to CHT_CONF_PATH. */
  deploymentRoot?: string;
  /** Defaults to CANONICAL_CONF, then $CHT_CORE_PATH/config/standard. */
  canonicalRoot?: string;
}

const unavailable = (options: CanonicalDiffOptions, summary: string): CanonicalDiffResult => ({
  artifact: options.artifact,
  artifactName: options.artifactName,
  status: 'unavailable',
  summary,
});

const diffDirectoryArtifact = (
  options: CanonicalDiffOptions,
  relativePath: string,
  canonicalPath: string,
  deploymentPath: string
): CanonicalDiffResult => {
  const { added, removed } = diffDirectories(canonicalPath, deploymentPath);
  if (added.length === 0 && removed.length === 0) {
    return {
      artifact: options.artifact,
      artifactName: options.artifactName,
      relativePath,
      status: 'identical',
      summary: `${relativePath}/ has the same entries as the canonical baseline (contents not compared; name a specific artifact for a content diff)`,
    };
  }

  const addedNote = added.length > 0 ? `only in deployment: ${added.join(', ')}` : '';
  const removedNote = removed.length > 0 ? `only in canonical: ${removed.join(', ')}` : '';
  const detail = [addedNote, removedNote].filter((note) => note.length > 0).join('; ');

  return {
    artifact: options.artifact,
    artifactName: options.artifactName,
    relativePath,
    status: 'differs',
    summary: `${relativePath}/ differs from the canonical baseline — ${detail}`,
  };
};

const diffTextFiles = (
  options: CanonicalDiffOptions,
  relativePath: string,
  canonicalContent: Buffer,
  deploymentContent: Buffer
): CanonicalDiffResult => {
  const diff = buildLineDiff(canonicalContent.toString('utf-8'), deploymentContent.toString('utf-8'));
  return {
    artifact: options.artifact,
    artifactName: options.artifactName,
    relativePath,
    status: 'differs',
    diff,
    summary: diff === undefined
      ? `${relativePath} differs from the canonical baseline (too large for an inline diff)`
      : `${relativePath} differs from the canonical baseline`,
  };
};

const diffExistingFile = (
  options: CanonicalDiffOptions,
  relativePath: string,
  canonicalPath: string,
  deploymentPath: string
): CanonicalDiffResult => {
  const canonicalContent = fs.readFileSync(canonicalPath);
  const deploymentContent = fs.readFileSync(deploymentPath);

  if (canonicalContent.equals(deploymentContent)) {
    return {
      artifact: options.artifact,
      artifactName: options.artifactName,
      relativePath,
      status: 'identical',
      summary: `${relativePath} matches the canonical baseline byte for byte`,
    };
  }

  if (isBinary(deploymentPath, deploymentContent) || isBinary(canonicalPath, canonicalContent)) {
    return binaryDiffWithXmlFallback(options, relativePath, canonicalPath, deploymentPath);
  }

  return diffTextFiles(options, relativePath, canonicalContent, deploymentContent);
};

/**
 * A differing .xlsx cannot be diffed inline; when the converted .xml sibling
 * exists on both sides (cht-conf checks it in next to the source), diff that
 * instead — the XForm delta is what development actually needs.
 */
const binaryDiffWithXmlFallback = (
  options: CanonicalDiffOptions,
  relativePath: string,
  canonicalPath: string,
  deploymentPath: string
): CanonicalDiffResult => {
  const xmlRelative = relativePath.replace(/\.[^.]+$/, '.xml');
  const canonicalXml = canonicalPath.replace(/\.[^.]+$/, '.xml');
  const deploymentXml = deploymentPath.replace(/\.[^.]+$/, '.xml');

  const xmlUsable =
    xmlRelative !== relativePath && fs.existsSync(canonicalXml) && fs.existsSync(deploymentXml);

  if (!xmlUsable) {
    return {
      artifact: options.artifact,
      artifactName: options.artifactName,
      relativePath,
      status: 'binary-differs',
      summary: `${relativePath} differs from the canonical baseline (binary content — compare the source spreadsheets or the converted XML)`,
    };
  }

  const xmlResult = diffExistingFile(options, xmlRelative, canonicalXml, deploymentXml);
  return {
    ...xmlResult,
    status: xmlResult.status === 'identical' ? 'binary-differs' : xmlResult.status,
    summary: `${relativePath} differs (binary); ${xmlResult.summary}`,
  };
};

interface FacetPresence {
  relativePath: string;
  deploymentPath: string;
  canonicalPath: string;
  inDeployment: boolean;
  inCanonical: boolean;
}

const isDirectoryAt = (target: string): boolean =>
  fs.existsSync(target) && fs.statSync(target).isDirectory();

/**
 * Compare every facet of the artifact that exists on both sides; the first
 * one that differs is the artifact's delta. Comparing only the first-found
 * facet would report a form as identical when its .xlsx matches but its
 * .properties.json (an independent facet) drifted.
 */
const diffComparableFacets = (
  options: CanonicalDiffOptions,
  facets: FacetPresence[]
): CanonicalDiffResult | undefined => {
  let identicalResult: CanonicalDiffResult | undefined;

  for (const facet of facets) {
    const result = diffExistingFile(options, facet.relativePath, facet.canonicalPath, facet.deploymentPath);
    if (result.status !== 'identical') {
      return result;
    }
    identicalResult = identicalResult ?? result;
  }

  return identicalResult;
};

const diffUnpairedFacets = (
  options: CanonicalDiffOptions,
  facets: FacetPresence[]
): CanonicalDiffResult => {
  const deploymentOnly = facets.filter((facet) => facet.inDeployment);
  const canonicalOnly = facets.filter((facet) => facet.inCanonical);

  if (deploymentOnly.length > 0 && canonicalOnly.length > 0) {
    const deploymentNames = deploymentOnly.map((facet) => facet.relativePath).join(', ');
    const canonicalNames = canonicalOnly.map((facet) => facet.relativePath).join(', ');
    return {
      artifact: options.artifact,
      artifactName: options.artifactName,
      relativePath: deploymentOnly[0].relativePath,
      status: 'differs',
      summary: `${options.artifact} exists as ${deploymentNames} in the deployment but as ${canonicalNames} in the canonical baseline — no directly comparable facet`,
    };
  }

  if (deploymentOnly.length > 0) {
    return {
      artifact: options.artifact,
      artifactName: options.artifactName,
      relativePath: deploymentOnly[0].relativePath,
      status: 'missing-in-canonical',
      summary: `${deploymentOnly[0].relativePath} is a deployment-specific artifact with no canonical counterpart`,
    };
  }

  return {
    artifact: options.artifact,
    artifactName: options.artifactName,
    relativePath: canonicalOnly[0].relativePath,
    status: 'missing-in-deployment',
    summary: `${canonicalOnly[0].relativePath} exists in the canonical baseline but not in the deployment config`,
  };
};

/**
 * Diff the suspect artifact in the deployment config against the canonical
 * baseline. Never throws — every failure mode maps to a CanonicalDiffResult.
 */
export const diffAgainstCanonical = (options: CanonicalDiffOptions): CanonicalDiffResult => {
  try {
    const deploymentRoot = options.deploymentRoot ?? resolveDeploymentConfigRoot();
    const canonicalRoot = options.canonicalRoot ?? resolveCanonicalConfigRoot();

    if (!deploymentRoot || !fs.existsSync(deploymentRoot) || isPlaceholderRoot(deploymentRoot)) {
      return unavailable(
        options,
        'deployment config not mounted — set CHT_CONF_PATH to the deployment config repo (the default mount is the committed placeholder) to enable the canonical diff'
      );
    }
    if (!fs.existsSync(canonicalRoot)) {
      return unavailable(
        options,
        `canonical baseline not found at ${canonicalRoot} — set CANONICAL_CONF (or mount cht-core, whose config/standard is the default baseline)`
      );
    }

    const candidates = artifactCandidatePaths(options.artifact, options.artifactName);
    const facets: FacetPresence[] = candidates
      .map((relativePath) => {
        const deploymentPath = path.join(deploymentRoot, relativePath);
        const canonicalPath = path.join(canonicalRoot, relativePath);
        return {
          relativePath,
          deploymentPath,
          canonicalPath,
          inDeployment: fs.existsSync(deploymentPath),
          inCanonical: fs.existsSync(canonicalPath),
        };
      })
      .filter((facet) => facet.inDeployment || facet.inCanonical);

    if (facets.length === 0) {
      return unavailable(
        options,
        `could not locate the ${options.artifact} artifact in the deployment config (tried: ${candidates.join(', ')})`
      );
    }

    // Directory candidates (unnamed form/translations artifacts) are always a
    // single candidate: compare listings, or report the missing side.
    const first = facets[0];
    if (isDirectoryAt(first.deploymentPath) || isDirectoryAt(first.canonicalPath)) {
      if (first.inDeployment && first.inCanonical) {
        return diffDirectoryArtifact(options, first.relativePath, first.canonicalPath, first.deploymentPath);
      }
      return diffUnpairedFacets(options, facets);
    }

    const comparable = facets.filter((facet) => facet.inDeployment && facet.inCanonical);
    const compared = diffComparableFacets(options, comparable);
    if (compared) {
      return compared;
    }

    return diffUnpairedFacets(options, facets.filter((facet) => !(facet.inDeployment && facet.inCanonical)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(options, `canonical diff failed: ${message}`);
  }
};
