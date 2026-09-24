import { expect } from 'chai';
import * as os from 'os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  checkCoherence, coherencePrompt, renderCoherence, verifyContradictions, whyWithdrawsPair,
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

    // Both observed on contacts, one gate round apart, both verified false by
    // hand: 9266's summary against the banner it cites, 9426's summary against
    // the note it cites. A drafter who writes "see the note below" has said the
    // two passages belong together — the opposite of a contradiction — and the
    // model filed each with no rationale at all.
    ['Fixed a gap where the create form bypassed the hierarchy — see the note below.',
      'skip was replaced by a cursor before this reached master; see the stale-as-written banner.',
      'The helper was renamed before landing, see the banner.',
    ].forEach(quote => {
      it(`discards an unexplained pair whose quote cites the other section: "${quote.slice(0, 40)}…"`, () => {
        const raw = [BODY, '', quote, ''].join('\n');
        const { kept, discarded } = verifyContradictions(draftInput(raw), [
          { quoteA: quote, quoteB: SOLUTION, why: '' },
        ]);
        expect(kept).to.have.lengthOf(0);
        expect(discarded).to.equal(1);
      });
    });

    it('keeps a cited pair once the model actually says why', () => {
      // The discard needs BOTH halves. Any stated rationale and a human reads it.
      const quote = 'Fixed a gap where the create form bypassed the hierarchy — see the note below.';
      const raw = [BODY, '', quote, ''].join('\n');
      const { kept } = verifyContradictions(draftInput(raw), [
        { quoteA: quote, quoteB: SOLUTION, why: 'The note says the check ran; the summary says it did not.' },
      ]);
      expect(kept).to.have.lengthOf(1);
    });

    it('keeps a pair whose rationale is missing entirely', () => {
      // An absent `why` cannot withdraw the pair, so it must surface.
      const { kept, discarded } = verifyContradictions(draftInput(), [
        { quoteA: SOLUTION, quoteB: DESIGN, why: '' },
      ]);
      expect(discarded).to.equal(0);
      expect(kept).to.have.lengthOf(1);
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

    // contacts 9368 raised the same pair in two separate rounds: "eleven spec
    // files in all, every one modified and none added" against a sentence saying
    // the endpoint is new. Verified at `09dc81748`: eleven spec files in the
    // diff, all M, none A — the draft is right and the controller spec already
    // existed for that controller's other routes. Deciding the pair needs a fact
    // about the repo, which the prompt already puts out of scope; it now says so
    // in the terms the model actually reached for.
    it('rules out pairs that need a fact about the repository', () => {
      const p = coherencePrompt(draftInput());
      expect(p).to.contain('Inferences about what the repository must contain');
      expect(p).to.contain('which files exist');
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

    // A run over the contacts delta reported 0 contradictions while silently
    // failing to check two drafts, both on a JSON parse error that would not
    // reproduce on the same bytes. One retry recovers the pass; the draft is
    // still checked, not assumed coherent.
    it('retries once and keeps the pass when the first call is malformed', async () => {
      const dir = tmpCorpus({ '10198.md': BODY });
      let calls = 0;
      const flaky: FindFn = async () => {
        calls += 1;
        if (calls === 1) throw new Error('Failed to parse CLI response as JSON');
        return [{ quoteA: SOLUTION, quoteB: DESIGN, why: 'scaffolding vs ng-if' }];
      };
      const { reports, total } = await checkCoherence({
        dir, findFn: flaky, outDir: path.join(dir, '..', 'out'),
      });
      expect(calls).to.equal(2);
      expect(total).to.equal(1);
      expect(reports[0].error).to.equal(undefined);
    });

    it('gives up after the second failure rather than retrying forever', async () => {
      // Two failures mean the model cannot answer on this draft. Burying that
      // under retries is how "not a clean pass" stops meaning anything.
      const dir = tmpCorpus({ '10198.md': BODY });
      let calls = 0;
      const dead: FindFn = async () => { calls += 1; throw new Error('CLI timeout'); };
      const { reports } = await checkCoherence({ dir, findFn: dead, outDir: path.join(dir, '..', 'out') });
      expect(calls).to.equal(2);
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

    // A pass that could not check a draft is not a clean pass. Observed on the
    // contacts branch: one draft's response omitted `why`, zod threw, that draft
    // was skipped — and the header still read "drafts checked: 11", so the pass
    // was counted toward convergence. The count now excludes failures and says
    // outright that the pass does not count.
    it('does not count a failed draft as checked', () => {
      const reports: CoherenceReport[] = [
        { file: 'ok.md', discarded: 0, contradictions: [] },
        { file: 'broken.md', discarded: 0, contradictions: [], error: 'coherence check failed: bad response' },
      ];
      const md = renderCoherence(reports);
      expect(md).to.contain('drafts checked: 1 of 2');
      expect(md).to.contain('NOT CHECKED: 1');
      expect(md).to.contain('not a clean pass');
      expect(md).to.contain('broken.md');
    });

    it('keeps the plain count when every draft was checked', () => {
      const md = renderCoherence([{ file: 'ok.md', discarded: 0, contradictions: [] }]);
      expect(md).to.contain('drafts checked: 1 of 1');
      expect(md).to.not.contain('NOT CHECKED');
    });

    it('says so plainly when nothing was found', () => {
      expect(renderCoherence([{ file: 'a.md', contradictions: [], discarded: 0 }]))
        .to.contain('_No contradictions found._');
    });
  });
});

describe('whyWithdrawsPair — the phrasings that slipped through', () => {
  it('withdraws on a bare imperative verdict', () => {
    // forms-and-reports c48, on 10180: filed and withdrawn in the same breath.
    expect(whyWithdrawsPair('These are compatible, not contradictory — withdraw.')).to.equal(true);
  });

  it('withdraws when compatibility is asserted rather than contrasted', () => {
    expect(whyWithdrawsPair('The two statements are compatible; both describe the epic squash.')).to.equal(true);
  });

  // contacts 9266, coherence pass 3 of the final gate: the most explicit
  // withdrawal the model has produced, and `\bwithdraw\b` could not match it —
  // the trailing "n" leaves no word boundary.
  ['Both cannot be true only if the file counts conflict, and they do not — this pair is withdrawn.',
    'Withdrawing this pair; both describe the same rename.',
    'The model withdraws it: eight spec files either way.',
  ].forEach(why => {
    it(`withdraws on an inflected verdict: "${why.slice(0, 44)}…"`, () => {
      expect(whyWithdrawsPair(why)).to.equal(true);
    });
  });

  it('still keeps a genuine contradiction', () => {
    expect(whyWithdrawsPair('Problem says the read hangs while Root Cause says the write does.')).to.equal(false);
  });

  it('does not withdraw on a noun that merely starts the same', () => {
    // The inflection list stops at verb forms, so "withdrawal" — a claim about
    // the code rather than a verdict on the pair — leaves a real contradiction
    // standing. Pinned because widening to `withdraw\w*` would silently eat it.
    expect(whyWithdrawsPair('Solution describes a withdrawal of the flag; Problem says it stayed.'))
      .to.equal(false);
  });
});
