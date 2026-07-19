import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compareCompiledSettings,
  compileSettingsOffline,
  deriveSettingsSections,
} from '../../src/utils/compiled-settings';

/**
 * P4 compiled-settings comparator unit tests (pure — no offline compile).
 *
 * The comparator iterates ONLY the compiled document's keys, compares the two
 * bundle-string sections strict `===`, deep-equals objects, and applies the
 * compiled-keys-only rule to `permissions` (ignoring deployed-only server-default
 * permission keys). These fixtures pin exactly those rules.
 */
describe('compiled-settings comparator (P4)', () => {
  // A minimal but representative compiled document: the two minified bundle
  // strings, the tasks.targets object (key order preserved), a scalar, a
  // permissions map, and a top-level schedules object.
  const RULES = 'var t=function(){return[]};module.exports=t;';
  const SUMMARY = 'var cs=function(){return{fields:[]}};module.exports=cs;';
  const compiledBase = (): Record<string, unknown> => ({
    tasks: {
      rules: RULES,
      isDeclarative: false,
      targets: { items: [{ id: 'pnc-followup', type: 'count', goal: 5 }] },
    },
    contact_summary: SUMMARY,
    permissions: { can_edit: ['chw', 'supervisor'], can_view_reports: ['supervisor'] },
    schedules: [{ name: 'pnc', messages: [] }],
  });

  describe('deriveSettingsSections', () => {
    it('task/target own the tasks.rules + tasks.targets + tasks.isDeclarative sections', () => {
      expect(deriveSettingsSections('task', {})).to.deep.equal([
        'tasks.rules',
        'tasks.targets',
        'tasks.isDeclarative',
      ]);
      expect(deriveSettingsSections('target', {})).to.deep.equal([
        'tasks.rules',
        'tasks.targets',
        'tasks.isDeclarative',
      ]);
    });

    it('contact-summary owns the contact_summary section', () => {
      expect(deriveSettingsSections('contact-summary', {})).to.deep.equal(['contact_summary']);
    });

    it('app-settings owns EVERY compiled top-level key (whole-document scope)', () => {
      const compiled = compiledBase();
      expect(deriveSettingsSections('app-settings', compiled)).to.deep.equal(Object.keys(compiled));
    });

    it('throws for an unsupported settings artifact', () => {
      expect(() => deriveSettingsSections('form', {})).to.throw(/unsupported settings artifact/);
    });
  });

  describe('compareCompiledSettings — equal sections', () => {
    it('passes when every owned section is byte-identical (task)', () => {
      const compiled = compiledBase();
      const deployed = compiledBase();
      const { passed, checks } = compareCompiledSettings(
        compiled,
        deployed,
        deriveSettingsSections('task', compiled)
      );
      expect(passed).to.equal(true);
      expect(checks.map((c) => c.path)).to.deep.equal([
        'tasks.rules',
        'tasks.targets',
        'tasks.isDeclarative',
      ]);
      expect(checks.every((c) => c.passed)).to.equal(true);
    });

    it('passes for contact_summary when the bundle string matches', () => {
      const { passed, checks } = compareCompiledSettings(compiledBase(), compiledBase(), [
        'contact_summary',
      ]);
      expect(passed).to.equal(true);
      expect(checks[0].note).to.contain('bundle string identical');
    });
  });

  describe('compareCompiledSettings — unequal sections', () => {
    it('fails a minified bundle string diff with a first-divergence note (no dump)', () => {
      const compiled = compiledBase();
      const deployed = compiledBase();
      (deployed.tasks as Record<string, unknown>).rules = RULES.replace('return[]', 'return[1]');
      const { passed, checks } = compareCompiledSettings(compiled, deployed, ['tasks.rules']);
      expect(passed).to.equal(false);
      const note = checks[0].note ?? '';
      expect(note).to.contain('string differs');
      expect(note).to.contain('first divergence at index');
      // The honest note carries lengths + an index, NEVER the (potentially huge) string.
      expect(note).to.not.contain('module.exports');
    });

    it('reports the first divergent index correctly', () => {
      const { checks } = compareCompiledSettings(
        { contact_summary: 'abcdEF' },
        { contact_summary: 'abcdXY' },
        ['contact_summary']
      );
      expect(checks[0].passed).to.equal(false);
      // 'abcd' matches, index 4 is the first divergence (E vs X).
      expect(checks[0].note).to.contain('first divergence at index 4');
    });

    it('fails a tasks.targets object diff (deep-equal, order-sensitive)', () => {
      const compiled = compiledBase();
      const deployed = compiledBase();
      (deployed.tasks as { targets: { items: { goal: number }[] } }).targets.items[0].goal = 99;
      const { passed, checks } = compareCompiledSettings(compiled, deployed, ['tasks.targets']);
      expect(passed).to.equal(false);
      expect(checks[0].note).to.contain('object differs');
    });

    it('flags a section present in compiled but ABSENT from deployed', () => {
      const compiled = compiledBase();
      const deployed = compiledBase();
      delete deployed.contact_summary;
      const { passed, checks } = compareCompiledSettings(compiled, deployed, ['contact_summary']);
      expect(passed).to.equal(false);
      expect(checks[0].note).to.contain('ABSENT from deployed');
    });
  });

  describe('compareCompiledSettings — permissions compiled-keys-only rule', () => {
    it('IGNORES deployed-only permission keys (server defaults absent from the config source)', () => {
      const compiled = compiledBase();
      const deployed = compiledBase();
      // The deployed instance has EXTRA server-default permission keys the config
      // never declared — these must NOT count as a diff.
      (deployed.permissions as Record<string, unknown>).can_configure = ['admin'];
      (deployed.permissions as Record<string, unknown>).can_edit_profile = ['chw'];
      const { passed, checks } = compareCompiledSettings(compiled, deployed, ['permissions']);
      expect(passed).to.equal(true);
      expect(checks[0].note).to.contain('compiled permission key(s) match');
    });

    it('FAILS when a COMPILED permission key differs on the deployed side', () => {
      const compiled = compiledBase();
      const deployed = compiledBase();
      (deployed.permissions as Record<string, string[]>).can_edit = ['chw']; // supervisor dropped
      const { passed, checks } = compareCompiledSettings(compiled, deployed, ['permissions']);
      expect(passed).to.equal(false);
      expect(checks[0].note).to.contain('can_edit');
    });
  });

  // compileSettingsOffline is proven end-to-end by the orchestrator's live smoke
  // (it needs the config's installed node_modules for webpack to resolve
  // cht-nootils/dayjs — no CI-safe fixture carries one). Here we only pin the
  // fail-closed prerequisite check, which needs no compile.
  describe('compileSettingsOffline — fail-closed prerequisites', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-compile-src-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('throws a clear, prerequisite-naming error when node_modules is absent', async () => {
      try {
        await compileSettingsOffline(dir);
        expect.fail('expected compileSettingsOffline to reject without node_modules');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).to.contain('node_modules is missing');
        expect(message).to.contain('npm ci');
      }
    });
  });

  describe('compareCompiledSettings — app-settings whole-document scope', () => {
    it('ignores deployed-only TOP-LEVEL keys (the ~17 server-injected defaults)', () => {
      const compiled = compiledBase();
      const deployed = compiledBase();
      // Server injects top-level defaults the compiler never produced.
      deployed.locale = 'en';
      deployed.date_format = 'D MMM YYYY';
      deployed.public_access = false;
      const sections = deriveSettingsSections('app-settings', compiled);
      const { passed, checks } = compareCompiledSettings(compiled, deployed, sections);
      expect(passed).to.equal(true);
      // The comparator only iterated the compiled keys — not the injected ones.
      expect(checks.map((c) => c.path)).to.not.include('locale');
      expect(checks.map((c) => c.path)).to.deep.equal(Object.keys(compiled));
    });

    it('FAILS when a compiler-owned top-level section differs (whole-doc scope catches it)', () => {
      const compiled = compiledBase();
      const deployed = compiledBase();
      (deployed.schedules as { name: string }[])[0].name = 'anc';
      const sections = deriveSettingsSections('app-settings', compiled);
      const { passed, checks } = compareCompiledSettings(compiled, deployed, sections);
      expect(passed).to.equal(false);
      const scheduleCheck = checks.find((c) => c.path === 'schedules');
      expect(scheduleCheck?.passed).to.equal(false);
    });
  });
});
