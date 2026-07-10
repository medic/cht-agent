import { expect } from 'chai';
import {
  parseSingleFileContent,
  parseFirstGenFileContent,
  applySearchReplace,
  PROSE_PATTERN,
} from '../../../../src/layers/code-gen/lib/output-parsing';

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
    expect(result).to.not.be.null;
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
    expect(result).to.be.null;
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

describe('parseFirstGenFileContent (F-B first-gen hardening)', () => {
  it('strips a leading preamble, a wrapping fence, and trailing prose (the CLI leak shape)', () => {
    const raw =
      "Here is the test file you asked for:\n" +
      "```typescript\n" +
      "import { expect } from 'chai';\n" +
      "describe('x', () => {});\n" +
      "```\n" +
      "Let me know if you need changes.";
    expect(parseFirstGenFileContent(raw)).to.equal(
      "import { expect } from 'chai';\ndescribe('x', () => {});\n",
    );
  });

  it('strips a broadened lowercase preamble but leaves real code that starts lowercase', () => {
    expect(parseFirstGenFileContent("here's the spec:\nimport x from 'y';\ndescribe('a', () => {});"))
      .to.equal("import x from 'y';\ndescribe('a', () => {});\n");
    // A real code first line (not a keyword, lowercase) must NOT be treated as preamble:
    expect(parseFirstGenFileContent('foo.bar();\nconst x = 1;')).to.equal('foo.bar();\nconst x = 1;\n');
  });

  it('does NOT slice out an interior fence inside real code (template literal)', () => {
    const raw =
      "import { expect } from 'chai';\n" +
      "const md = `\n```js\ncode\n```\n`;\n" +
      "describe('z', () => {});";
    const out = parseFirstGenFileContent(raw);
    expect(out).to.include('```js'); // interior fence preserved (code precedes it)
    expect(out).to.include("import { expect } from 'chai'");
  });

  it('is confined to first-gen: parseSingleFileContent (continuation) leaves what the first-gen parser strips', () => {
    const chunk = 'following the pattern above\nconst x = 1;';
    // first-gen: broadened preamble strip removes the prose opener
    expect(parseFirstGenFileContent(chunk)).to.equal('const x = 1;\n');
    // continuation parser (narrow) is byte-identical to before — the resumed line survives
    expect(parseSingleFileContent(chunk)).to.equal('following the pattern above\nconst x = 1;\n');
  });

  it('runs in linear time on a large never-closing fence (S8786)', () => {
    const pathological = '```typescript\n' + 'x'.repeat(200000);
    const start = process.hrtime.bigint();
    parseFirstGenFileContent(pathological);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).to.be.below(100);
  });
});

describe('parseFirstGenFileContent fence close selection (MG-2, NEW-1)', () => {
  it('selects the FIRST fence close so a trailing fenced note is not swallowed (MG-2)', () => {
    const raw =
      "```typescript\n" +
      "describe('t', () => {});\n" +
      "```\n" +
      "Note, run it with:\n" +
      "```bash\n" +
      "npm test\n" +
      "```";
    expect(parseFirstGenFileContent(raw)).to.equal("describe('t', () => {});\n");
  });

  it('extracts only the first fenced block when two blocks are present', () => {
    const raw = "```js\nconst a = 1;\n```\n```js\nconst b = 2;\n```";
    expect(parseFirstGenFileContent(raw)).to.equal('const a = 1;\n');
  });

  it('accepts a language-tagged close as a fallback when there is no bare close (NEW-1)', () => {
    const raw = "```typescript\ndescribe('t', () => {});\n```js";
    expect(parseFirstGenFileContent(raw)).to.equal("describe('t', () => {});\n");
  });

  it('keeps a nested tagged fence in the body when a real bare close exists (no mis-slice)', () => {
    // A `` ```js `` appears inside a string in the body; the tagged fallback stays
    // dormant because a real bare close (the wrapper) exists, so the full body is kept.
    const raw = "```typescript\nconst snippet = '```js';\ndescribe('t', () => {});\n```";
    expect(parseFirstGenFileContent(raw)).to.equal("const snippet = '```js';\ndescribe('t', () => {});\n");
  });

  it('takes everything after the open when the fence is never closed (truncation)', () => {
    const raw = "```typescript\ndescribe('t', () => {\n  it('w', () => {";
    expect(parseFirstGenFileContent(raw)).to.equal("describe('t', () => {\n  it('w', () => {\n");
  });
});

