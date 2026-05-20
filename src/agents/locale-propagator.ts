import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GeneratedFile } from '../types';

const TRANSLATIONS_DIR = 'api/resources/translations';
const ENGLISH_FILE = `${TRANSLATIONS_DIR}/messages-en.properties`;

interface PropEntry { key: string; value: string }

function parseProperties(content: string): PropEntry[] {
  const entries: PropEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.substring(0, eq).trim();
    const value = line.substring(eq + 1).replace(/^\s+/, '');
    if (key) entries.push({ key, value });
  }
  return entries;
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

  for (const entry of entries) {
    const formatted = `${entry.key} = ${entry.value}`;
    let inserted = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const existingKey = line.substring(0, eq).trim();
      if (existingKey > entry.key) {
        lines.splice(i, 0, formatted);
        inserted = true;
        break;
      }
    }
    if (!inserted) lines.push(formatted);
  }

  return lines.join('\n') + '\n';
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

  const originalEntries = enFile.originalContent ? parseProperties(enFile.originalContent) : [];
  const originalKeys = new Set(originalEntries.map(e => e.key));
  const newEntries = parseProperties(enFile.content).filter(e => !originalKeys.has(e.key));

  if (newEntries.length === 0) return files;

  console.log(`[Locale Propagator] Found ${newEntries.length} new key(s) in messages-en.properties`);

  const dir = path.join(chtCorePath, TRANSLATIONS_DIR);
  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(dir);
  } catch (err) {
    console.warn(`[Locale Propagator] Could not read ${dir}: ${err}`);
    return files;
  }

  const propagated: GeneratedFile[] = [];

  for (const localeFile of dirEntries) {
    if (!/^messages-\w+\.properties$/.test(localeFile)) continue;
    if (localeFile === 'messages-en.properties') continue;

    const localePath = path.join(dir, localeFile);
    let original: string;
    try {
      original = await fs.readFile(localePath, 'utf-8');
    } catch {
      continue;
    }

    const toAdd = newEntries.filter(e => !keyExists(original, e.key));
    if (toAdd.length === 0) continue;

    const updated = insertEntriesAlphabetically(original, toAdd);

    propagated.push({
      relativePath: `${TRANSLATIONS_DIR}/${localeFile}`,
      content: updated,
      originalContent: original,
      language: 'properties',
      type: 'config',
      description: `Auto-propagated ${toAdd.length} new key(s) from messages-en.properties (English values as placeholders for translation)`,
      action: 'modify',
    });
  }

  if (propagated.length > 0) {
    console.log(`[Locale Propagator] Auto-propagated to ${propagated.length} locale file(s)`);
  }

  return [...files, ...propagated];
}
