import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  artifactNeedsCompile,
  buildSpecRepairBrief,
  testGenMaxRepairs,
  testGenVerifyEnabled,
  verifyGeneratedSpecs,
} from '../../../src/layers/test-gen/lib/verify';
import { GeneratedFile } from '../../../src/types';
import { runTier2 } from '../../../src/utils/cht-conf-tier2';
import { runOfflineCompile } from '../../../src/utils/cht-conf-runner';

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cht-agent-tgv-'));

/** A config repo the harness-runnable check accepts. */
const scaffoldConfigRoot = (): string => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', '.bin', 'mocha'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'cht-conf-test-harness'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks.js'), 'buggy();\n');
  return root;
};

const genFile = (relativePath: string, content: string, original?: string): GeneratedFile => ({
  relativePath,
  content,
  language: 'javascript',
  type: 'test',
  description: 'test fixture',
  action: original === undefined ? 'create' : 'modify',
  ...(original !== undefined ? { originalContent: original } : {}),
});

const SPEC = genFile('test/tasks/thing.agent.spec.js', '// generated spec\n');
const FIX = genFile('tasks.js', 'fixed();\n', 'buggy();\n');

/** A runTier2 stub that returns queued results and records each sandbox's tasks.js. */
const makeTier2Fn = (results: Array<{ passed: boolean; tail?: string }>) => {
  const calls: Array<{ configRoot: string; qaSpecs?: string[]; fixContent: string }> = [];
  const fn = (async (options: Parameters<typeof runTier2>[0]) => {
    const next = results[Math.min(calls.length, results.length - 1)];
    calls.push({
      configRoot: options.configRoot,
      ...(options.qaSpecs ? { qaSpecs: options.qaSpecs } : {}),
      fixContent: fs.readFileSync(path.join(options.configRoot, 'tasks.js'), 'utf8'),
    });
    return { ran: true, passed: next.passed, outputTail: next.tail ?? '', specs: options.qaSpecs ?? [] };
  }) as typeof runTier2;
  return { fn, calls };
};

