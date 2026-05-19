import { ContextFile, GeneratedFile } from '../interface';
import { PlanItem } from './plan';

export interface FileManifest {
  existingFiles: string[];
  allowedDirectories: string[];
}

/**
 * Build a deterministic file manifest from context files.
 * Existing workspace files are candidates for MODIFY.
 * Their parent directories (+ target directory) are valid for CREATE.
 */
export function buildFileManifest(contextFiles: ReadonlyArray<ContextFile>): FileManifest {
  const existingFiles: string[] = [];
  const dirSet = new Set<string>();

  for (const file of contextFiles) {
    if (file.source === 'workspace') {
      existingFiles.push(file.path);
      const lastSlash = file.path.lastIndexOf('/');
      if (lastSlash > 0) {
        dirSet.add(file.path.substring(0, lastSlash + 1));
      }
    }
  }

  return {
    existingFiles,
    allowedDirectories: Array.from(dirSet).sort(),
  };
}

/**
 * Build the original-content map from workspace context files.
 * Used to resolve MODIFY targets to their current on-disk content.
 */
export function buildOriginalContentMap(contextFiles: ReadonlyArray<ContextFile>): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of contextFiles) {
    if (file.source === 'workspace') {
      map.set(file.path, file.content);
    }
  }
  return map;
}

/**
 * Render the manifest section for inclusion in an LLM prompt.
 */
export function buildManifestSection(manifest: FileManifest): string {
  if (manifest.existingFiles.length === 0 && manifest.allowedDirectories.length === 0) {
    return `## File Manifest (your working scope)
No existing files or directories identified. You may create files in appropriate CHT project directories.`;
  }

  let section = '## File Manifest (known files and directories)\nThese are the files and directories already identified as relevant. You may reference files outside this list if the feature requires it.\n';

  if (manifest.existingFiles.length > 0) {
    section += '\nKnown existing files:\n';
    for (const file of manifest.existingFiles) {
      section += `- ${file}\n`;
    }
  }

  if (manifest.allowedDirectories.length > 0) {
    section += '\nKnown directories:\n';
    for (const dir of manifest.allowedDirectories) {
      section += `- ${dir}\n`;
    }
  }

  return section;
}

/**
 * Fetch MODIFY files that the plan references but weren't in the agent's pre-gathered context.
 * Mutates the supplied workingContextFiles (a local working copy owned by the caller),
 * the originalContentMap, and manifest.existingFiles / allowedDirectories.
 */
export async function fetchMissingModifyFiles(
  plan: PlanItem[],
  readFile: ((path: string) => Promise<string | null>) | undefined,
  workingContextFiles: ContextFile[],
  originalContentMap: Map<string, string>,
  manifest: FileManifest,
): Promise<void> {
  if (!readFile) return;

  const missingModifyItems = plan.filter(
    item => item.action === 'MODIFY' && !originalContentMap.has(item.filePath)
  );

  for (const item of missingModifyItems) {
    console.log(`[Code Gen Lib] Fetching missing MODIFY file: ${item.filePath}`);
    const content = await readFile(item.filePath);
    if (content !== null) {
      workingContextFiles.push({ path: item.filePath, content, source: 'workspace' });
      originalContentMap.set(item.filePath, content);
      manifest.existingFiles.push(item.filePath);
      console.log(`[Code Gen Lib]   Fetched ${item.filePath} (${content.length} chars)`);
      continue;
    }

    // MODIFY target does not exist on disk. The planner intended to update an
    // existing file but the file is not there. Downgrade to CREATE so the
    // per-file prompt, the assertion path, the Beads ticket, and the agent's
    // convertModuleFiles heuristic all agree on the action. Without this
    // mutation, the action silently disagrees across logs and outputs.
    //
    // Safe to mutate in place: `plan` is a local array owned by
    // claude-api/index.ts generate() (parsed fresh from LLM or built from
    // input.failingFiles). No external reference is retained.
    console.log(`[Code Gen Lib]   Downgraded ${item.filePath} from MODIFY to CREATE (no on-disk original)`);
    item.action = 'CREATE';

    // Expand allowed directories for the new CREATE target so the downstream
    // validateAgainstManifest does not flag it as out-of-scope.
    const lastSlash = item.filePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dir = item.filePath.substring(0, lastSlash + 1);
      if (!manifest.allowedDirectories.includes(dir)) {
        manifest.allowedDirectories.push(dir);
      }
    }
  }

  // Expand allowed directories for CREATE items outside current scope
  const dirSet = new Set(manifest.allowedDirectories);
  for (const item of plan) {
    if (item.action === 'CREATE') {
      const lastSlash = item.filePath.lastIndexOf('/');
      if (lastSlash > 0) {
        const dir = item.filePath.substring(0, lastSlash + 1);
        if (!dirSet.has(dir)) {
          dirSet.add(dir);
          manifest.allowedDirectories.push(dir);
          console.log(`[Code Gen Lib]   Expanded scope: ${dir}`);
        }
      }
    }
  }
  manifest.allowedDirectories.sort();
}

/**
 * Post-call validation: check files against manifest and plan.
 * Returns a list of warning strings (empty = all good).
 */
export function validateAgainstManifest(
  files: GeneratedFile[],
  plan: PlanItem[],
  manifest: FileManifest,
): string[] {
  const warnings: string[] = [];

  const existingSet = new Set(manifest.existingFiles);
  const allowedDirs = manifest.allowedDirectories;

  if (allowedDirs.length > 0) {
    for (const file of files) {
      const inExisting = existingSet.has(file.path);
      const inAllowedDir = allowedDirs.some(dir => file.path.startsWith(dir));
      if (!inExisting && !inAllowedDir) {
        warnings.push(`Out-of-scope file: ${file.path} (not in manifest)`);
      }
    }
  }

  if (plan.length > 0) {
    const generatedPaths = new Set(files.map(f => f.path));
    const plannedPaths = new Set(plan.map(p => p.filePath));

    for (const item of plan) {
      if (!generatedPaths.has(item.filePath)) {
        warnings.push(`Planned but not generated: ${item.filePath}`);
      }
    }

    for (const file of files) {
      if (!plannedPaths.has(file.path)) {
        warnings.push(`Generated but not planned: ${file.path}`);
      }
    }
  }

  return warnings;
}
