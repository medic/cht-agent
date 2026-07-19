import { expect } from 'chai';
import * as sinon from 'sinon';
import {
  validateEnvironment,
  renderCrossFileIssueBanner,
  renderCompileGateSkipBanner,
  renderXlsformBindDiffBanner,
} from '../../src/cli/display-helpers';
import { CrossFileIssue, XlsformApplyResult } from '../../src/types';

/**
 * validateEnvironment gates the research CLI. Its behavior is driven by env:
 * isUsingCLIProvider() reads process.env.LLM_PROVIDER at call time, so we drive
 * the guard's truth table purely through env vars — no module mocking needed.
 *
 * process.exit is stubbed as a no-op, which is safe here: nothing runs after the
 * process.exit(1) call inside validateEnvironment, so a stubbed (non-throwing)
 * exit simply lets the function return without side effects.
 */
describe('cli/display-helpers validateEnvironment', () => {
  let savedProvider: string | undefined;
  let savedApiKey: string | undefined;
  let exitStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let logStub: sinon.SinonStub;

  beforeEach(() => {
    // Snapshot then clear both vars so ambient container env (LLM_PROVIDER /
    // ANTHROPIC_API_KEY) cannot leak into the guard's decision.
    savedProvider = process.env.LLM_PROVIDER;
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    exitStub = sinon.stub(process, 'exit');
    errorStub = sinon.stub(console, 'error');
    logStub = sinon.stub(console, 'log');
  });

  afterEach(() => {
    sinon.restore();
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = savedProvider;
    if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedApiKey;
  });

  it('exits 1 with an ANTHROPIC_API_KEY error when LLM_PROVIDER is unset and no key is set', () => {
    validateEnvironment();
    expect(exitStub.calledOnceWithExactly(1)).to.equal(true);
    expect(errorStub.firstCall.args[0]).to.include('ANTHROPIC_API_KEY');
  });

  it('does not exit when LLM_PROVIDER is unset and ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    validateEnvironment();
    expect(exitStub.called).to.equal(false);
  });

  it('does not exit and logs a claude-cli info line when LLM_PROVIDER=claude-cli and no key is set', () => {
    process.env.LLM_PROVIDER = 'claude-cli';
    validateEnvironment();
    expect(exitStub.called).to.equal(false);
    expect(logStub.firstCall.args[0]).to.include('claude-cli');
  });

  it('still exits 1 when LLM_PROVIDER=anthropic and no key is set (relaxation must not leak)', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    validateEnvironment();
    expect(exitStub.calledOnceWithExactly(1)).to.equal(true);
  });

  it('does not exit when LLM_PROVIDER=claude-cli and ANTHROPIC_API_KEY is also set', () => {
    process.env.LLM_PROVIDER = 'claude-cli';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    validateEnvironment();
    expect(exitStub.called).to.equal(false);
  });
});

describe('renderCrossFileIssueBanner (H.4)', () => {
  it('returns empty string when there are no issues', () => {
    expect(renderCrossFileIssueBanner(undefined)).to.equal('');
    expect(renderCrossFileIssueBanner([])).to.equal('');
  });

  it('groups issues by issueType with per-kind headings', () => {
    const issues: CrossFileIssue[] = [
      { filePath: 'a.ts', issueType: 'compile-error', description: 'TS2304: foo' },
      { filePath: 'b.ts', issueType: 'compile-error', description: 'TS2339: bar' },
      { filePath: '(generation)', issueType: 'partial-completion', description: 'CLI hit cap' },
      { filePath: 'c.ts', issueType: 'plan-adherence-missing', description: 'not modified' },
      { filePath: 'd.ts', issueType: 'plan-adherence-extra', description: 'unplanned' },
      { filePath: '(LLM-flagged)', issueType: 'plan-discovered-missing', description: 'noted' },
    ];
    const banner = renderCrossFileIssueBanner(issues);
    expect(banner).to.include('UNRESOLVED ISSUES REMAIN AFTER REFINEMENT');
    expect(banner).to.include('TypeScript errors remain (2):');
    expect(banner).to.include('Generation ended before completing the plan (1):');
    expect(banner).to.include('Planned files were not modified (1):');
    expect(banner).to.include('Unplanned files were modified (1):');
    expect(banner).to.include('LLM flagged files it thinks are required but not in the approved plan (1):');
    expect(banner).to.include('a.ts: TS2304: foo');
    expect(banner).to.include('b.ts: TS2339: bar');
  });

  it('uses the description field when present and falls back to reason', () => {
    const issues: CrossFileIssue[] = [
      { filePath: 'a.ts', issueType: 'compile-error', description: 'via description' },
      { filePath: 'b.ts', issueType: 'compile-error', reason: 'via reason' },
      { filePath: 'c.ts', issueType: 'compile-error' },
    ];
    const banner = renderCrossFileIssueBanner(issues);
    expect(banner).to.include('a.ts: via description');
    expect(banner).to.include('b.ts: via reason');
    expect(banner).to.include('c.ts: (no detail)');
  });

  it('caps each group at 10 entries with a "+ N more" footer', () => {
    const issues: CrossFileIssue[] = Array.from({ length: 13 }, (_, i) => ({
      filePath: `f${i}.ts`,
      issueType: 'compile-error',
      description: `err ${i}`,
    }));
    const banner = renderCrossFileIssueBanner(issues);
    // 10 visible + 1 footer line
    expect(banner).to.include('f0.ts: err 0');
    expect(banner).to.include('f9.ts: err 9');
    expect(banner).not.to.include('f10.ts: err 10');
    expect(banner).to.include('and 3 more');
  });

  it('routes issues without a recognized issueType under "Other unresolved issues"', () => {
    // Static validators (regex, AST) emit reason/referencedIdentifier but no
    // issueType. Those should still surface, just under the fallback heading.
    const issues: CrossFileIssue[] = [
      { filePath: 'a.ts', referencedIdentifier: 'foo', expectedSource: 'b.ts', reason: 'identifier mismatch' },
    ];
    const banner = renderCrossFileIssueBanner(issues);
    expect(banner).to.include('Other unresolved issues (1):');
    expect(banner).to.include('a.ts: identifier mismatch');
  });
});

