import { expect } from 'chai';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  clearStaging,
  copyToTarget,
  createStagingDirectory,
  fileExistsInChtCore,
  generateDiffs,
  listChtCoreDirectory,
  readFromChtCore,
  verifyChtCorePath,
  writeToChtCore,
  writeToStaging,
} from '../../src/utils/staging';
import { FileLanguage, FileType, GeneratedFile } from '../../src/types';

const mkFile = (
  relativePath: string,
  content: string,
  action: 'create' | 'modify' = 'create',
  type: FileType = 'source',
  language: FileLanguage = 'typescript',
  description = '',
): GeneratedFile => ({
  relativePath,
  content,
  language,
  type,
  description,
  action,
});

/**
 * staging.ts works with the real filesystem. Tests create scratch directories
 * under os.tmpdir() and clean them up in afterEach so the suite never leaves
 * orphan files behind.
 */
describe('staging.ts (v9a.3)', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-agent-staging-test-'));
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  describe('createStagingDirectory', () => {
    it('creates a directory under os.tmpdir() with the expected prefix', async () => {
      const dir = await createStagingDirectory();
      try {
        expect(dir.startsWith(os.tmpdir())).to.equal(true);
        expect(path.basename(dir)).to.match(/^cht-agent-staging-\d+$/);
        const stat = await fs.stat(dir);
        expect(stat.isDirectory()).to.equal(true);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('writeToStaging', () => {
    it('writes every file in the input array with the given content', async () => {
      const files = [
        mkFile('a.ts', 'export const a = 1;\n'),
        mkFile('nested/b.ts', 'export const b = 2;\n'),
      ];
      const written = await writeToStaging(files, scratch);
      expect(written).to.deep.equal(['a.ts', 'nested/b.ts']);
      expect(await fs.readFile(path.join(scratch, 'a.ts'), 'utf-8'))
        .to.equal('export const a = 1;\n');
      expect(await fs.readFile(path.join(scratch, 'nested/b.ts'), 'utf-8'))
        .to.equal('export const b = 2;\n');
    });

    it('creates intermediate directories as needed', async () => {
      const files = [mkFile('a/b/c/d.ts', 'deep\n')];
      await writeToStaging(files, scratch);
      const stat = await fs.stat(path.join(scratch, 'a/b/c'));
      expect(stat.isDirectory()).to.equal(true);
    });

    it('overwrites a file that already exists at the target path', async () => {
      const target = path.join(scratch, 'file.ts');
      await fs.writeFile(target, 'OLD\n', 'utf-8');
      await writeToStaging([mkFile('file.ts', 'NEW\n')], scratch);
      expect(await fs.readFile(target, 'utf-8')).to.equal('NEW\n');
    });
  });

  describe('writeToChtCore', () => {
    it('writes files into the cht-core path (separate helper from staging)', async () => {
      const written = await writeToChtCore([mkFile('foo.ts', 'foo\n')], scratch);
      expect(written).to.deep.equal(['foo.ts']);
      expect(await fs.readFile(path.join(scratch, 'foo.ts'), 'utf-8')).to.equal('foo\n');
    });
  });

  describe('copyToTarget', () => {
    it('copies every file from staging to target preserving the relative tree', async () => {
      const staging = path.join(scratch, 'staging');
      const target = path.join(scratch, 'cht-core');
      await fs.mkdir(staging, { recursive: true });
      await writeToStaging([
        mkFile('a.ts', 'a\n'),
        mkFile('nested/b.ts', 'b\n'),
      ], staging);

      const copied = await copyToTarget(staging, target);

      expect(copied.sort()).to.deep.equal(['a.ts', path.join('nested', 'b.ts')].sort());
      expect(await fs.readFile(path.join(target, 'a.ts'), 'utf-8')).to.equal('a\n');
      expect(await fs.readFile(path.join(target, 'nested/b.ts'), 'utf-8')).to.equal('b\n');
    });

    it('leaves unrelated files in the target untouched', async () => {
      const staging = path.join(scratch, 'staging');
      const target = path.join(scratch, 'cht-core');
      await fs.mkdir(staging, { recursive: true });
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'untouched.ts'), 'original\n', 'utf-8');
      await writeToStaging([mkFile('staged.ts', 'staged\n')], staging);

      await copyToTarget(staging, target);

      expect(await fs.readFile(path.join(target, 'untouched.ts'), 'utf-8')).to.equal('original\n');
      expect(await fs.readFile(path.join(target, 'staged.ts'), 'utf-8')).to.equal('staged\n');
    });

    it('creates the target directory when it does not already exist', async () => {
      const staging = path.join(scratch, 'staging');
      const target = path.join(scratch, 'new-target', 'deep', 'tree');
      await fs.mkdir(staging, { recursive: true });
      await writeToStaging([mkFile('hello.ts', 'hi\n')], staging);

      await copyToTarget(staging, target);

      expect(await fs.readFile(path.join(target, 'hello.ts'), 'utf-8')).to.equal('hi\n');
    });
  });

  describe('clearStaging', () => {
    it('removes the staging directory and its contents', async () => {
      await writeToStaging([mkFile('a.ts', 'a\n')], scratch);
      await clearStaging(scratch);
      let threw = false;
      try {
        await fs.stat(scratch);
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });

    it('tolerates a missing staging directory (does not throw)', async () => {
      const phantom = path.join(scratch, 'does-not-exist');
      let threw = false;
      try {
        await clearStaging(phantom);
      } catch {
        threw = true;
      }
      expect(threw).to.equal(false);
    });
  });

  describe('verifyChtCorePath', () => {
    it('returns true for an existing directory', async () => {
      expect(await verifyChtCorePath(scratch)).to.equal(true);
    });

    it('returns false for a missing path', async () => {
      expect(await verifyChtCorePath(path.join(scratch, 'missing'))).to.equal(false);
    });

    it('returns false for a path that exists but is a file (not a directory)', async () => {
      const filePath = path.join(scratch, 'a-file.ts');
      await fs.writeFile(filePath, '', 'utf-8');
      expect(await verifyChtCorePath(filePath)).to.equal(false);
    });
  });

  describe('readFromChtCore', () => {
    it('returns content of an existing file relative to the chtCorePath', async () => {
      await fs.writeFile(path.join(scratch, 'foo.ts'), 'foo\n', 'utf-8');
      expect(await readFromChtCore('foo.ts', scratch)).to.equal('foo\n');
    });

    it('returns null for a missing file rather than throwing', async () => {
      expect(await readFromChtCore('ghost.ts', scratch)).to.equal(null);
    });

    it('returns null when the path resolves to a directory (not a file)', async () => {
      await fs.mkdir(path.join(scratch, 'subdir'));
      expect(await readFromChtCore('subdir', scratch)).to.equal(null);
    });
  });

  describe('listChtCoreDirectory', () => {
    it('lists files and directories with trailing slash on directories', async () => {
      await fs.mkdir(path.join(scratch, 'dir'));
      await fs.writeFile(path.join(scratch, 'file.ts'), '', 'utf-8');
      const entries = await listChtCoreDirectory('.', scratch);
      expect(entries.some(e => e.endsWith('file.ts'))).to.equal(true);
      expect(entries.some(e => e.endsWith('dir/'))).to.equal(true);
    });

    it('returns an empty array for a missing directory rather than throwing', async () => {
      const entries = await listChtCoreDirectory('does-not-exist', scratch);
      expect(entries).to.deep.equal([]);
    });
  });

  describe('fileExistsInChtCore', () => {
    it('returns true for an existing file', async () => {
      await fs.writeFile(path.join(scratch, 'x.ts'), '', 'utf-8');
      expect(await fileExistsInChtCore('x.ts', scratch)).to.equal(true);
    });

    it('returns false for a missing file', async () => {
      expect(await fileExistsInChtCore('y.ts', scratch)).to.equal(false);
    });
  });

  describe('generateDiffs', () => {
    it('emits a create-style diff for a staged file that does not exist in target', async () => {
      const staging = path.join(scratch, 'staging');
      const target = path.join(scratch, 'target');
      await fs.mkdir(staging, { recursive: true });
      await fs.mkdir(target, { recursive: true });
      await writeToStaging([mkFile('new.ts', 'one\ntwo\nthree\n')], staging);

      const diffs = await generateDiffs([mkFile('new.ts', 'one\ntwo\nthree\n')], staging, target);

      expect(diffs).to.have.length(1);
      expect(diffs[0].action).to.equal('create');
      expect(diffs[0].diff).to.include('--- /dev/null');
      expect(diffs[0].diff).to.include('+++ b/new.ts');
      // Three additions plus the trailing newline produces +line entries.
      expect(diffs[0].additions).to.be.greaterThan(0);
      expect(diffs[0].deletions).to.equal(0);
    });

    it('emits a modify-style diff when the target file already exists', async () => {
      const staging = path.join(scratch, 'staging');
      const target = path.join(scratch, 'target');
      await fs.mkdir(staging, { recursive: true });
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'edit.ts'), 'a\nb\nc\n', 'utf-8');
      await writeToStaging([mkFile('edit.ts', 'a\nB\nc\n')], staging);

      const diffs = await generateDiffs([mkFile('edit.ts', 'a\nB\nc\n')], staging, target);

      expect(diffs).to.have.length(1);
      expect(diffs[0].action).to.equal('modify');
      expect(diffs[0].diff).to.include('--- a/edit.ts');
      expect(diffs[0].diff).to.include('+++ b/edit.ts');
      // The change is one line, so both additions and deletions are ≥ 1.
      expect(diffs[0].additions).to.be.greaterThan(0);
      expect(diffs[0].deletions).to.be.greaterThan(0);
    });

    it('skips files that are missing from staging (no entry emitted)', async () => {
      const staging = path.join(scratch, 'staging');
      const target = path.join(scratch, 'target');
      await fs.mkdir(staging, { recursive: true });
      await fs.mkdir(target, { recursive: true });
      const diffs = await generateDiffs([mkFile('ghost.ts', 'unused')], staging, target);
      expect(diffs).to.deep.equal([]);
    });
  });
});
