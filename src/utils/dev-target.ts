/**
 * Development write-target gate (#134)
 *
 * For layer: cht-conf tickets the development phase edits the deployment's
 * config repo (the CHT_CONF_PATH mount) with the cht-conf toolchain
 * (convert-app-forms, upload-app-forms, upload-app-settings, …) and must never
 * write to the cht-core working copy. Everything else keeps today's cht-core
 * target. The gate fails closed: a config ticket without the mount, or a still
 * ambiguous 'investigate' ticket, refuses to resolve rather than guessing.
 */

import { CHTLayer } from '../types';
import { resolveDeploymentConfigRoot } from './canonical-diff';

const DEFAULT_CHT_CORE_PATH = '/workspace/cht-core';

export interface DevelopmentTarget {
  /** Working copy the development phase may write to. */
  repoPath: string;
  toolchain: 'cht-conf' | 'cht-core';
}

export const resolveDevelopmentTarget = (layer?: CHTLayer): DevelopmentTarget => {
  if (layer === 'investigate') {
    throw new Error(
      'investigate tickets must be disambiguated to cht-core or cht-conf before development'
    );
  }

  if (layer === 'cht-conf') {
    // Placeholder-aware: inside the container CHT_CONF_PATH is always set and
    // always exists (the compose default mounts the committed placeholder), so
    // the gate must fail closed unless a REAL deployment config is mounted.
    const repoPath = resolveDeploymentConfigRoot();
    if (!repoPath) {
      throw new Error(
        'layer: cht-conf tickets need CHT_CONF_PATH pointing at a real deployment config mount (not the committed placeholder) to develop against'
      );
    }
    return { repoPath, toolchain: 'cht-conf' };
  }

  return {
    repoPath: process.env.CHT_CORE_PATH || DEFAULT_CHT_CORE_PATH,
    toolchain: 'cht-core',
  };
};
