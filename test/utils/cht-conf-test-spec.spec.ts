import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  deriveContactScenario,
  deriveScenario,
  detectHousePattern,
  extractHouseOptions,
  generateContactFormSpec,
  generateHarnessSpec,
  renderContactFormSpec,
  renderSpec,
  resolveContactSpecPath,
  resolveSpecPath,
} from '../../src/utils/cht-conf-test-spec';
import { XlsformFixDescriptor } from '../../src/utils/xlsform-fix';
import { XlsformBindDiff } from '../../src/types';

const YES_GATE = "selected(../has_delivered, 'yes')";
const PLANTED_GATE = "selected(../has_delivered, 'yes') or selected(../outcome, 'miscarriage')";
const NODESET = '/postnatal_care_service/group_mother_pnc_danger_signs/next_pnc_visit_date';
const FORM = 'postnatal_care_service';

const descriptor = (overrides: Partial<XlsformFixDescriptor> = {}): XlsformFixDescriptor => ({
  version: 1,
  form: FORM,
  edits: [
    { sheet: 'survey', match: { column: 'name', value: 'next_pnc_visit_date' }, set: { column: 'relevant', value: YES_GATE } },
  ],
  expect: { nodeset: NODESET, attrs: { relevant: YES_GATE }, siblingsUnchanged: true },
  rationale: 'restore the delivered-only gate',
  ...overrides,
});

const bindDiff = (overrides: Partial<XlsformBindDiff> = {}): XlsformBindDiff => ({
  nodeset: NODESET,
  before: PLANTED_GATE,
  after: YES_GATE,
  attrs: { relevant: YES_GATE },
  attrsBefore: { relevant: PLANTED_GATE },
  siblingsUnchanged: 9,
  ...overrides,
});

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cht-agent-testspec-'));

