/**
 * Acceptance tests against REAL cht-core history.
 *
 * Every other probe spec drives a git double, which is the right default: the
 * suite has to run on a host with no 300MB checkout. But the two defects these
 * probes exist for were both "nobody ran the one-line git command", and a double
 * can only ever replay what its author believed the command returns. So the same
 * cases run once more against the actual clone whenever one is available.
 *
 * Opt-in by construction: export `CHT_CORE_PATH` and have the evidence fetched
 * (`refs/verify/pr10083`, `origin/master`). Anything missing skips the block
 * rather than failing it — a laptop without the clone is not a defect.
 */

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  checkClaim, defaultExec, resolveAnchor, Anchor, Claim, ProbeCtx, Verdict,
} from '../../src/scripts/claim-probes';
import { enumerateClaims } from '../../src/scripts/enumerate-claims';

/** Draft bytes captured from the promote branch with `git show`. */
const fixture = (name: string): string =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'memory-drafts', name), 'utf8');

const CORE = process.env.CHT_CORE_PATH;

/** True when `rev` resolves in the clone — the evidence this file needs. */
function hasRef(rev: string): boolean {
  try {
    execFileSync('git', ['-C', CORE as string, 'rev-parse', '--verify', '--quiet', rev], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ctx = (): ProbeCtx => ({
  chtCorePath: CORE as string,
  exec: defaultExec,
  apiResolve: false,
  prFiles: new Map(),
  treeCache: new Map(),
  apiCache: new Map(),
});

/** Any anchor will do: neither probe below reads it. */
const ANCHOR: Anchor = { sha: 'origin/master', subject: 'n/a', isRevert: false };

describe('probes against real cht-core history', function () {
  this.timeout(60000);

  /** Every claim of one kind the enumerator finds in a fixture, with verdicts. */
  const adjudicate = (draft: string, kind: Claim['kind'], anchor = ANCHOR): Verdict[] =>
    enumerateClaims(fixture(draft))
      .filter(c => c.kind === kind)
      .map(c => checkClaim(ctx(), anchor, c));

  describe('sha-unreachable', () => {
    // cht-agent#122 round 4: a repair commit claimed this sha was gone because
    // the ui-extensions epic squashed it. It is in the clone, reachable from the
    // durable pull ref.
    const SHA = '70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87';
    const QUOTE = 'The commit is absent from a clone because the epic squashed it away.';

    beforeEach(function () {
      if (!CORE || !hasRef('refs/verify/pr10083')) this.skip();
    });

    // The defect exactly as it shipped, and the repair exactly as it landed:
    // draft bytes read out of the promote branch at 6e43e88 and a389ae0.
    it('refutes the 10180 draft as committed at 6e43e88', () => {
      const verdicts = adjudicate('10180-defective-6e43e88.md', 'sha-unreachable');
      expect(verdicts).to.have.lengthOf(1);
      expect(verdicts[0].outcome).to.equal('ungrounded');
      expect(verdicts[0].evidence).to.contain('refs/verify/pr10083');
    });

    it('has nothing to say about the repaired 10180 draft at a389ae0', () => {
      // The repair asserts reachability via the pull ref — a true sentence, and
      // one that discusses the same commit at greater length. Firing here would
      // punish the fix.
      expect(adjudicate('10180-repaired-a389ae0.md', 'sha-unreachable')).to.deep.equal([]);
    });

    it('refutes the claim: the commit is reachable from refs/verify/pr10083', () => {
      const v = checkClaim(ctx(), ANCHOR, { kind: 'sha-unreachable', sha: SHA, quote: QUOTE });
      expect(v.outcome).to.equal('ungrounded');
      expect(v.evidence).to.contain('refs/verify/pr10083');
    });

    it('does not call a sha nobody has "unreachable"', () => {
      // Well-formed, absent from every clone on earth. Absence here is a fact
      // about this checkout's refs, so the only honest verdict is unverifiable.
      const claim: Claim = {
        kind: 'sha-unreachable', sha: '0123456789abcdef0123456789abcdef01234567', quote: QUOTE,
      };
      expect(checkClaim(ctx(), ANCHOR, claim).outcome).to.equal('unverifiable');
    });
  });

  describe('literal-in-file', () => {
    const COMPONENT = 'webapp/web-components/cht-form/src/app.component.ts';
    const SERVICE = 'webapp/src/ts/services/form.service.ts';

    beforeEach(function () {
      if (!CORE || !hasRef('origin/master')) this.skip();
    });

    // The 9301 sentence, still on the promote branch at a389ae0 — its fix is a
    // pending review suggestion. Read against master, the selector is in
    // form.service.ts and nowhere near the component the sentence names.
    it('refutes the 9301 draft bytes at origin/master', () => {
      const verdicts = adjudicate('9301-defective-a389ae0.md', 'literal-in-file')
        .filter(v => (v.claim as { literal?: string }).literal === 'instance[id="contact-summary"]');
      expect(verdicts).to.have.lengthOf(1);
      expect(verdicts[0].outcome).to.equal('ungrounded');
      expect(verdicts[0].suggestion).to.contain(SERVICE);
    });

    it('grounds the same literal when it is bound to the file that has it', () => {
      const v = checkClaim(ctx(), ANCHOR, {
        kind: 'literal-in-file', literal: 'instance[id="contact-summary"]', file: SERVICE,
        quote: `${SERVICE} looks it up as \`instance[id="contact-summary"]\`.`,
      });
      expect(v.outcome).to.equal('grounded');
      // form.service.ts:105 spells it with the variable: `instance[id="${instanceId}"]`.
      expect(v.evidence).to.contain('form.service.ts:105');
    });

    it('grounds the reviewer\'s replacement sentence for 9301', () => {
      // The suggested repair names the mechanism the component really has —
      // app.component.ts:82 — so the check must pass on the corrected text.
      const fixed = 'The standalone `webapp/web-components/cht-form/src/app.component.ts` takes the ' +
        'subject summary as a `contactSummary` input and tags it with the instance id this PR gave ' +
        "it (`{ id: 'contact-summary', context: value }`), then hands it to `EnketoService.renderForm`.";
      const claims = enumerateClaims(fixed).filter(c => c.kind === 'literal-in-file');
      expect(claims).to.have.lengthOf(1);
      const v = checkClaim(ctx(), ANCHOR, claims[0]);
      expect(v.outcome).to.equal('grounded');
      expect(v.evidence).to.contain(COMPONENT);
    });

    it('does not "find" an invented selector through the interpolation tolerance', () => {
      const v = checkClaim(ctx(), ANCHOR, {
        kind: 'literal-in-file', literal: 'instance[id="totally-invented-thing"]', file: COMPONENT,
        quote: `${COMPONENT} looks it up as \`instance[id="totally-invented-thing"]\`.`,
      });
      expect(v.outcome).to.equal('unverifiable');
    });
  });

  /**
   * The LIST regions — `entities:`, `concepts:`, `## Related Files` — read against
   * the real clone at each draft's real anchor.
   *
   * Both defects below were true when their PR shipped and are gone from master
   * today, which is what makes them expensive: probing only the anchor certifies
   * them and probing only master refutes them. They survived five clean
   * full-corpus passes because the only thing reading a YAML list was the LLM
   * extractor, at roughly two-thirds recall a pass. A list has one assertion per
   * bullet and needs no model to find, so these run on the enumerated claims.
   *
   * The defective and repaired bytes are both fixtures on purpose: a screen that
   * fires on the defect but also on its fix is not a screen, it is churn.
   */
  describe('drift out of the frontmatter and Related Files lists', () => {
    beforeEach(function () {
      if (!CORE || !hasRef('origin/master')) this.skip();
    });

    /**
     * Every claim in a fixture, adjudicated at ITS OWN anchor (from `source_sha` /
     * `source_pr`) rather than at a stand-in ref. Drift is the difference between
     * that commit and master, so an approximate anchor answers a different
     * question. `draft` is handed to checkClaim so a caveat written anywhere in
     * the draft still settles the entity, exactly as ground-claims does it.
     */
    const atOwnAnchor = (name: string): Verdict[] => {
      const raw = fixture(name);
      const sha = /^source_sha:\s*(\S+)/m.exec(raw)?.[1];
      const pr = /^source_pr:\s*\S+#(\d+)/m.exec(raw)?.[1];
      const anchor = resolveAnchor(ctx(), {
        sourceSha: sha,
        prNumber: pr ? Number.parseInt(pr, 10) : undefined,
      });
      expect(anchor, `anchor for ${name} must resolve in this clone`).to.not.equal(null);
      return enumerateClaims(raw).map(c => checkClaim(ctx(), anchor, c, [], [], raw));
    };

    /** The stale-as-written finding naming `entity`, if the pass produced one. */
    const driftOn = (name: string, entity: string): Verdict | undefined =>
      atOwnAnchor(name).find(v => v.drift?.entity === entity);

    // 10784's `concepts:` bullet read "- prepareForSave lifecycle hook". The hook
    // is real at that PR's commit and was deleted from master by cccce201e
    // (#11256, the #10700 save-workflow rewrite).
    it('flags the unannotated 10784 concepts entry at bdbf090', () => {
      const v = driftOn('10784-defective-bdbf090.md', 'prepareForSave');
      expect(v, 'prepareForSave should be reported stale-as-written').to.not.equal(undefined);
      // True about its own PR — the finding is the tense, not the fact.
      expect(v?.outcome).to.equal('grounded');
      expect(v?.drift?.note).to.contain('absent from origin/master');
    });

    it('says nothing about the annotated 10784 concepts entry at aa398b0', () => {
      // "- prepareForSave lifecycle hook (removed on master by the #10700
      // save-workflow rewrite, cccce201e)" — the bullet already says what the
      // probe would say.
      expect(driftOn('10784-repaired-aa398b0.md', 'prepareForSave')).to.equal(undefined);
    });

    // 9512's Related Files listed "- webapp/src/ts/app.module.ts", deleted on
    // master by a1730c4b1 (#9784, the standalone-components migration).
    it('flags the unannotated 9512 Related Files bullet at bdbf090', () => {
      const v = driftOn('9512-defective-bdbf090.md', 'webapp/src/ts/app.module.ts');
      expect(v, 'app.module.ts should be reported stale-as-written').to.not.equal(undefined);
      expect(v?.outcome).to.equal('grounded');
      expect(v?.drift?.note).to.contain('absent from origin/master');
    });

    it('says nothing about the annotated 9512 Related Files bullet at aa398b0', () => {
      expect(driftOn('9512-repaired-aa398b0.md', 'webapp/src/ts/app.module.ts')).to.equal(undefined);
    });

    it('checks a concepts identifier the prose never marks as code', () => {
      // "- native DOM event dispatch vs jQuery .trigger()". Neither name is
      // backticked anywhere in 10784, so before the list regions were enumerated
      // nothing deterministic ever looked either one up — which is the gap, and
      // why prepareForSave surviving five passes was luck: the body happens to
      // backtick it, and a concept named only in the list does not get that.
      const raw = fixture('10784-defective-bdbf090.md');
      expect(raw).to.not.contain('`jQuery`');
      expect(raw).to.not.contain('`trigger`');
      const fromBullet = enumerateClaims(raw)
        .filter(c => c.kind === 'symbol' && c.quote.startsWith('- native DOM event dispatch'));
      expect(fromBullet.map(c => (c as { symbol: string }).symbol))
        .to.have.members(['jQuery', 'trigger']);
      for (const c of fromBullet) expect(checkClaim(ctx(), ANCHOR, c).outcome).to.equal('grounded');
    });

    it('neither fixture pair produces a refuted claim', () => {
      // The repair edits a caveat into two bullets and nothing else, so any
      // `ungrounded` here is the enumerator inventing a claim out of an
      // annotation — the failure mode this whole region has to avoid.
      for (const name of ['10784-defective-bdbf090.md', '10784-repaired-aa398b0.md',
        '9512-defective-bdbf090.md', '9512-repaired-aa398b0.md']) {
        const bad = atOwnAnchor(name).filter(v => v.outcome === 'ungrounded');
        expect(bad.map(v => v.evidence), name).to.deep.equal([]);
      }
    });
  });
});
