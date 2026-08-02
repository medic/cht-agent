import { expect } from 'chai';
import { enumerateClaims, normaliseClaim } from '../../src/scripts/enumerate-claims';

const DRAFT = [
  '---',
  'id: cht-core-8027',
  'entities:',
  '  - admin/src/js/services/resource-icons.js',
  '  - webapp/src/ts/services/resource-icons.service.ts',
  'concepts:',
  '  - defensive null-checking',
  '---',
  '',
  '## Root Cause',
  '',
  'The code called `Object.keys` on `res.resources` without a guard, and',
  '`getDocResources` returned undefined. The setting is `sms.clear_failing_schedules`.',
  'A task in the `pending` state is skipped. See the `previous month` filter.',
  '',
  '## Related Files',
  '',
  '- admin/src/js/controllers/images-partners.js',
  '- webapp/tests/karma/ts/services/resource-icon.service.spec.ts',
  '',
].join('\n');

describe('enumerate-claims', () => {
  it('is exhaustive and identical across runs — the whole point', () => {
    const a = enumerateClaims(DRAFT);
    const b = enumerateClaims(DRAFT);
    expect(JSON.stringify(a)).to.equal(JSON.stringify(b));
    expect(a.length).to.be.greaterThan(0);
  });

  it('treats Related Files paths as file-touched and other paths as path-exists', () => {
    const cs = enumerateClaims(DRAFT);
    const touched = cs.filter(c => c.kind === 'file-touched').map(c => (c as { file: string }).file);
    const exists = cs.filter(c => c.kind === 'path-exists').map(c => (c as { file: string }).file);
    expect(touched).to.include('admin/src/js/controllers/images-partners.js');
    expect(touched).to.include('webapp/tests/karma/ts/services/resource-icon.service.spec.ts');
    expect(exists).to.include('admin/src/js/services/resource-icons.js');
    expect(exists).to.include('webapp/src/ts/services/resource-icons.service.ts');
    // a path may not be claimed both ways
    expect(touched.filter(t => exists.includes(t))).to.deep.equal([]);
  });

  it('picks up backticked identifiers, including dotted and config-key forms', () => {
    const syms = enumerateClaims(DRAFT)
      .filter(c => c.kind === 'symbol').map(c => (c as { symbol: string }).symbol);
    expect(syms).to.include('Object.keys');
    expect(syms).to.include('res.resources');
    expect(syms).to.include('getDocResources');
    expect(syms).to.include('sms.clear_failing_schedules');
  });

  it('leaves bare words and prose in backticks alone', () => {
    // `pending` is a state string and `previous month` is prose; flagging either
    // as a fabricated symbol costs far more than missing the check.
    const syms = enumerateClaims(DRAFT)
      .filter(c => c.kind === 'symbol').map(c => (c as { symbol: string }).symbol);
    expect(syms).to.not.include('pending');
    expect(syms).to.not.include('previous month');
  });

  it('gives every claim a quote that occurs in the draft', () => {
    for (const c of enumerateClaims(DRAFT)) {
      expect(DRAFT).to.contain(c.quote.trim().slice(0, 40));
    }
  });

  it('deduplicates a path or symbol named several times', () => {
    const twice = DRAFT + '\nAgain: `getDocResources` in admin/src/js/services/resource-icons.js.\n';
    const cs = enumerateClaims(twice);
    const keys = cs.map(c => `${c.kind}|${'symbol' in c ? c.symbol : ''}|${'file' in c ? c.file : ''}`);
    expect(keys.length).to.equal(new Set(keys).size);
  });

  it('honours the max cap', () => {
    expect(enumerateClaims(DRAFT, { max: 2 })).to.have.lengthOf(2);
  });

  describe('precision filters — every case here was a real false positive', () => {
    const syms = (raw: string): string[] =>
      enumerateClaims(raw).filter(c => c.kind === 'symbol').map(c => (c as { symbol: string }).symbol);
    const paths = (raw: string): string[] =>
      enumerateClaims(raw).map(c => ('file' in c ? (c as { file: string }).file : '')).filter(Boolean);

    it('does not treat a bare filename as a symbol', () => {
      const s = syms('The bug was in `smsparser.js` and `sender.component.ts`.');
      expect(s).to.not.include('smsparser.js');
      expect(s).to.not.include('sender.component.ts');
    });

    it('skips a symbol the draft says was removed, renamed or superseded', () => {
      expect(syms('Removed the `parseResponseBody` helper.')).to.be.empty;
      expect(syms('the original `can_hide_target_count_past_goal` permission was superseded')).to.be.empty;
      expect(syms('widened the predicate (`isTelemetryOrFeedback` -> `isReplicableDoc`)')).to.be.empty;
    });

    it('keeps a symbol on an ordinary line', () => {
      expect(syms('The guard calls `getDocResources` before iterating.')).to.include('getDocResources');
    });

    it('downgrades a Related Files entry the draft says was not modified', () => {
      const raw = ['## Related Files', '',
        '- api/controllers/sms-gateway.js (the endpoint under test; not modified — this commit adds only the spec)',
        '- tests/protractor/e2e/api/controllers/sms-gateway.spec.js', ''].join('\n');
      const cs = enumerateClaims(raw);
      const touched = cs.filter(c => c.kind === 'file-touched').map(c => (c as { file: string }).file);
      const exists = cs.filter(c => c.kind === 'path-exists').map(c => (c as { file: string }).file);
      expect(touched).to.not.include('api/controllers/sms-gateway.js');
      expect(exists).to.include('api/controllers/sms-gateway.js');
      expect(touched).to.include('tests/protractor/e2e/api/controllers/sms-gateway.spec.js');
    });

    it('ignores a remote API endpoint that looks like a repo path', () => {
      expect(paths('posts to `api/v2/broadcasts.json` on RapidPro')).to.not.include('api/v2/broadcasts.json');
    });

    it("ignores this corpus's own frontmatter keys", () => {
      expect(syms('`source_sha` is the merge commit and `domainFit` is strong.')).to.be.empty;
    });

    it('ignores prose with ellipses', () => {
      expect(syms('rewrote the `for...of` loop')).to.not.include('for...of');
    });
  });

  describe('normaliseClaim — the same rules applied to MODEL claims', () => {
    // The enumerator filtered these while extracting; the model's claims never
    // passed through them, so every filter leaked on the LLM half.
    const raw = [
      '## Root Cause', '',
      'index.js selected between `emitter.nools.js` and `emitter.javascript.js`.',
      'numeric strings go through `Number()`.', '',
      '## Related Issues', '',
      '- #9432: Merge `ensureTaskFreshness` and `ensureTargetFreshness` into single event', '',
    ].join('\n');
    const claim = (symbol: string, quote: string): { kind: string; symbol: string; quote: string } =>
      ({ kind: 'symbol', symbol, quote });

    it('drops a bare filename the model extracted as a symbol', () => {
      expect(normaliseClaim(raw, claim('emitter.nools.js',
        'index.js selected between `emitter.nools.js` and `emitter.javascript.js`.'))).to.equal(null);
    });

    it('drops symbols lifted out of a Related Issues gloss', () => {
      // #9432's title is about ANOTHER issue's code, not this draft's PR.
      expect(normaliseClaim(raw, claim('ensureTaskFreshness',
        '- #9432: Merge `ensureTaskFreshness` and `ensureTargetFreshness` into single event'))).to.equal(null);
    });

    it('strips a call suffix rather than dropping the symbol', () => {
      const out = normaliseClaim(raw, claim('Number()', 'numeric strings go through `Number()`.'));
      expect(out?.symbol).to.equal('Number');
    });

    // 9718: "The interval turnover mechanism in provider-wireup.js snapshotted
    // the last calculation…". The model offered "interval turnover" as a symbol,
    // and git reported it missing from the file the sentence names — which reads
    // as a misattribution rather than as prose.
    it('drops a multi-word noun phrase the model extracted as a symbol', () => {
      const q = 'The interval turnover mechanism in provider-wireup.js snapshotted the last calculation.';
      expect(normaliseClaim(raw, claim('interval turnover', q))).to.equal(null);
    });

    it('keeps a dotted member chain, which has no whitespace', () => {
      const q = 'numeric strings go through `Number()`.';
      expect(normaliseClaim(raw, claim('rulesEngineCore.showTask', q))?.symbol)
        .to.equal('rulesEngineCore.showTask');
    });

    it('keeps an ordinary symbol untouched', () => {
      const q = 'index.js selected between `emitter.nools.js` and `emitter.javascript.js`.';
      expect(normaliseClaim(raw, claim('getDocResources', q))?.symbol).to.equal('getDocResources');
    });

    it('leaves a path the draft really writes alone', () => {
      const withPath = `${raw}\n- api/src/x.js\n`;
      const c = { kind: 'file-touched', file: 'api/src/x.js', quote: '- api/src/x.js' };
      expect(normaliseClaim(withPath, c)).to.deep.equal(c);
    });

    it('falls back to the basename when the model invented the directory', () => {
      // 10390: the draft says "bespoke code in target-aggregates.service.ts";
      // the model supplied webapp/src/ts/modules/analytics/… , which occurs nowhere.
      const draft = '## Root Cause\n\nloaded via bespoke code in target-aggregates.service.ts\n';
      const out = normaliseClaim(draft, {
        kind: 'path-exists',
        file: 'webapp/src/ts/modules/analytics/target-aggregates.service.ts',
        quote: 'loaded via bespoke code in target-aggregates.service.ts',
      });
      expect((out as { file: string }).file).to.equal('target-aggregates.service.ts');
    });

    it('does not rescue a basename onto a merely-similar filename', () => {
      // `index.js` contains the letters of `x.js`; a substring test would match.
      const draft = '## Root Cause\n\nindex.js selected the emitter.\n';
      expect(normaliseClaim(draft, {
        kind: 'path-exists', file: 'api/src/x.js', quote: 'index.js selected the emitter.',
      })).to.equal(null);
    });

    it('downgrades symbol-in-file to symbol when the file was invented', () => {
      const draft = '## Root Cause\n\nsurfaced via `analytics.getTargetDocs`\n';
      const out = normaliseClaim(draft, {
        kind: 'symbol-in-file', symbol: 'getTargetDocs',
        file: 'webapp/src/ts/services/analytics.service.ts',
        quote: 'surfaced via `analytics.getTargetDocs`',
      });
      expect(out?.kind).to.equal('symbol');
      expect(out).to.not.have.property('file');
    });
  });
});
