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
    const repoPath = process.env.CHT_CONF_PATH;
    if (!repoPath) {
      throw new Error(
        'layer: cht-conf tickets need CHT_CONF_PATH (the deployment config mount) to develop against'
      );
    }
    return { repoPath, toolchain: 'cht-conf' };
  }

  return {
    repoPath: process.env.CHT_CORE_PATH || DEFAULT_CHT_CORE_PATH,
    toolchain: 'cht-core',
  };
};