describe('renderCompileGateSkipBanner (H.4)', () => {
  it('renders the skip reason and remediation command', () => {
    const banner = renderCompileGateSkipBanner(
      'tsc not available in cht-core workspace',
      '/home/me/cht-core',
    );
    expect(banner).to.include('COMPILE GATE NOT RUN');
    expect(banner).to.include('tsc not available in cht-core workspace');
    expect(banner).to.include('cd /home/me/cht-core && npm install');
    expect(banner).to.include('You may still accept the diff');
  });
});

describe('renderXlsformBindDiffBanner (mission 05)', () => {
  const apply: XlsformApplyResult = {
    form: 'pregnancy_home_visit',
    xlsxPath: '/tmp/s/forms/app/pregnancy_home_visit.xlsx',
    xmlPath: '/tmp/s/forms/app/pregnancy_home_visit.xml',
    xlsxRelPath: 'forms/app/pregnancy_home_visit.xlsx',
    xmlRelPath: 'forms/app/pregnancy_home_visit.xml',
    bindDiff: {
      nodeset: '/data/danger_signs',
      before: "selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')",
      after: "selected(../pregnancy_summary/visit_option, 'yes')",
      attrs: { relevant: "selected(../pregnancy_summary/visit_option, 'yes')" },
      attrsBefore: {
        relevant:
          "selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')",
      },
      siblingsUnchanged: 2,
    },
    sandboxDir: '/tmp/s',
  };

  it('renders the target bind old→new and the sibling-unchanged count', () => {
    const banner = renderXlsformBindDiffBanner(apply);
    expect(banner).to.include('/data/danger_signs');
    expect(banner).to.include('pregnancy_home_visit');
    expect(banner).to.include("or selected(../pregnancy_summary/visit_option, 'miscarriage')"); // before
    expect(banner).to.include('2 sibling top-level group bind(s) unchanged');
    expect(banner).to.match(/OFFLINE conversion/i);
  });

  // P2: an attrs-only fix (removed calculate, no relevant change) renders its
  // real per-attribute delta including the (absent) marker.
  it('renders a per-attribute delta for an attrs-only (calculate removal) fix', () => {
    const attrsOnly: XlsformApplyResult = {
      ...apply,
      bindDiff: {
        nodeset: '/data/f_client/edu',
        before: undefined,
        after: undefined,
        attrs: { calculate: null, relevant: "../hh = 'at_school'" },
        attrsBefore: { calculate: 'member_filter = 2', relevant: "../hh = 'at_school'" },
        siblingsUnchanged: 3,
      },
    };
    const banner = renderXlsformBindDiffBanner(attrsOnly);
    expect(banner).to.include('/data/f_client/edu');
    // calculate: member_filter = 2 → (absent)
    expect(banner).to.match(/calculate: member_filter = 2 → \(absent\)/);
    // relevant unchanged, shown value → value
    expect(banner).to.include("relevant: ../hh = 'at_school' → ../hh = 'at_school'");
    expect(banner).to.include('3 sibling top-level group bind(s) unchanged');
  });

  // P1 (review): the source-of-truth line must follow the artifact's directory —
  // a contact-form fix lives under forms/contact/, not forms/app/.
  it('renders the contact-form source-of-truth path from the apply result', () => {
    const contact: XlsformApplyResult = {
      ...apply,
      form: 'e_household-create',
      xlsxRelPath: 'forms/contact/e_household-create.xlsx',
      xmlRelPath: 'forms/contact/e_household-create.xml',
    };
    const banner = renderXlsformBindDiffBanner(contact);
    expect(banner).to.include('source of truth: forms/contact/e_household-create.xlsx');
    expect(banner).to.not.include('forms/app/');
  });

  it('returns an empty string when there is no XLSForm apply', () => {
    expect(renderXlsformBindDiffBanner(undefined)).to.equal('');
  });
});
