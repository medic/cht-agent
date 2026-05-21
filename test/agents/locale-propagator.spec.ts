import { expect } from 'chai';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { propagateNewLocaleKeys } from '../../src/agents/locale-propagator';
import { GeneratedFile } from '../../src/types';

const mkPropertiesFile = (relativePath: string, content: string, originalContent?: string): GeneratedFile => ({
  relativePath,
  content,
  language: 'properties',
  type: 'config',
  description: '',
  action: originalContent ? 'modify' : 'create',
  ...(originalContent ? { originalContent } : {}),
});

describe('propagateNewLocaleKeys', () => {
  let chtCorePath: string;

  beforeEach(async () => {
    chtCorePath = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-locale-test-'));
    const dir = path.join(chtCorePath, 'api/resources/translations');
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(chtCorePath, { recursive: true, force: true });
  });

  const writeLocale = async (locale: string, content: string): Promise<void> => {
    await fs.writeFile(
      path.join(chtCorePath, 'api/resources/translations', `messages-${locale}.properties`),
      content,
      'utf-8',
    );
  };

  it('propagates new keys to non-en locale files', async () => {
    await writeLocale('en', 'existing.key=old\n');
    await writeLocale('fr', 'existing.key=ancien\n');
    await writeLocale('es', 'existing.key=viejo\n');

    const enFile = mkPropertiesFile(
      'api/resources/translations/messages-en.properties',
      'existing.key=old\nnew.key=new value\n',
      'existing.key=old\n',
    );

    const result = await propagateNewLocaleKeys([enFile], chtCorePath);
    const propagated = result.filter(f => f.relativePath !== enFile.relativePath);

    expect(propagated).to.have.length(2);
    for (const f of propagated) {
      // Batch E (v5): cht-core convention is `key = value` (spaces around =).
      expect(f.content).to.include('new.key = new value');
      expect(f.language).to.equal('properties');
      expect(f.action).to.equal('modify');
    }
  });

  it('skips keys that already exist in a locale (idempotent)', async () => {
    await writeLocale('en', 'existing.key=old\n');
    await writeLocale('fr', 'existing.key=ancien\nnew.key=nouveau\n');

    const enFile = mkPropertiesFile(
      'api/resources/translations/messages-en.properties',
      'existing.key=old\nnew.key=new value\n',
      'existing.key=old\n',
    );

    const result = await propagateNewLocaleKeys([enFile], chtCorePath);
    const propagated = result.filter(f => f.relativePath !== enFile.relativePath);

    // fr already has `new.key`, so nothing to propagate.
    expect(propagated).to.have.length(0);
  });

  it('returns input unchanged when messages-en.properties is not in the batch', async () => {
    const otherFile = mkPropertiesFile(
      'api/resources/translations/messages-fr.properties',
      'foo=bar\n',
    );
    const result = await propagateNewLocaleKeys([otherFile], chtCorePath);
    expect(result).to.have.length(1);
    expect(result[0]).to.equal(otherFile);
  });

  it('handles a missing translations directory gracefully', async () => {
    const enFile = mkPropertiesFile(
      'api/resources/translations/messages-en.properties',
      'existing.key=old\nnew.key=new value\n',
      'existing.key=old\n',
    );
    const result = await propagateNewLocaleKeys([enFile], '/nonexistent/path');
    expect(result).to.have.length(1);
    expect(result[0]).to.equal(enFile);
  });

  it('returns input unchanged when no new keys were added', async () => {
    await writeLocale('en', 'existing.key=old\n');
    await writeLocale('fr', 'existing.key=ancien\n');

    const enFile = mkPropertiesFile(
      'api/resources/translations/messages-en.properties',
      'existing.key=updated value\n', // value changed, no NEW key
      'existing.key=old\n',
    );

    const result = await propagateNewLocaleKeys([enFile], chtCorePath);
    expect(result).to.have.length(1);
    expect(result[0]).to.equal(enFile);
  });

  describe('Batch E hygiene (v5)', () => {
    it('formats new entries with spaces around = (cht-core convention)', async () => {
      await writeLocale('en', 'alpha = first\n');
      await writeLocale('fr', 'alpha = premier\n');

      const enFile = mkPropertiesFile(
        'api/resources/translations/messages-en.properties',
        'alpha = first\nbeta = second\n',
        'alpha = first\n',
      );

      const result = await propagateNewLocaleKeys([enFile], chtCorePath);
      const fr = result.find(f => f.relativePath.endsWith('messages-fr.properties'));
      expect(fr).to.exist;
      // Spaces around = (cht-core convention)
      expect(fr!.content).to.include('beta = second');
      // No no-space form should remain
      expect(fr!.content).to.not.include('beta=second');
    });

    it('inserts new keys alphabetically rather than appending', async () => {
      // 'charlie' should land between 'alpha' and 'delta' alphabetically.
      await writeLocale('en', 'alpha = a\ndelta = d\n');
      await writeLocale('fr', 'alpha = a-fr\ndelta = d-fr\n');

      const enFile = mkPropertiesFile(
        'api/resources/translations/messages-en.properties',
        'alpha = a\ncharlie = c\ndelta = d\n',
        'alpha = a\ndelta = d\n',
      );

      const result = await propagateNewLocaleKeys([enFile], chtCorePath);
      const fr = result.find(f => f.relativePath.endsWith('messages-fr.properties'));
      expect(fr).to.exist;

      const lines = fr!.content.split('\n').filter(Boolean);
      const alphaIdx = lines.findIndex(l => l.startsWith('alpha'));
      const charlieIdx = lines.findIndex(l => l.startsWith('charlie'));
      const deltaIdx = lines.findIndex(l => l.startsWith('delta'));

      expect(alphaIdx).to.be.lessThan(charlieIdx);
      expect(charlieIdx).to.be.lessThan(deltaIdx);
    });
  });
});
