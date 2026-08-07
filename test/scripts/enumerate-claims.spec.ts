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

    // 10230: "Added a dedicated api/src/services/nepal-doit-sms.js service".
    // Extraction asked whether nepal-doit-sms.js contains `nepal-doit-sms`.
    it('drops a symbol that is just the stem of the file it is checked against', () => {
      const q = 'Added a dedicated api/src/services/nepal-doit-sms.js service that encapsulates the gateway';
      const c = {
        kind: 'symbol-in-file', symbol: 'nepal-doit-sms',
        file: 'api/src/services/nepal-doit-sms.js', quote: q,
      };
      expect(normaliseClaim(`${raw}\n## Solution\n\n${q}\n`, c)).to.equal(null);
    });

    it('keeps a hyphenated symbol when it is NOT the file stem', () => {
      // Angular selectors really are kebab-case; only self-reference is bogus.
      const q = 'the new `overdue-filter` component sits in tasks-sidebar-filter.component.ts';
      const c = {
        kind: 'symbol-in-file', symbol: 'overdue-filter',
        file: 'webapp/src/ts/modules/tasks/tasks-sidebar-filter.component.ts', quote: q,
      };
      expect((normaliseClaim(`${raw}\n## Solution\n\n${q}\n`, c) as { symbol: string } | null)?.symbol)
        .to.equal('overdue-filter');
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

  describe('claimedStatus — the file as object, not location', () => {
    const statusOf = (prose: string, file: string): string | undefined => {
      const draft = `## Testing\n\n${prose}\n`;
      const c = enumerateClaims(draft)
        .find(x => x.kind === 'file-touched' && x.file === file) as
          { status?: string } | undefined;
      return c?.status;
    };

    it('reads the 10436 harness sentence as an ADD claim', () => {
      // The defect three review rounds missed: the PR's diff is deletions only,
      // so a status of 'added' is what lets checkFileTouched contradict it.
      expect(statusOf(
        'A new Mocha unit-test harness was added for the webapp ' +
          '(webapp/tests/mocha/tsconfig.mocha.json) specifically to unit-test the lib.',
        'webapp/tests/mocha/tsconfig.mocha.json',
      )).to.equal('added');
    });

    it('reads a plain "added <path>" as an ADD claim', () => {
      expect(statusOf(
        'Added tests/e2e/default/targets/utils/targets-helper-functions.js for the new page.',
        'tests/e2e/default/targets/utils/targets-helper-functions.js',
      )).to.equal('added');
    });

    it('shares one verb across a conjunct list', () => {
      expect(statusOf(
        'Added api/src/controllers/target.js and api/tests/mocha/controllers/target.spec.js.',
        'api/tests/mocha/controllers/target.spec.js',
      )).to.equal('added');
    });

    it('reads removal as a DELETE claim even though ABSENCE_CONTEXT matches', () => {
      expect(statusOf(
        'Removed shared-libs/rules-engine/src/rules-emitter/emitter.nools.js outright.',
        'shared-libs/rules-engine/src/rules-emitter/emitter.nools.js',
      )).to.equal('deleted');
    });

    it('does NOT claim a status when the file is where a symbol was added', () => {
      // The 63-of-64 shape. pouchdb-provider.js was modified, not added; a
      // status here would invent a defect on every draft that describes a hunk.
      expect(statusOf(
        'Added a `dbQuery(view, params)` wrapper in shared-libs/rules-engine/src/pouchdb-provider.js.',
        'shared-libs/rules-engine/src/pouchdb-provider.js',
      )).to.equal(undefined);
    });

    it('does NOT claim a status for "added ... to <path>"', () => {
      expect(statusOf(
        'Added supporting `priority` functions to two tasks in config/default/tasks.js.',
        'config/default/tasks.js',
      )).to.equal(undefined);
    });

    it('does NOT claim a status when another PR is credited', () => {
      // "removed from master by #9718" is someone else's diff.
      expect(statusOf(
        'The helper in shared-libs/rules-engine/src/provider-wireup.js was removed from master by #9718.',
        'shared-libs/rules-engine/src/provider-wireup.js',
      )).to.equal(undefined);
    });

    it('still enumerates the file when no status can be read', () => {
      const draft = '## Testing\n\nExtended webapp/tests/karma/ts/reducers/tasks.spec.ts with edge cases.\n';
      const hit = enumerateClaims(draft)
        .find(c => 'file' in c && c.file === 'webapp/tests/karma/ts/reducers/tasks.spec.ts');
      expect(hit, 'the path is still claimed, just without a status').to.exist;
      expect((hit as { status?: string }).status).to.equal(undefined);
    });

    it('lets a prose status upgrade a bare Related Files entry', () => {
      const draft = [
        '## Testing', '',
        'Added webapp/tests/mocha/tsconfig.mocha.json for the lib.', '',
        '## Related Files', '',
        '- webapp/tests/mocha/tsconfig.mocha.json', '',
      ].join('\n');
      const hits = enumerateClaims(draft)
        .filter(c => c.kind === 'file-touched' && c.file === 'webapp/tests/mocha/tsconfig.mocha.json');
      expect(hits).to.have.lengthOf(1);
      expect((hits[0] as { status?: string }).status).to.equal('added');
    });
  });
});
