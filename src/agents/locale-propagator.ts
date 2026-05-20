import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GeneratedFile } from '../types';

const TRANSLATIONS_DIR = 'api/resources/translations';
const ENGLISH_FILE = `${TRANSLATIONS_DIR}/messages-en.properties`;

interface PropEntry { key: string; value: string }

function parseProperties(content: string): PropEntry[] {
  const entries: PropEntry[] = [];
  for (const line of content.split('\n')) {
    const entry = parsePropertyLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parsePropertyLine(line: string): PropEntry | null {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  const key = line.substring(0, eq).trim();
  if (!key) return null;
  const value = line.substring(eq + 1).replace(/^\s+/, '');
  return { key, value };
}

function escapeRegex(str: string): string {
  // Canonical MDN regex-metachar escape; the alternation in the character class
  // is required and stays byte-equivalent across releases. NOSONAR
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // NOSONAR
}

function keyExists(content: string, key: string): boolean {
  const re = new RegExp(String.raw`(^|\n)\s*${escapeRegex(key)}\s*=`);
  return re.test(content);
}

/**
 * Insert each new entry at its alphabetical position relative to existing keys.
 * Uses cht-core's `key = value` format (spaces around `=`).
 * If a key is alphabetically greater than every existing key, it lands at the end.
 */
function insertEntriesAlphabetically(content: string, entries: PropEntry[]): string {
  const lines = content.split('\n');
  // Strip a single trailing blank line so insertions land before EOF, not after.
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  for (const entry of entries) insertOneEntry(lines, entry);
  return lines.join('\n') + '\n';
}

function insertOneEntry(lines: string[], entry: PropEntry): void {
  const formatted = `${entry.key} = ${entry.value}`;
  const insertAt = findAlphabeticalSlot(lines, entry.key);
  if (insertAt === -1) lines.push(formatted);
  else lines.splice(insertAt, 0, formatted);
}

function findAlphabeticalSlot(lines: string[], key: string): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const existingKey = line.substring(0, eq).trim();
    if (existingKey > key) return i;
  }
  return -1;
}

/**
 * If messages-en.properties is in the generated batch, find any NEW keys it
 * introduces and append placeholders (with the English value) to the 9 other
 * locale files. Avoids burning LLM calls on translation parity.
 *
 * Returns the input array plus any added GeneratedFile entries for the
 * propagated locale changes.
 */
export async function propagateNewLocaleKeys(
  files: GeneratedFile[],
  chtCorePath: string,
): Promise<GeneratedFile[]> {
  const enFile = files.find(f => f.relativePath === ENGLISH_FILE);
  if (!enFile) return files;
  const newEntries = collectNewEnglishEntries(enFile);
  if (newEntries.length === 0) return files;
  console.log(`[Locale Propagator] Found ${newEntries.length} new key(s) in messages-en.properties`);
  const dir = path.join(chtCorePath, TRANSLATIONS_DIR);
  const dirEntries = await listLocaleDir(dir);
  if (dirEntries === null) return files;
  const propagated = await propagateToAllLocales(dir, dirEntries, newEntries);
  if (propagated.length > 0) {
    console.log(`[Locale Propagator] Auto-propagated to ${propagated.length} locale file(s)`);
  }
  return [...files, ...propagated];
}

async function propagateToAllLocales(
  dir: string,
  dirEntries: string[],
  newEntries: PropEntry[],
): Promise<GeneratedFile[]> {
  const propagated: GeneratedFile[] = [];
  for (const localeFile of dirEntries) {
    const generated = await propagateToLocale(dir, localeFile, newEntries);
    if (generated) propagated.push(generated);
  }
  return propagated;
}

function collectNewEnglishEntries(enFile: GeneratedFile): PropEntry[] {
  const originalEntries = enFile.originalContent ? parseProperties(enFile.originalContent) : [];
  const originalKeys = new Set(originalEntries.map(e => e.key));
  return parseProperties(enFile.content).filter(e => !originalKeys.has(e.key));
}

async function listLocaleDir(dir: string): Promise<string[] | null> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    console.warn(`[Locale Propagator] Could not read ${dir}: ${err}`);
    return null;
  }
}

async function propagateToLocale(
  dir: string,
  localeFile: string,
  newEntries: PropEntry[],
): Promise<GeneratedFile | null> {
  if (!/^messages-\w+\.properties$/.test(localeFile)) return null;
  if (localeFile === 'messages-en.properties') return null;
  const localePath = path.join(dir, localeFile);
  let original: string;
  try {
    original = await fs.readFile(localePath, 'utf-8');
  } catch {
    return null;
  }
  const toAdd = newEntries.filter(e => !keyExists(original, e.key));
  if (toAdd.length === 0) return null;
  return {
    relativePath: `${TRANSLATIONS_DIR}/${localeFile}`,
    content: insertEntriesAlphabetically(original, toAdd),
    originalContent: original,
    language: 'properties',
    type: 'config',
    description: `Auto-propagated ${toAdd.length} new key(s) from messages-en.properties (English values as placeholders for translation)`,
    action: 'modify',
  };
}
