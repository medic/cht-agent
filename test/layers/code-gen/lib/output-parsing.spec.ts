import { expect } from 'chai';
import { parseSingleFileContent, applySearchReplace, PROSE_PATTERN } from '../../../../src/layers/code-gen/lib/output-parsing';

describe('parseSingleFileContent', () => {
  describe('trailing newline preservation (C1)', () => {
    it('should append a trailing newline when content is non-empty', () => {
      expect(parseSingleFileContent('export const x = 1;')).to.equal('export const x = 1;\n');
    });

    it('should preserve a trailing newline that was already present', () => {
      expect(parseSingleFileContent('export const x = 1;\n')).to.equal('export const x = 1;\n');
    });

    it('should strip surrounding whitespace but re-add a single trailing newline', () => {
      expect(parseSingleFileContent('  export const x = 1;  \n\n')).to.equal('export const x = 1;\n');
    });

    it('should preserve emptiness for empty input', () => {
      expect(parseSingleFileContent('')).to.equal('');
    });

    it('should preserve emptiness when input is only whitespace', () => {
      expect(parseSingleFileContent('   \n   ')).to.equal('');
    });

    it('should strip markdown code fences and still end with a single newline', () => {
      const input = '```typescript\nexport const x = 1;\n```';
      expect(parseSingleFileContent(input)).to.equal('export const x = 1;\n');
    });

    it('should strip the FILE delimiter format and still end with a single newline', () => {
      const input = '=== FILE: src/x.ts ===\nPURPOSE: A test\n--- CONTENT START ---\nexport const x = 1;\n--- CONTENT END ---';
      expect(parseSingleFileContent(input)).to.equal('export const x = 1;\n');
    });
  });
});

describe('applySearchReplace (whitespace-tolerant fallback)', () => {
  it('applies an exact whole-line match directly', () => {
    const original = 'alpha\nbeta\ngamma\n';
    const result = applySearchReplace(original, [{ search: 'beta', replace: 'BETA' }]);
    expect(result).to.equal('alpha\nBETA\ngamma\n');
  });

  it('applies a boundary-aligned match via the normalized fallback', () => {
    // Trailing whitespace on the target line defeats the exact match and forces
    // the normalized fallback; the match is line-aligned, so it applies cleanly.
    const original = 'line one\nold code   \nline three\n';
    const result = applySearchReplace(original, [{ search: 'old code\nline three', replace: 'NEW BODY' }]);
    expect(result).to.not.equal(null);
    expect(result).to.contain('line one');
    expect(result).to.contain('NEW BODY');
    expect(result).to.not.contain('old code');
  });

  it('rejects a mid-line normalized match instead of corrupting the line prefix', () => {
    // Exact match fails (embedded tab) and the normalized match lands mid-line
    // ('y = 2;' inside 'const x = 1; const y = 2;'). The old slice logic dropped
    // the 'const x = 1; const ' prefix; the fix rejects it (returns null).
    const original = 'const x = 1; const y = 2;\t\nnext line\n';
    const result = applySearchReplace(original, [{ search: 'y = 2;\nnext line', replace: 'REPLACED' }]);
    expect(result).to.equal(null);
  });
});

describe('PROSE_PATTERN', () => {
  it('still classifies prose vs non-prose (behavior preserved after the S8786 fix)', () => {
    expect(PROSE_PATTERN.test('The quick brown fox')).to.be.true;
    expect(PROSE_PATTERN.test('Ab  c')).to.be.true; // multi-space still matches
    expect(PROSE_PATTERN.test('Ab')).to.be.false; // no whitespace+word
    expect(PROSE_PATTERN.test('a lowercase start')).to.be.false; // no leading [A-Z][a-z]
  });

  it('runs in linear time on a long whitespace run (S8786)', () => {
    // Quadratic on the old `.*\s+\w` (the `.*` overlapped `\s+`); a capitalized
    // start followed by a long whitespace run with no trailing word is the trigger.
    const pathological = 'Ab' + ' '.repeat(40000);
    const start = process.hrtime.bigint();
    PROSE_PATTERN.test(pathological);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).to.be.below(100);
  });
});
