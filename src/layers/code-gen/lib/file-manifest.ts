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
    if (file.source !== 'workspace') continue;
    existingFiles.push(file.path);
    const dir = extractParentDir(file.path);
    if (dir) dirSet.add(dir);
  }
  return {
    existingFiles,
    allowedDirectories: Array.from(dirSet).sort((a, b) => a.localeCompare(b)),
  };
}

function extractParentDir(filePath: string): string | null {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash > 0 ? filePath.substring(0, lastSlash + 1) : null;
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
  section += renderBulletList('Known existing files:', manifest.existingFiles);
  section += renderBulletList('Known directories:', manifest.allowedDirectories);
  return section;
}

function renderBulletList(heading: string, items: ReadonlyArray<string>): string {
  if (items.length === 0) return '';
  return '\n' + heading + '\n' + items.map(item => `- ${item}\n`).join('');
}

export interface FetchMissingModifyFilesOpts {
  plan: PlanItem[];
  readFile: ((path: string) => Promise<string | null>) | undefined;
  workingContextFiles: ContextFile[];
  originalContentMap: Map<string, string>;
  manifest: FileManifest;
}

/**
 * Fetch MODIFY files that the plan references but weren't in the agent's pre-gathered context.
 * Mutates the supplied workingContextFiles (a local working copy owned by the caller),
 * the originalContentMap, and manifest.existingFiles / allowedDirectories.
 */
export async function fetchMissingModifyFiles(opts: FetchMissingModifyFilesOpts): Promise<void> {
  const { plan, readFile, workingContextFiles, originalContentMap, manifest } = opts;
  if (!readFile) return;

  const missingModifyItems = plan.filter(
    item => item.action === 'MODIFY' && !originalContentMap.has(item.filePath)
  );
  for (const item of missingModifyItems) {
    await processMissingModifyItem({ item, readFile, workingContextFiles, originalContentMap, manifest });
  }
  expandAllowedDirsForCreates(plan, manifest);
  manifest.allowedDirectories.sort((a, b) => a.localeCompare(b));
}

async function processMissingModifyItem(args: {
  item: PlanItem;
  readFile: (path: string) => Promise<string | null>;
  workingContextFiles: ContextFile[];
  originalContentMap: Map<string, string>;
  manifest: FileManifest;
}): Promise<void> {
  const { item, readFile, workingContextFiles, originalContentMap, manifest } = args;
  console.log(`[Code Gen Lib] Fetching missing MODIFY file: ${item.filePath}`);
  const content = await readFile(item.filePath);
  if (content !== null) {
    workingContextFiles.push({ path: item.filePath, content, source: 'workspace' });
    originalContentMap.set(item.filePath, content);
    manifest.existingFiles.push(item.filePath);
    console.log(`[Code Gen Lib]   Fetched ${item.filePath} (${content.length} chars)`);
    return;
  }
  // MODIFY target does not exist on disk. Downgrade to CREATE so the per-file
  // prompt, the assertion path, the Beads ticket, and the agent's
  // convertModuleFiles heuristic all agree on the action.
  console.log(`[Code Gen Lib]   Downgraded ${item.filePath} from MODIFY to CREATE (no on-disk original)`);
  item.action = 'CREATE';
  const dir = extractParentDir(item.filePath);
  if (dir && !manifest.allowedDirectories.includes(dir)) {
    manifest.allowedDirectories.push(dir);
  }
}

function expandAllowedDirsForCreates(plan: PlanItem[], manifest: FileManifest): void {
  const dirSet = new Set(manifest.allowedDirectories);
  for (const item of plan) {
    if (item.action !== 'CREATE') continue;
    const dir = extractParentDir(item.filePath);
    if (!dir || dirSet.has(dir)) continue;
    dirSet.add(dir);
    manifest.allowedDirectories.push(dir);
    console.log(`[Code Gen Lib]   Expanded scope: ${dir}`);
  }
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
  return [
    ...checkOutOfScopeFiles(files, manifest),
    ...checkPlanAdherence(files, plan),
  ];
}

function checkOutOfScopeFiles(files: GeneratedFile[], manifest: FileManifest): string[] {
  if (manifest.allowedDirectories.length === 0) return [];
  const existingSet = new Set(manifest.existingFiles);
  return files
    .filter(file => !existingSet.has(file.path) && !manifest.allowedDirectories.some(dir => file.path.startsWith(dir)))
    .map(file => `Out-of-scope file: ${file.path} (not in manifest)`);
}

function checkPlanAdherence(files: GeneratedFile[], plan: PlanItem[]): string[] {
  if (plan.length === 0) return [];
  const generatedPaths = new Set(files.map(f => f.path));
  const plannedPaths = new Set(plan.map(p => p.filePath));
  return [
    ...plan
      .filter(item => !generatedPaths.has(item.filePath))
      .map(item => `Planned but not generated: ${item.filePath}`),
    ...files
      .filter(file => !plannedPaths.has(file.path))
      .map(file => `Generated but not planned: ${file.path}`),
  ];
}