describe('test-gen verification (red→green proof for generated specs)', () => {
  let roots: string[] = [];
  const track = (r: string): string => { roots.push(r); return r; };
  afterEach(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
    roots = [];
    delete process.env.TEST_GEN_VERIFY;
    delete process.env.TEST_GEN_MAX_REPAIRS;
  });

  describe('flag + budget parsing', () => {
    it('TEST_GEN_VERIFY gates on 1/true, default off', () => {
      expect(testGenVerifyEnabled()).to.equal(false);
      process.env.TEST_GEN_VERIFY = '1';
      expect(testGenVerifyEnabled()).to.equal(true);
      process.env.TEST_GEN_VERIFY = 'true';
      expect(testGenVerifyEnabled()).to.equal(true);
      process.env.TEST_GEN_VERIFY = '0';
      expect(testGenVerifyEnabled()).to.equal(false);
    });

    it('TEST_GEN_MAX_REPAIRS defaults to 2 and clamps 0–5', () => {
      expect(testGenMaxRepairs()).to.equal(2);
      process.env.TEST_GEN_MAX_REPAIRS = '4';
      expect(testGenMaxRepairs()).to.equal(4);
      process.env.TEST_GEN_MAX_REPAIRS = '99';
      expect(testGenMaxRepairs()).to.equal(5);
      process.env.TEST_GEN_MAX_REPAIRS = '-3';
      expect(testGenMaxRepairs()).to.equal(0);
    });

    it('artifactNeedsCompile: settings artifacts only', () => {
      expect(artifactNeedsCompile('task')).to.equal(true);
      expect(artifactNeedsCompile('contact-summary')).to.equal(true);
      expect(artifactNeedsCompile('form')).to.equal(false);
      expect(artifactNeedsCompile(undefined)).to.equal(false);
    });
  });

  describe('verifyGeneratedSpecs', () => {
    it('proves red→green: RED fails on pre-fix sources, GREEN passes with the fix', async () => {
      const root = track(scaffoldConfigRoot());
      const tier2 = makeTier2Fn([
        { passed: false, tail: '1 failing\nAssertionError: expected yes to equal no' },
        { passed: true, tail: '3 passing' },
      ]);
      const verdict = await verifyGeneratedSpecs({
        configRoot: root, specFiles: [SPEC], fixFiles: [FIX],
        needsCompile: false, runTier2Fn: tier2.fn,
      });
      expect(verdict).to.include({ ran: true, verified: true, red: true, green: true });
      // The RED run saw the PRE-FIX tasks.js, the GREEN run the fixed one.
      expect(tier2.calls[0].fixContent).to.equal('buggy();\n');
      expect(tier2.calls[1].fixContent).to.equal('fixed();\n');
      // Both runs pinned exactly the generated spec, in a sandbox (not the mount).
      expect(tier2.calls[0].qaSpecs).to.deep.equal([SPEC.relativePath]);
      expect(tier2.calls[0].configRoot).to.not.equal(root);
    });

    it('unproven when the specs PASS pre-fix (vacuous — cannot detect the bug)', async () => {
      const root = track(scaffoldConfigRoot());
      const tier2 = makeTier2Fn([{ passed: true, tail: '3 passing' }]);
      const verdict = await verifyGeneratedSpecs({
        configRoot: root, specFiles: [SPEC], fixFiles: [FIX],
        needsCompile: false, runTier2Fn: tier2.fn,
      });
      expect(verdict.verified).to.equal(false);
      expect(verdict.red).to.equal(false);
      expect(verdict.reason).to.match(/PASS against the PRE-FIX/);
      expect(tier2.calls).to.have.property('length', 1); // GREEN never attempted
    });

    it('unproven when the RED run crashes environmentally (browser, not assertions)', async () => {
      const root = track(scaffoldConfigRoot());
      const tier2 = makeTier2Fn([{ passed: false, tail: 'No usable sandbox!' }]);
      const verdict = await verifyGeneratedSpecs({
        configRoot: root, specFiles: [SPEC], fixFiles: [FIX],
        needsCompile: false, runTier2Fn: tier2.fn,
      });
      expect(verdict.verified).to.equal(false);
      expect(verdict.reason).to.match(/environmentally/);
    });

    it('unproven when the specs FAIL with the fix applied (spec contradicts the fix)', async () => {
      const root = track(scaffoldConfigRoot());
      const tier2 = makeTier2Fn([
        { passed: false, tail: '1 failing' },
        { passed: false, tail: 'AssertionError: expected yes to equal no' },
      ]);
      const verdict = await verifyGeneratedSpecs({
        configRoot: root, specFiles: [SPEC], fixFiles: [FIX],
        needsCompile: false, runTier2Fn: tier2.fn,
      });
      expect(verdict.verified).to.equal(false);
      expect(verdict).to.include({ red: true, green: false });
      expect(verdict.reason).to.match(/FAIL with the fix applied/);
    });

    it('needsCompile: compiles before each side; a failed pre-fix compile is unproven', async () => {
      const root = track(scaffoldConfigRoot());
      const compileCalls: string[] = [];
      const compileFn = (async (o: { configPath: string }) => {
        compileCalls.push(fs.readFileSync(path.join(o.configPath, 'tasks.js'), 'utf8'));
        return { exitCode: 0, output: '', timedOut: false };
      }) as typeof runOfflineCompile;
      const tier2 = makeTier2Fn([{ passed: false, tail: '1 failing' }, { passed: true, tail: '2 passing' }]);
      const verdict = await verifyGeneratedSpecs({
        configRoot: root, specFiles: [SPEC], fixFiles: [FIX],
        needsCompile: true, runTier2Fn: tier2.fn, compileFn,
      });
      expect(verdict.verified).to.equal(true);
      expect(compileCalls).to.deep.equal(['buggy();\n', 'fixed();\n']); // pre-fix then fixed

      const failCompile = (async () => ({ exitCode: 1, output: 'webpack exploded', timedOut: false })) as typeof runOfflineCompile;
      const verdict2 = await verifyGeneratedSpecs({
        configRoot: root, specFiles: [SPEC], fixFiles: [FIX],
        needsCompile: true, runTier2Fn: tier2.fn, compileFn: failCompile,
      });
      expect(verdict2.verified).to.equal(false);
      expect(verdict2.reason).to.match(/pre-fix offline compile failed/);
    });

    it('honest self-skips: no specs; non-spec output; harness not runnable', async () => {
      const root = track(scaffoldConfigRoot());
      const tier2 = makeTier2Fn([{ passed: false }]);
      const none = await verifyGeneratedSpecs({
        configRoot: root, specFiles: [], fixFiles: [FIX], needsCompile: false, runTier2Fn: tier2.fn,
      });
      expect(none).to.include({ ran: false, verified: false });

      const nonSpec = await verifyGeneratedSpecs({
        configRoot: root, specFiles: [genFile('tests/unit/thing.js', '//')], fixFiles: [FIX],
        needsCompile: false, runTier2Fn: tier2.fn,
      });
      expect(nonSpec.ran).to.equal(false);
      expect(nonSpec.reason).to.match(/non-spec files/);

      const bare = track(mkTmp()); // no mocha/harness
      const noHarness = await verifyGeneratedSpecs({
        configRoot: bare, specFiles: [SPEC], fixFiles: [FIX], needsCompile: false, runTier2Fn: tier2.fn,
      });
      expect(noHarness.ran).to.equal(false);
      expect(noHarness.reason).to.match(/mocha|harness/i);
    });
  });

  describe('buildSpecRepairBrief', () => {
    it('carries the verdict, the failing tails, and the fix-is-verified rule', () => {
      const brief = buildSpecRepairBrief({
        ran: true, verified: false, red: false, repairs: 0,
        reason: 'specs PASS against the PRE-FIX sources',
        redTail: 'AssertionError: expected 3 passing',
      });
      expect(brief).to.match(/NOT proven/);
      expect(brief).to.match(/PRE-FIX sources/);
      expect(brief).to.match(/Do NOT change it/);
      expect(brief).to.match(/Regenerate ONLY the spec file/);
    });
  });
});
