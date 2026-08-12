import { expect } from 'chai';
import * as os from 'os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  checkCoherence, coherencePrompt, renderCoherence, verifyContradictions,
  CoherenceReport, FindFn,
} from '../../src/scripts/check-coherence';
import { DraftInput } from '../../src/scripts/ground-claims';

/** The real 10198 shape: Solution and Design Choices disagree on one mechanism. */
const SOLUTION = 'Template safety comes from new `ng-if="favicon"` attributes on the two `<img>` tags, ' +
  'not from scaffolded keys.';
const DESIGN = 'the controller defensively scaffolds the minimum keys the template requires';

const BODY = [
  '---',
  'id: cht-core-8026',
  'issueNumber: 8026',
  'title: Validate empty branding doc',
  '---',
  '',
  '## Solution',
  '',
  SOLUTION,
  '',
  '## Design Choices',
  '',
  `Rather than failing on incomplete branding docs, ${DESIGN} — tolerating partial input.`,
  '',
].join('\n');

const draftInput = (raw = BODY): DraftInput => ({
  file: 'agent-memory/domains/configuration/issues/10198.md',
  frontmatter: { issueNumber: 8026 },
  body: raw.split('---')[2] ?? raw,
  raw,
});

function tmpCorpus(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coherence-'));
  const dir = path.join(root, 'agent-memory');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('check-coherence', () => {
  describe('verifyContradictions', () => {
    it('keeps a pair whose quotes both occur, and locates them', () => {
      const { kept, discarded } = verifyContradictions(draftInput(), [
        { quoteA: SOLUTION, quoteB: DESIGN, why: 'one denies the other' },
      ]);
      expect(discarded).to.equal(0);
      expect(kept).to.have.lengthOf(1);
      expect(kept[0].lineA).to.equal(9);
      expect(kept[0].lineB).to.equal(13);
      expect(kept[0].why).to.equal('one denies the other');
    });

    it('discards a fabricated quote instead of filing it as a defect', () => {
      // The load-bearing guard: an LLM that invents a quote must not be believed.
      const { kept, discarded } = verifyContradictions(draftInput(), [
        { quoteA: SOLUTION, quoteB: 'the controller rejects the document outright', why: 'invented' },
      ]);
      expect(kept).to.have.lengthOf(0);
      expect(discarded).to.equal(1);
    });

    it('tolerates whitespace and line wrapping in a real quote', () => {
      const wrapped = SOLUTION.replace('on the two', 'on the\n  two');
      const { kept } = verifyContradictions(draftInput(), [
        { quoteA: wrapped, quoteB: DESIGN, why: 'wrapped but real' },
      ]);
      expect(kept).to.have.lengthOf(1);
    });

    it('discards a pair that contradicts itself with the same sentence', () => {
      const { kept, discarded } = verifyContradictions(draftInput(), [
        { quoteA: SOLUTION, quoteB: SOLUTION, why: 'model artefact' },
      ]);
      expect(kept).to.have.lengthOf(0);
      expect(discarded).to.equal(1);
    });

    // Observed on 10371: the model filed a pair and used `why` to clear it,
    // and the run counted it. Two clean passes then looked like one dirty one.
    // Observed on contacts 10804: the model withdrew a pair by DOWNGRADING it
    // rather than negating it. No negation sits next to "conflict", so the
    // negation screen missed it and the pair was filed.
    ['These do not conflict.',
      'This is not a contradiction — the draft flags the rename explicitly.',
      'They are consistent: one states the rename, the other applies it.',
      'Both can be true at once.',
      'The two statements do not contradict each other.',
      'This is a minor framing difference rather than a factual conflict.',
      'A wording nit rather than a contradiction.',
      'That is a difference of emphasis rather than an inconsistency.',
      // contacts 9177: the model cleared the pair by saying the two statements
      // can coexist, without ever using the word "conflict".
      'This is a difference of issue-vs-PR attribution, not necessarily exclusive.',
      'The two accounts are not mutually exclusive.',
      'Not strictly exclusive — one names the issue, the other the PR.',
    ].forEach(why => {
      it(`discards a pair the model withdraws in its own rationale: "${why}"`, () => {
        const { kept, discarded } = verifyContradictions(draftInput(), [
          { quoteA: SOLUTION, quoteB: DESIGN, why },
        ]);
        expect(kept).to.have.lengthOf(0);
        expect(discarded).to.equal(1);
      });
    });

    it('still keeps a real finding whose rationale merely mentions conflict', () => {
      const { kept, discarded } = verifyContradictions(draftInput(), [
        { quoteA: SOLUTION, quoteB: DESIGN, why: 'These conflict: one denies what the other asserts.' },
      ]);
      expect(discarded).to.equal(0);
      expect(kept).to.have.lengthOf(1);
    });
  });

  describe('coherencePrompt', () => {
    it('asks only whether statements conflict, never which is true', () => {
      const p = coherencePrompt(draftInput());
      expect(p).to.contain('INTERNAL CONTRADICTIONS');
      expect(p).to.contain('only comparing the document against itself');
      expect(p).to.contain('EXACTLY');
      expect(p).to.contain(SOLUTION);           // the draft is embedded verbatim
      expect(p).to.not.match(/which (?:side|one) is correct/i);
    });

    it('tells the model an empty answer is expected', () => {
      expect(coherencePrompt(draftInput())).to.contain('empty array');
    });
  });

  describe('checkCoherence', () => {
    it('reports a verified contradiction and exits non-clean', async () => {
      const dir = tmpCorpus({ '10198.md': BODY });
      const find: FindFn = async () => [{ quoteA: SOLUTION, quoteB: DESIGN, why: 'scaffolding vs ng-if' }];
      const { reports, total } = await checkCoherence({
        dir, findFn: find, outDir: path.join(dir, '..', 'out'),
      });
      expect(total).to.equal(1);
      expect(reports[0].contradictions[0].why).to.contain('ng-if');
    });

    it('reports clean for a self-consistent draft', async () => {
      const dir = tmpCorpus({ '10198.md': BODY });
      const { total } = await checkCoherence({
        dir, findFn: async () => [], outDir: path.join(dir, '..', 'out'),
      });
      expect(total).to.equal(0);
    });

    it('records a model failure instead of reporting the draft as coherent', async () => {
      const dir = tmpCorpus({ '10198.md': BODY });
      const failing: FindFn = async () => { throw new Error('CLI timeout'); };
      const { reports, total } = await checkCoherence({
        dir, findFn: failing, outDir: path.join(dir, '..', 'out'),
      });
      expect(total).to.equal(0);
      expect(reports[0].error).to.contain('CLI timeout');
    });

    it('writes both report artefacts', async () => {
      const dir = tmpCorpus({ '10198.md': BODY });
      const outDir = path.join(dir, '..', 'written');
      await checkCoherence({ dir, findFn: async () => [], outDir });
      expect(fs.existsSync(path.join(outDir, 'coherence.json'))).to.equal(true);
      expect(fs.existsSync(path.join(outDir, 'COHERENCE.md'))).to.equal(true);
    });
  });

  describe('renderCoherence', () => {
    it('surfaces both sides with line numbers', () => {
      const reports: CoherenceReport[] = [{
        file: 'a.md',
        discarded: 1,
        contradictions: [{ quoteA: 'X is true', quoteB: 'X is false', why: 'direct denial', lineA: 5, lineB: 9 }],
      }];
      const md = renderCoherence(reports);
      expect(md).to.contain('direct denial');
      expect(md).to.contain('L5:');
      expect(md).to.contain('L9:');
      expect(md).to.contain('discarded (quote not found in draft): 1');
    });

    it('says so plainly when nothing was found', () => {
      expect(renderCoherence([{ file: 'a.md', contradictions: [], discarded: 0 }]))
        .to.contain('_No contradictions found._');
    });
  });
});