describe('parseFirstGenFileContent trailing-prose strip (MG-1)', () => {
  // Each fixture is already trimmed, so a byte-unchanged parse returns it + one '\n'.
  const unchanged = (src: string) => expect(parseFirstGenFileContent(src)).to.equal(src + '\n');

  it('strips unfenced trailing prose (the MG-1 repro) — fails at v14, passes now', () => {
    const raw =
      'Here is the test file:\n' +
      "const { expect } = require('chai');\n" +
      "describe('t', () => { it('w', () => { expect(1).to.equal(1); }); });\n" +
      'Let me know if you need any changes.';
    expect(parseFirstGenFileContent(raw)).to.equal(
      "const { expect } = require('chai');\n" +
        "describe('t', () => { it('w', () => { expect(1).to.equal(1); }); });\n",
    );
  });

  it('strips a trailing multi-line prose paragraph clean', () => {
    const raw =
      "describe('t', () => {\n  it('w', () => {});\n});\n" +
      'This test verifies the behavior.\n' +
      'It should be reviewed before merging.';
    expect(parseFirstGenFileContent(raw)).to.equal("describe('t', () => {\n  it('w', () => {});\n});\n");
  });

  it('leaves code ending in });', () => unchanged("describe('t', () => {\n  it('w', () => {});\n});"));
  it('leaves code ending in );', () => unchanged('foo(\n  bar,\n);'));
  it('leaves code ending in }', () => unchanged('function f() {\n  return 1;\n}'));
  it('leaves a trailing block-comment close */', () => unchanged('const x = 1;\n/*\n * note\n */'));
  it('leaves a trailing expect(...) statement', () =>
    unchanged('const result = 1;\nexpect(result).to.equal(true);'));
  it('leaves a template literal closing on a prose line', () =>
    unchanged('const note = `\nPlease review the report.`;'));
  it('does not strip prose INSIDE an open template literal', () =>
    unchanged('const banner = `\nWelcome to the app'));
  it('leaves a capitalized member call that looks like prose', () =>
    unchanged('Contact.save({ patient_id: id });'));
  it('leaves module.exports', () => unchanged('module.exports = { foo: 1 };'));
  it('leaves a trailing line comment', () => unchanged('const x = 1;\n// done'));
  it('leaves a trailing one-line block comment', () => unchanged('const x = 1;\n/* note */'));
  it('leaves a whole normal spec with no trailing prose', () =>
    unchanged("import { expect } from 'chai';\ndescribe('t', () => {\n  it('w', () => { expect(1).to.equal(1); });\n});"));
});

describe('parseFirstGenFileContent member-expression guard (MG-3)', () => {
  it('does NOT slice an interior fence when the first line is a member-expression assignment', () => {
    // v14 mistook the interior ```bash for a wrapper and discarded the body — and
    // its truncated output passed node --check (silent loss). The guard preserves it.
    const raw =
      'messages.intro = `\n' +
      '```bash\n' +
      'echo hi\n' +
      '```\n' +
      '`;\n' +
      "describe('t', () => {});";
    const out = parseFirstGenFileContent(raw);
    expect(out).to.include('messages.intro'); // body NOT discarded
    expect(out).to.include("describe('t', () => {})");
    expect(out).to.include('```bash'); // interior fence preserved
  });

  it('also guards a plain (non-member) assignment of a fence-containing template', () => {
    const raw = 'banner = `\n```js\ncode\n```\n`;\nconst x = 1;';
    const out = parseFirstGenFileContent(raw);
    expect(out).to.include('banner =');
    expect(out).to.include('const x = 1');
  });
});

// The deferred first-gen leak shapes NEW-2 (lowercase code-keyword-prefix preamble)
// and NEW-3 (interior/sandwiched prose) are tracked in the parser boundary-hardening
// follow-up (medic/cht-agent#139) rather than as skipped tests here.
