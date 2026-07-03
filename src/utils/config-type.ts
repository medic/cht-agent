/**
 * Config-type boundary guard (mission 04 — reconstruction boundary).
 *
 * Not every cht-conf bug is fixable from a live deployment alone. cht-conf's
 * `compile-app-settings` leaves some artifacts as plain, readable JSON inside
 * `app_settings.json` (permissions, roles, contact_types, schedules,
 * transitions, purge, target DEFINITIONS) and webpack+terser-MINIFIES others
 * into it (task/target EMISSION LOGIC + nools rules -> `app_settings.tasks.rules`;
 * contact-summary -> a bundle in `app_settings.contact_summary`). Source maps
 * were removed (cht-conf PR #215) and the server keeps no source copy, so the
 * minified artifacts cannot be recovered from a deployment.
 *
 * So the routing rule the agent must honour: JSON-shaped config + form XML are
 * fixable from the mount; task/target/contact-summary LOGIC needs a mounted
 * source repo (real tasks.js / targets.js / contact-summary*.js). When that
 * source is absent the tool must say so LOUDLY rather than pretend to edit
 * minified JS — but the message is qualified: the declarative task/target
 * scaffold survives minification, so a future `reconstruct-rules` skill can
 * rebuild readable source (see designs/issue-cht-ai-tools-reconstruct-rules-skill.md).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigArtifact, ConfigMechanism } from '../types';
import { resolveDeploymentConfigRoot } from './canonical-diff';

export type ConfigFixability = 'fixable-from-deployment' | 'needs-source-repo';

export interface ConfigTypeClassification {
  artifact: ConfigArtifact;
  fixability: ConfigFixability;
  /** For needs-source-repo artifacts: the source file(s) that must exist in CHT_CONF_PATH. */
  requiredSource?: string[];
  /** Why this artifact is (or is not) recoverable from a deployment alone. */
  reason: string;
}

/**
 * The task/target mechanisms that are EMISSION LOGIC (predicate function bodies
 * minified into app_settings.tasks.rules), as opposed to a target DEFINITION
 * change (goal/icon/label/enabled — readable JSON).
 */
const EMISSION_LOGIC_MECHANISMS: ReadonlyArray<ConfigMechanism> = [
  'appliesIf',
  'resolvedIf',
  'events',
  'calculation',
];

const NEEDS_SOURCE = {
  task: {
    requiredSource: ['tasks.js'],
    reason:
      'task emission logic + nools rules are webpack+terser-minified & variable-mangled into ' +
      'app_settings.tasks.rules (no source maps since cht-conf PR #215); a deployment cannot yield readable source',
  },
  target: {
    requiredSource: ['targets.js'],
    reason:
      'target emission logic (appliesIf/resolvedIf/events/calculation) is minified into ' +
      'app_settings.tasks.rules; only the target DEFINITION (id/type/goal/icon/translation_key) survives as readable JSON',
  },
  'contact-summary': {
    requiredSource: ['contact-summary.templated.js', 'contact-summary.js'],
    reason: 'contact-summary compiles to a ~76KB minified webpack bundle in app_settings.contact_summary',
  },
  tooling: {
    requiredSource: ['package.json'],
    reason: 'tooling changes edit the cht-conf project scaffolding itself, which a running deployment does not expose',
  },
} as const;

const fixable = (artifact: ConfigArtifact, reason: string): ConfigTypeClassification => ({
  artifact,
  fixability: 'fixable-from-deployment',
  reason,
});

const needsSource = (artifact: keyof typeof NEEDS_SOURCE): ConfigTypeClassification => ({
  artifact,
  fixability: 'needs-source-repo',
  requiredSource: [...NEEDS_SOURCE[artifact].requiredSource],
  reason: NEEDS_SOURCE[artifact].reason,
});

/**
 * Classify whether a cht-conf artifact's fix is recoverable from a live
 * deployment alone, or requires a mounted source repo. The `target` case is
 * mechanism-sensitive: a definition change is fixable, an emission-logic change
 * is not.
 */
export const classifyConfigType = (
  artifact: ConfigArtifact,
  mechanism?: ConfigMechanism
): ConfigTypeClassification => {
  switch (artifact) {
    case 'form':
    case 'contact-form':
      return fixable(artifact, 'app/contact form XML is served + editable; edit the .xml bind and re-upload (the .xlsx source is lost, so this is authoring-only)');
    case 'app-settings':
    case 'messaging':
      return fixable(artifact, 'plain JSON in app_settings.json (permissions, roles, contact_types, messaging)');
    case 'purge':
      return fixable(artifact, 'purge config lands as plain JSON in app_settings');
    case 'translations':
    case 'resources':
      return fixable(artifact, 'recoverable when backed up (.properties / resources/)');
    case 'task':
      return needsSource('task');
    case 'contact-summary':
      return needsSource('contact-summary');
    case 'tooling':
      return needsSource('tooling');
    case 'target':
      return mechanism && EMISSION_LOGIC_MECHANISMS.includes(mechanism)
        ? needsSource('target')
        : fixable('target', 'target DEFINITION (id/type/goal/icon/translation_key/enabled) survives as readable JSON in app_settings.tasks.targets.items[]');
    default:
      return fixable(artifact, 'assumed JSON-shaped config');
  }
};

export interface ConfigFixGuardResult {
  /** True when the fix can proceed against the current mount. */
  ok: boolean;
  fixability: ConfigFixability;
  /** True when needs-source-repo AND the source is present in the mount. */
  sourcePresent: boolean;
  message: string;
}

export interface ConfigFixGuardOptions {
  artifact: ConfigArtifact;
  mechanism?: ConfigMechanism;
  /** The mounted config root; defaults to resolveDeploymentConfigRoot() (CHT_CONF_PATH). */
  configRoot?: string;
}

/**
 * Gate a cht-conf fix on the config-type boundary. Fixable-from-deployment
 * artifacts always pass. A needs-source-repo artifact passes only when its
 * source file(s) are present in the mounted config root; otherwise it fails
 * with a qualified message (provide the source repo, or reconstruct it via the
 * future reconstruct-rules skill) — never an unqualified refusal.
 */
export const guardConfigFix = (options: ConfigFixGuardOptions): ConfigFixGuardResult => {
  const classification = classifyConfigType(options.artifact, options.mechanism);

  if (classification.fixability === 'fixable-from-deployment') {
    return {
      ok: true,
      fixability: 'fixable-from-deployment',
      sourcePresent: true,
      message: `${options.artifact} is fixable from the deployment mount (${classification.reason}).`,
    };
  }

  const root = options.configRoot ?? resolveDeploymentConfigRoot();
  const required = classification.requiredSource ?? [];
  const sourcePresent = root !== undefined && required.some((rel) => fs.existsSync(path.join(root, rel)));

  if (sourcePresent) {
    return {
      ok: true,
      fixability: 'needs-source-repo',
      sourcePresent: true,
      message:
        `${options.artifact}: ${classification.reason}. Source is mounted at CHT_CONF_PATH ` +
        `(${required.join(' or ')}), so the fix can proceed.`,
    };
  }

  return {
    ok: false,
    fixability: 'needs-source-repo',
    sourcePresent: false,
    message:
      `${options.artifact} is out of scope for a deployment-only fix: ${classification.reason}. ` +
      `It needs a mounted source repo (CHT_CONF_PATH with ${required.join(' or ')}), ` +
      'or reconstruct it via the future reconstruct-rules skill ' +
      '(designs/issue-cht-ai-tools-reconstruct-rules-skill.md) once available.',
  };
};
