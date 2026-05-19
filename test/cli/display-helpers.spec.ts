import { expect } from 'chai';
import {
  renderCrossFileIssueBanner,
  renderCompileGateSkipBanner,
} from '../../src/cli/display-helpers';
import { CrossFileIssue } from '../../src/types';

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
