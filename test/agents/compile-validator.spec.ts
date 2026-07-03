/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import * as util from 'node:util';

const proxyquire = require('proxyquire').noCallThru();

/**
 * Build an execFile stub honoring util.promisify.custom. Each key in
 * `responses` is matched as a prefix of `${cmd} ${args.join(' ')}`; values are
 * either { stdout } (success), { error, stdout? } (rejection with optional
 * stdout — like tsc's "errors-on-stderr-via-exit-code" pattern), or
 * { code: 'ENOENT' } for spawn-level failures.
 */
const stubExecFile = (
  responses: Record<string, { stdout?: string; error?: Error & { stdout?: string; code?: string }; code?: string }>,
) => {
  const fn = (_cmd: string, _args: string[], _opts: object, cb: (e: Error | null, s: string, t: string) => void) => cb(null, '', '');
  (fn as unknown as Record<symbol, unknown>)[util.promisify.custom] = (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`;
    for (const k of Object.keys(responses)) {
      if (key.startsWith(k)) {
        const r = responses[k];
        if (r.error) return Promise.reject(r.error);
        if (r.code === 'ENOENT') {
          const err = new Error('spawn ENOENT') as Error & { code: string };
          err.code = 'ENOENT';
          return Promise.reject(err);
        }
        return Promise.resolve({ stdout: r.stdout ?? '', stderr: '' });
      }
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  };
  return fn;
};

const stubReaddir = (tree: Record<string, Array<{ name: string; isDirectory?: boolean }>>) => {
  return async (dir: string) => {
    const entries = tree[dir] ?? [];
    return entries.map(e => ({
      name: e.name,
      isFile: () => !e.isDirectory,
      isDirectory: () => !!e.isDirectory,
    }));
  };
};

const loadValidator = (
  execResponses: Record<string, { stdout?: string; error?: Error & { stdout?: string; code?: string }; code?: string }>,
  tree: Record<string, Array<{ name: string; isDirectory?: boolean }>> = {},
) => {
  return proxyquire('../../src/agents/compile-validator', {
    'node:child_process': { execFile: stubExecFile(execResponses) },
    'node:fs/promises': { readdir: stubReaddir(tree) },
  });
};

describe('compileCheck (H.1)', () => {
  afterEach(() => sinon.restore());

  it('returns passed:true with skipped:true when no tsconfig is discovered', async () => {
    const v = loadValidator({}, { '/cht-core': [] });
    const result = await v.compileCheck('/cht-core');
    expect(result.passed).to.equal(true);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/No tsconfig/);
    expect(result.issues).to.deep.equal([]);
  });

  it('returns passed:true on clean tsc output', async () => {
    const v = loadValidator(
      { 'npx --no-install tsc --noEmit -p': { stdout: '' } },
      { '/cht-core': [{ name: 'tsconfig.json' }] },
    );
    const result = await v.compileCheck('/cht-core');
    expect(result.passed).to.equal(true);
    expect(result.issues).to.deep.equal([]);
    expect(result.skipped).to.not.equal(true);
    expect(result.tsconfigsRun).to.have.length(1);
  });

  it('parses tsc error output into compile-error CrossFileIssues', async () => {
    const tscError = new Error('tsc exited with code 1') as Error & { stdout: string };
    tscError.stdout = [
      "webapp/src/ts/services/foo.ts(12,5): error TS2304: Cannot find name 'BarService'.",
      "webapp/src/ts/modules/foo.component.ts(8,10): error TS2339: Property 'baz' does not exist on type 'Foo'.",
    ].join('\n');

    const v = loadValidator(
      { 'npx --no-install tsc --noEmit -p': { error: tscError } },
      { '/cht-core': [{ name: 'tsconfig.json' }] },
    );
    const result = await v.compileCheck('/cht-core');
    expect(result.passed).to.equal(false);
    expect(result.issues).to.have.length(2);
    const first = result.issues[0];
    expect(first.filePath).to.equal('webapp/src/ts/services/foo.ts');
    expect(first.issueType).to.equal('compile-error');
    expect(first.description).to.match(/TS2304/);
    expect(first.description).to.match(/line 12/);
  });

  it('degrades to skipped:true when tsc is not available (ENOENT)', async () => {
    const v = loadValidator(
      { 'npx --no-install tsc --noEmit -p': { code: 'ENOENT' } },
      { '/cht-core': [{ name: 'tsconfig.json' }] },
    );
    const result = await v.compileCheck('/cht-core');
    expect(result.passed).to.equal(true);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/tsc not available/);
  });

  it('discovers tsconfigs in subdirectories and runs each', async () => {
    const v = loadValidator(
      { 'npx --no-install tsc --noEmit -p': { stdout: '' } },
      {
        '/cht-core': [
          { name: 'tsconfig.json' },
          { name: 'webapp', isDirectory: true },
          { name: 'api', isDirectory: true },
          { name: 'node_modules', isDirectory: true }, // must be skipped
        ],
        '/cht-core/webapp': [{ name: 'tsconfig.json' }],
        '/cht-core/api': [{ name: 'tsconfig.json' }, { name: 'tsconfig.test.json' }],
      },
    );
    const result = await v.compileCheck('/cht-core');
    expect(result.tsconfigsRun).to.have.length(4); // root + webapp + api + api/test
    expect(result.tsconfigsRun).to.include('tsconfig.json');
    expect(result.tsconfigsRun).to.include('webapp/tsconfig.json');
    expect(result.tsconfigsRun).to.include('api/tsconfig.json');
    expect(result.tsconfigsRun).to.include('api/tsconfig.test.json');
  });

  it('deduplicates errors reported by multiple overlapping tsconfigs', async () => {
    const tscError = new Error('tsc failed') as Error & { stdout: string };
    tscError.stdout = "shared/foo.ts(1,1): error TS9999: Same error.";

    // Both tsconfigs report the same error. Dedup leaves a single issue.
    const v = loadValidator(
      { 'npx --no-install tsc --noEmit -p': { error: tscError } },
      {
        '/cht-core': [
          { name: 'tsconfig.json' },
          { name: 'webapp', isDirectory: true },
        ],
        '/cht-core/webapp': [{ name: 'tsconfig.json' }],
      },
    );
    const result = await v.compileCheck('/cht-core');
    expect(result.issues).to.have.length(1);
    expect(result.issues[0].filePath).to.equal('shared/foo.ts');
  });

  it('filters warnings (TS lines without "error" keyword)', async () => {
    const tscError = new Error('tsc failed') as Error & { stdout: string };
    tscError.stdout = [
      "foo.ts(1,1): warning TS5000: This is a warning.",
      "foo.ts(2,2): error TS2304: This is an error.",
    ].join('\n');

    const v = loadValidator(
      { 'npx --no-install tsc --noEmit -p': { error: tscError } },
      { '/cht-core': [{ name: 'tsconfig.json' }] },
    );
    const result = await v.compileCheck('/cht-core');
    expect(result.issues).to.have.length(1);
    expect(result.issues[0].description).to.match(/TS2304/);
    expect(result.issues[0].description).to.not.match(/warning|TS5000/);
  });

  it('captures the primary line of a multi-line error block (continuation lines ignored)', async () => {
    const tscError = new Error('tsc failed') as Error & { stdout: string };
    tscError.stdout = [
      "foo.ts(1,1): error TS2322: Type 'X' is not assignable to type 'Y'.",
      "  Property 'a' is missing in type 'X' but required in type 'Y'.",
      "bar.ts(2,2): error TS2304: Cannot find name 'Baz'.",
    ].join('\n');

    const v = loadValidator(
      { 'npx --no-install tsc --noEmit -p': { error: tscError } },
      { '/cht-core': [{ name: 'tsconfig.json' }] },
    );
    const result = await v.compileCheck('/cht-core');
    // The continuation line ("  Property 'a' is missing...") starts with whitespace
    // and does NOT match the regex; only the two primary error lines surface.
    expect(result.issues).to.have.length(2);
    expect(result.issues[0].description).to.match(/TS2322/);
    expect(result.issues[1].description).to.match(/TS2304/);
  });

  it('normalizes absolute paths emitted by tsc to chtCorePath-relative paths', async () => {
    const tscError = new Error('tsc failed') as Error & { stdout: string };
    tscError.stdout = "/cht-core/webapp/src/foo.ts(5,5): error TS2304: Cannot find name 'X'.";

    const v = loadValidator(
      { 'npx --no-install tsc --noEmit -p': { error: tscError } },
      { '/cht-core': [{ name: 'tsconfig.json' }] },
    );
    const result = await v.compileCheck('/cht-core');
    expect(result.issues[0].filePath).to.equal('webapp/src/foo.ts');
  });
});