describe('cht-conf-test-spec (F7 generation)', () => {
  let root: string;
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  describe('resolveSpecPath — never overwrite a partner spec', () => {
    it('uses test/forms/<form>.spec.js when no spec exists', () => {
      root = mkTmp();
      const res = resolveSpecPath(root, FORM);
      expect(res.relPath).to.equal(path.join('test', 'forms', `${FORM}.spec.js`));
      expect(res.overwriteAvoided).to.equal(false);
    });

    it('falls back to <form>.agent.spec.js when the primary spec already exists', () => {
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      fs.writeFileSync(path.join(formsDir, `${FORM}.spec.js`), '// partner spec\n');
      const res = resolveSpecPath(root, FORM);
      expect(res.relPath).to.equal(path.join('test', 'forms', `${FORM}.agent.spec.js`));
      expect(res.overwriteAvoided).to.equal(true);
    });
  });

  describe('detectHousePattern', () => {
    it('falls back to the canonical pattern when test/forms is empty/missing', () => {
      root = mkTmp();
      const house = detectHousePattern(root);
      expect(house.fromDefault).to.equal(true);
      expect(house.harnessRequire).to.equal('cht-conf-test-harness');
      expect(house.harnessConstruction).to.equal('new TestHarness()');
    });

    it('detects the harness require + construction (with options) from an existing spec', () => {
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      fs.writeFileSync(
        path.join(formsDir, 'community_event.spec.js'),
        [
          "const { expect } = require('chai');",
          "const TestHarness = require('cht-conf-test-harness');",
          "const harness = new TestHarness({ subject: 'chu_id' });",
          "describe('x', () => {});",
        ].join('\n'),
      );
      const house = detectHousePattern(root);
      expect(house.fromDefault).to.equal(false);
      expect(house.harnessRequire).to.equal('cht-conf-test-harness');
      expect(house.harnessConstruction).to.equal("new TestHarness({ subject: 'chu_id' })");
    });

    it('captures a construction with an interior ) (nested call) without truncating', () => {
      // The very common cht-conf idiom: the harness is built with path.resolve(...)
      // in the constructor. A naive `\(([^)]*)\)` stops at the first `)` and
      // truncates the RHS to invalid JS; balanced-paren scanning must keep it whole.
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      const construction = "new TestHarness({ xformFolderPath: path.resolve(__dirname, '../forms/app') })";
      fs.writeFileSync(
        path.join(formsDir, 'delivery.spec.js'),
        [
          "const TestHarness = require('cht-conf-test-harness');",
          `const harness = ${construction};`,
          "describe('x', () => {});",
        ].join('\n'),
      );
      const house = detectHousePattern(root);
      expect(house.fromDefault).to.equal(false);
      expect(house.harnessConstruction).to.equal(construction);
    });

    it('keeps an interior ) that lives inside a string literal', () => {
      // A `)` inside a quoted arg must not be mistaken for the closing paren.
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      const construction = "new TestHarness({ subject: 'chu (id)' })";
      fs.writeFileSync(
        path.join(formsDir, 'weird.spec.js'),
        [
          "const TestHarness = require('cht-conf-test-harness');",
          `const harness = ${construction};`,
        ].join('\n'),
      );
      const house = detectHousePattern(root);
      expect(house.harnessConstruction).to.equal(construction);
    });

    it('skips a non-harness spec (e.g. *.properties.spec.js) and falls back', () => {
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      fs.writeFileSync(
        path.join(formsDir, 'adverse.properties.spec.js'),
        "const { expect } = require('chai');\nconst props = require('../../forms/app/x.properties.json');\n",
      );
      const house = detectHousePattern(root);
      expect(house.fromDefault).to.equal(true);
    });

    it('does not read the destination spec itself for the house pattern', () => {
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      // The only spec present is the destination itself — must be excluded → fallback.
      const destRel = path.join('test', 'forms', `${FORM}.spec.js`);
      fs.writeFileSync(
        path.join(root, destRel),
        "const TestHarness = require('some-other-harness');\nconst harness = new TestHarness({ weird: true });\n",
      );
      const house = detectHousePattern(root, destRel);
      expect(house.fromDefault).to.equal(true);
    });
  });

  describe('extractHouseOptions — HOUSE_OPTIONS literal (F9)', () => {
    it('returns {} for an empty construction', () => {
      expect(extractHouseOptions('new TestHarness()')).to.equal('{}');
    });

    it('returns the object literal verbatim (nested calls survive)', () => {
      expect(
        extractHouseOptions("new TestHarness({ xformFolderPath: path.resolve(__dirname, '../forms/app') })"),
      ).to.equal("{ xformFolderPath: path.resolve(__dirname, '../forms/app') }");
    });

    it('falls back to {} for a non-object-literal arg (identifier)', () => {
      expect(extractHouseOptions('new TestHarness(config)')).to.equal('{}');
    });

    it('falls back to {} for positional (non-object) args', () => {
      expect(extractHouseOptions("new TestHarness('subject', { a: 1 })")).to.equal('{}');
    });

    it('falls back to {} for two positional object-literal args (comma-operator trap)', () => {
      // `{a:1}, {b:2}` starts with `{` and ends with `}`, but it is TWO positional
      // args, not one object literal. A `return (${trimmed})` guard would treat the
      // top-level comma as the comma operator and wrongly accept it, emitting the
      // un-parseable `const HOUSE_OPTIONS = {a:1}, {b:2};` (a bare second declarator
      // → SyntaxError). Must fall back to {} so the emitted spec always parses.
      expect(extractHouseOptions('new TestHarness({a:1}, {b:2})')).to.equal('{}');
      expect(extractHouseOptions('new TestHarness({ a: 1 }, { b: 2 })')).to.equal('{}');
    });

    it('keeps a single object literal with nested objects / interior commas', () => {
      // The fix must not over-reject: an interior comma inside one object literal
      // (or a nested object) is valid and must be returned verbatim.
      expect(extractHouseOptions('new TestHarness({ a: 1, b: 2 })')).to.equal('{ a: 1, b: 2 }');
      expect(extractHouseOptions('new TestHarness({ obj: { nested: 1 } })')).to.equal(
        '{ obj: { nested: 1 } }',
      );
    });
  });

  describe('deriveScenario — from descriptor + bindDiff, not LLM', () => {
    it('takes the corrected relevant + nodeset from the verified bindDiff', () => {
      const scenario = deriveScenario(descriptor(), bindDiff());
      expect(scenario.form).to.equal(FORM);
      expect(scenario.nodeset).to.equal(NODESET);
      expect(scenario.expectedRelevant).to.equal(YES_GATE);
      expect(scenario.previousRelevant).to.equal(PLANTED_GATE);
      expect(scenario.rationale).to.equal('restore the delivered-only gate');
    });
  });

  describe('renderSpec — self-contained harness spec', () => {
    it('embeds the harness require/construction, the nodeset, and the expected relevant', () => {
      const content = renderSpec(deriveScenario(descriptor(), bindDiff()), {
        harnessRequire: 'cht-conf-test-harness',
        harnessConstruction: "new TestHarness({ subject: 'patient_id' })",
        fromDefault: false,
      });
      expect(content).to.include(`require(${JSON.stringify('cht-conf-test-harness')})`);
      // F9: the detected partner options become the HOUSE_OPTIONS literal, spread
      // into a runtime-merged construction (not emitted verbatim as the ctor RHS).
      expect(content).to.include("const HOUSE_OPTIONS = { subject: 'patient_id' };");
      expect(content).to.include('...HOUSE_OPTIONS');
      expect(content).to.include(JSON.stringify(NODESET));
      expect(content).to.include(JSON.stringify(YES_GATE));
      // Harness lifecycle + consoleErrors invariant (house idiom).
      expect(content).to.include('harness.start()');
      expect(content).to.include('harness.stop()');
      expect(content).to.include('expect(harness.consoleErrors).to.be.empty');
      // Deterministic bind assertion against the compiled xml.
      expect(content).to.include('extractBindRelevant');
      expect(content).to.include("forms', 'app'");
      // No workbench imports.
      expect(content).to.not.include("require('../../src");
    });

    it('produces valid JavaScript (parses without syntax errors)', () => {
      const content = renderSpec(deriveScenario(descriptor(), bindDiff()), {
        harnessRequire: 'cht-conf-test-harness',
        harnessConstruction: 'new TestHarness()',
        fromDefault: true,
      });
      // new Function throws on a syntax error; module-level require/describe are
      // just identifiers to the parser, so this validates syntax only.
      expect(() => new Function(content)).to.not.throw();
    });
  });

  // F9: the emitted harness construction must merge sandbox-safe launch args at
  // RUNTIME (cap_drop ALL container → Chromium "No usable sandbox!").
  describe('renderSpec — sandbox-safe launch args (F9)', () => {
    const render = (harnessConstruction: string): string =>
      renderSpec(deriveScenario(descriptor(), bindDiff()), {
        harnessRequire: 'cht-conf-test-harness',
        harnessConstruction,
        fromDefault: false,
      });

    // Evaluate the emitted HOUSE_OPTIONS + merge expression against a stub harness
    // (returned from a stub `require`) to observe the args the harness receives.
    const mergedArgs = (harnessConstruction: string): string[] => {
      const content = render(harnessConstruction);
      let captured: { args?: string[] } = {};
      const HarnessStub = function (this: unknown, opts: { args?: string[] }) {
        captured = opts;
      };
      const req = (id: string): unknown => {
        if (id === 'chai') return { expect };
        if (id === 'node:path') return path;
        if (id === 'node:fs') return fs;
        return HarnessStub; // the harness require (emitted `const TestHarness = ...`)
      };
      // Run the emitted module top-level: require + HOUSE_OPTIONS + harness ctor.
      // `describe`/`before`/etc. are stubbed as no-ops so only the construction runs.
      const noop = (): void => {};
      // eslint-disable-next-line no-new-func
      new Function('require', 'describe', 'it', 'before', 'after', 'beforeEach', 'afterEach', content)(
        req, noop, noop, noop, noop, noop, noop,
      );
      return captured.args ?? [];
    };

    it('emits the two sandbox flags with a doc comment explaining why', () => {
      const content = render('new TestHarness()');
      expect(content).to.include("'--no-sandbox'");
      expect(content).to.include("'--disable-dev-shm-usage'");
      expect(content).to.include('cap_drop ALL'); // the rationale comment
      expect(content).to.include('const HOUSE_OPTIONS = {};');
    });

    it('injects both flags when the partner supplied no args', () => {
      expect(mergedArgs('new TestHarness()')).to.deep.equal([
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ]);
    });

    it('concatenates (never clobbers) partner-supplied args', () => {
      expect(mergedArgs("new TestHarness({ args: ['--lang=en-US'] })")).to.deep.equal([
        '--lang=en-US',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ]);
    });

    it('dedupes --no-sandbox / --disable-dev-shm-usage the partner already set', () => {
      const merged = mergedArgs(
        "new TestHarness({ args: ['--no-sandbox', '--foo', '--disable-dev-shm-usage'] })",
      );
      expect(merged).to.deep.equal(['--no-sandbox', '--foo', '--disable-dev-shm-usage']);
      // exactly one of each sandbox flag
      expect(merged.filter((a) => a === '--no-sandbox')).to.have.length(1);
      expect(merged.filter((a) => a === '--disable-dev-shm-usage')).to.have.length(1);
    });

    it('preserves other partner options while merging args', () => {
      const content = render("new TestHarness({ subject: 'chu_id', args: ['--x'] })");
      expect(content).to.include("const HOUSE_OPTIONS = { subject: 'chu_id', args: ['--x'] };");
      expect(mergedArgs("new TestHarness({ subject: 'chu_id', args: ['--x'] })")).to.deep.equal([
        '--x',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ]);
    });

    it('falls back to {} when the construction arg is not an object literal', () => {
      // an identifier / positional arg cannot be safely spread
      expect(render('new TestHarness(config)')).to.include('const HOUSE_OPTIONS = {};');
      expect(mergedArgs('new TestHarness(config)')).to.deep.equal([
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ]);
    });

    it('keeps the parse guard green with the runtime-merge construction', () => {
      expect(() => new Function(render("new TestHarness({ subject: 'p' })"))).to.not.throw();
      expect(() => new Function(render('new TestHarness()'))).to.not.throw();
    });

    it('emits a PARSEABLE spec for a two-object positional ctor (comma-operator trap)', () => {
      // A partner ctor of `new TestHarness({a:1}, {b:2})` must not leak the second
      // object literal into `const HOUSE_OPTIONS = {a:1}, {b:2};` (un-parseable). It
      // falls back to `{}` and the whole emitted file still parses.
      const content = render('new TestHarness({a:1}, {b:2})');
      expect(content).to.include('const HOUSE_OPTIONS = {};');
      expect(() => new Function(content)).to.not.throw();
      expect(mergedArgs('new TestHarness({a:1}, {b:2})')).to.deep.equal([
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ]);
    });
  });

  describe('generateHarnessSpec — end to end', () => {
    it('emits one spec at the primary path with default pattern on an empty repo', () => {
      root = mkTmp();
      const spec = generateHarnessSpec(descriptor(), bindDiff(), root);
      expect(spec.relPath).to.equal(path.join('test', 'forms', `${FORM}.spec.js`));
      expect(spec.overwriteAvoided).to.equal(false);
      expect(spec.housePatternFromDefault).to.equal(true);
      expect(spec.content).to.include(JSON.stringify(YES_GATE));
    });

    it('never overwrites: writes the agent sibling + detects the house pattern from the partner spec', () => {
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      fs.writeFileSync(
        path.join(formsDir, `${FORM}.spec.js`),
        [
          "const TestHarness = require('cht-conf-test-harness');",
          "const harness = new TestHarness({ subject: 'chu_id' });",
        ].join('\n'),
      );
      const spec = generateHarnessSpec(descriptor(), bindDiff(), root);
      expect(spec.relPath).to.equal(path.join('test', 'forms', `${FORM}.agent.spec.js`));
      expect(spec.overwriteAvoided).to.equal(true);
      expect(spec.housePatternFromDefault).to.equal(false);
      // F9: the partner options survive as HOUSE_OPTIONS, spread + sandbox-merged.
      expect(spec.content).to.include("const HOUSE_OPTIONS = { subject: 'chu_id' };");
    });

    it('emits VALID JS when the partner spec builds the harness with path.resolve(...)', () => {
      // Regression for the greedy-truncation bug: a partner harness constructed
      // with a nested call must not corrupt the generated (agent-sibling) spec.
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      const construction = "new TestHarness({ xformFolderPath: path.resolve(__dirname, '../forms/app') })";
      fs.writeFileSync(
        path.join(formsDir, `${FORM}.spec.js`),
        [
          "const path = require('node:path');",
          "const TestHarness = require('cht-conf-test-harness');",
          `const harness = ${construction};`,
        ].join('\n'),
      );
      const spec = generateHarnessSpec(descriptor(), bindDiff(), root);
      // F9: the nested-call options survive verbatim inside the HOUSE_OPTIONS
      // literal (balanced-paren extraction), then spread into the merged ctor.
      expect(spec.content).to.include(
        "const HOUSE_OPTIONS = { xformFolderPath: path.resolve(__dirname, '../forms/app') };",
      );
      // The whole generated file must parse — the failing case threw here.
      expect(() => new Function(spec.content)).to.not.throw();
    });
  });

  // P5: deterministic contact-form spec generation. cht-conf-test-harness 3.0.15
  // has no loadContactForm, so the contact template is a PLAIN mocha+chai spec
  // whose oracle reads forms/contact/<form>.xml directly (no harness) and asserts
  // the FULL attrs map (value + absence).
  describe('contact-form template (P5)', () => {
    const CONTACT_FORM = 'e_household-create';
    const CONTACT_NODESET = '/data/e_household/is_orphan';
    const CONTACT_GATE = "selected(../age, 'child')";
    const contactDescriptor = (overrides: Partial<XlsformFixDescriptor> = {}): XlsformFixDescriptor => ({
      version: 1,
      form: CONTACT_FORM,
      edits: [
        { sheet: 'survey', match: { column: 'name', value: 'is_orphan' }, set: { column: 'relevant', value: CONTACT_GATE } },
      ],
      expect: { nodeset: CONTACT_NODESET, attrs: { relevant: CONTACT_GATE }, siblingsUnchanged: true },
      rationale: 'gate orphan question on missing parent details',
      ...overrides,
    });
    // The M8-shaped diff: a value attr AND an absence assertion (removed calculate).
    const contactBindDiff = (overrides: Partial<XlsformBindDiff> = {}): XlsformBindDiff => ({
      nodeset: CONTACT_NODESET,
      before: undefined,
      after: CONTACT_GATE,
      attrs: { relevant: CONTACT_GATE, calculate: null },
      attrsBefore: { relevant: null, calculate: 'member_filter = 2' },
      siblingsUnchanged: 4,
      ...overrides,
    });

    describe('resolveContactSpecPath — always the agent house location', () => {
      it('targets <form>.agent.spec.js even when no partner spec exists', () => {
        root = mkTmp();
        const res = resolveContactSpecPath(root, CONTACT_FORM);
        expect(res.relPath).to.equal(path.join('test', 'forms', `${CONTACT_FORM}.agent.spec.js`));
        expect(res.overwriteAvoided).to.equal(false);
      });

      it('never overwrites a partner <form>.spec.js (flags overwriteAvoided)', () => {
        root = mkTmp();
        const formsDir = path.join(root, 'test', 'forms');
        fs.mkdirSync(formsDir, { recursive: true });
        fs.writeFileSync(path.join(formsDir, `${CONTACT_FORM}.spec.js`), '// partner spec\n');
        const res = resolveContactSpecPath(root, CONTACT_FORM);
        expect(res.relPath).to.equal(path.join('test', 'forms', `${CONTACT_FORM}.agent.spec.js`));
        expect(res.overwriteAvoided).to.equal(true);
      });
    });

    describe('deriveContactScenario — full attrs map from the bindDiff', () => {
      it('carries the whole attrs map (value + absence)', () => {
        const scenario = deriveContactScenario(contactDescriptor(), contactBindDiff());
        expect(scenario.form).to.equal(CONTACT_FORM);
        expect(scenario.nodeset).to.equal(CONTACT_NODESET);
        expect(scenario.attrs).to.deep.equal({ relevant: CONTACT_GATE, calculate: null });
        expect(scenario.rationale).to.equal('gate orphan question on missing parent details');
      });
    });

    describe('renderContactFormSpec — self-contained, no harness', () => {
      const content = () => renderContactFormSpec(deriveContactScenario(contactDescriptor(), contactBindDiff()));

      it('does NOT import or use the harness', () => {
        expect(content()).to.not.include('cht-conf-test-harness');
        expect(content()).to.not.include('TestHarness');
        expect(content()).to.not.include('loadContactForm');
        expect(content()).to.not.include('harness.start');
      });

      it('reads the XML under forms/contact (not forms/app)', () => {
        expect(content()).to.include("forms', 'contact'");
        expect(content()).to.not.include("forms', 'app'");
      });

      it('embeds the full attrs map + the target nodeset', () => {
        const c = content();
        expect(c).to.include(JSON.stringify(CONTACT_NODESET));
        expect(c).to.include('EXPECTED_ATTRS');
        expect(c).to.include(JSON.stringify(CONTACT_GATE));
        // the null attr survives as a JS null in the embedded literal
        expect(c).to.match(/"calculate":\s*null/);
      });

      it('has no workbench imports and parses as valid JS', () => {
        expect(content()).to.not.include("require('../../src");
        expect(() => new Function(content())).to.not.throw();
      });

      it('header states it guards a fix and asserts the COMPILED source (regenerate via convert-contact-forms)', () => {
        const c = content();
        expect(c).to.include('convert-contact-forms');
        expect(c).to.match(/COMPILED/i);
      });
    });

    // The oracle must behave as red->green: the pre-fix XML fails it, the post-fix
    // XML passes it. Rather than nest a mocha run, we evaluate the emitted module
    // with stubbed globals (real chai, an fs stub returning a chosen XML), collect
    // its `it` callbacks, and run each — counting pass (no throw) vs fail (throw),
    // exactly what mocha would tally.
    describe('renderContactFormSpec — red->green oracle behaviour', () => {
      const runSpecAgainstXml = (bind: string): { passing: number; failing: number } => {
        const content = renderContactFormSpec(
          deriveContactScenario(contactDescriptor(), contactBindDiff()),
        );
        const xml = `<h:html><model>\n${bind}\n</model></h:html>`;
        const tests: { name: string; cb: () => void }[] = [];
        const req = (id: string): unknown => {
          if (id === 'chai') return { expect };
          if (id === 'node:path') return path;
          if (id === 'node:fs') return { readFileSync: () => xml };
          throw new Error(`unexpected require(${id})`);
        };
        const describeStub = (_name: string, fn: () => void): void => fn();
        const itStub = (name: string, cb: () => void): void => {
          tests.push({ name, cb });
        };
        // eslint-disable-next-line no-new-func
        new Function('require', 'describe', 'it', '__dirname', content)(
          req, describeStub, itStub, '/repo/test/forms',
        );
        let passing = 0;
        let failing = 0;
        for (const t of tests) {
          try {
            t.cb();
            passing += 1;
          } catch {
            failing += 1;
          }
        }
        return { passing, failing };
      };

      it('PASSES (green) against the fixed XML — relevant present, calculate absent', () => {
        const stats = runSpecAgainstXml(
          `<bind nodeset="${CONTACT_NODESET}" relevant="${CONTACT_GATE}" required="true()"/>`,
        );
        expect(stats.failing).to.equal(0);
        expect(stats.passing).to.equal(3); // bind-exists + relevant value + calculate absence
      });

      it('FAILS (red) against the buggy XML — relevant absent, calculate present', () => {
        const stats = runSpecAgainstXml(
          `<bind nodeset="${CONTACT_NODESET}" calculate="member_filter = 2" required="true()"/>`,
        );
        expect(stats.failing).to.equal(2); // relevant missing + calculate still present
        expect(stats.passing).to.equal(1); // the bind still exists
      });
    });

    describe('generateContactFormSpec — end to end', () => {
      it('emits one .agent.spec.js at test/forms with the full attrs oracle', () => {
        root = mkTmp();
        const spec = generateContactFormSpec(contactDescriptor(), contactBindDiff(), root);
        expect(spec.relPath).to.equal(path.join('test', 'forms', `${CONTACT_FORM}.agent.spec.js`));
        expect(spec.overwriteAvoided).to.equal(false);
        expect(spec.content).to.include("forms', 'contact'");
        expect(spec.content).to.not.include('cht-conf-test-harness');
        expect(spec.content).to.include(JSON.stringify(CONTACT_GATE));
      });
    });
  });
});
