import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  deriveScenario,
  detectHousePattern,
  generateHarnessSpec,
  renderSpec,
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
  expect: { nodeset: NODESET, relevant: YES_GATE, siblingsUnchanged: true },
  rationale: 'restore the delivered-only gate',
  ...overrides,
});

const bindDiff = (overrides: Partial<XlsformBindDiff> = {}): XlsformBindDiff => ({
  nodeset: NODESET,
  before: PLANTED_GATE,
  after: YES_GATE,
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
      expect(content).to.include("new TestHarness({ subject: 'patient_id' })");
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
      expect(spec.content).to.include("new TestHarness({ subject: 'chu_id' })");
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
      expect(spec.content).to.include(construction);
      // The whole generated file must parse — the failing case threw here.
      expect(() => new Function(spec.content)).to.not.throw();
    });
  });
});
