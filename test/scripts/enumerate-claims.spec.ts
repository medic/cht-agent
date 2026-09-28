import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { enumerateClaims, normaliseClaim } from '../../src/scripts/enumerate-claims';

/** Draft bytes captured from the promote branch with `git show` — see FIXTURES. */
const fixture = (name: string): string =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'memory-drafts', name), 'utf8');

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

  describe('the list regions, enumerated rather than sampled', () => {
    const syms = (raw: string): string[] =>
      enumerateClaims(raw).filter(c => c.kind === 'symbol').map(c => (c as { symbol: string }).symbol);
    const fm = (...body: string[]): string => ['---', 'id: x', ...body, '---', '', '## Notes', ''].join('\n');

    it('reads an identifier-shaped entities entry as a symbol', () => {
      // A curated entity list is the one place a bare name IS the assertion, so
      // no backticks are written and none are required.
      const s = syms(fm('entities:',
        '  - webapp/src/ts/services/enketo.service.ts',
        '  - CHTDatasourceService',
        '  - XmlFormsContextUtilsService.get',
        '  - tasks_by_contact'));
      expect(s).to.have.members(['CHTDatasourceService', 'XmlFormsContextUtilsService.get', 'tasks_by_contact']);
    });

    it('does not read a directory or a ddoc id in entities as a symbol', () => {
      // `shared-libs/validation` and `_design/medic-client` are neither paths
      // PATH_RE can probe (no extension) nor identifiers; claiming either as a
      // symbol asks git grep for a string that cannot be in any file.
      expect(syms(fm('entities:',
        '  - shared-libs/validation',
        '  - api/src/services/replication/',
        '  - _design/medic-client'))).to.be.empty;
    });

    it('mines identifiers out of a concepts phrase and leaves the phrase alone', () => {
      const s = syms(fm('concepts:',
        '  - datasource abstraction layer',
        '  - prepareForSave lifecycle hook',
        '  - stubbing Date.prototype.getTimezoneOffset',
        '  - client-side state persistence (localStorage)',
        '  - native DOM event dispatch vs jQuery .trigger()'));
      expect(s).to.include('prepareForSave');
      expect(s).to.include('Date.prototype.getTimezoneOffset');
      expect(s).to.include('localStorage');
      // Written as a call, so the word is marked as code even without a case change.
      expect(s).to.include('trigger');
      // Plain English, whatever its shape on the page.
      for (const word of ['datasource', 'abstraction', 'layer', 'lifecycle', 'hook', 'stubbing', 'state']) {
        expect(s).to.not.include(word);
      }
    });

    it('does not read a PascalCase prose word in concepts as a symbol', () => {
      // "library-supplied event factories over hand-built CustomEvents" is the
      // real bullet. `CustomEvents` is a prose plural of a DOM interface and is
      // absent from cht-core, so probing it manufactures a defect out of a
      // correct phrase. CODE_SIGNAL accepts it; the stricter concepts rule does
      // not, because a concepts bullet carries no backticks to mark intent.
      const s = syms(fm('concepts:',
        '  - library-supplied event factories over hand-built CustomEvents',
        '  - native DOM event dispatch',
        '  - CHT config validation'));
      expect(s).to.be.empty;
    });

    it('lets a per-item annotation suppress the item it annotates, and only that one', () => {
      // The 10784 repair: the bullet says what the probe would have said.
      const s = syms(fm('concepts:',
        '  - prepareForSave lifecycle hook (removed on master by the #10700 save-workflow rewrite, cccce201e)',
        '  - excludeNonRelevant submission pruning'));
      expect(s).to.not.include('prepareForSave');
      expect(s).to.include('excludeNonRelevant');
    });

    it('lets an annotation suppress an entities entry too', () => {
      const s = syms(fm('entities:',
        '  - resolveOwnerDoc (deleted — replaced by the save-workflow rewrite)',
        '  - findFileNodeByFilename'));
      expect(s).to.not.include('resolveOwnerDoc');
      expect(s).to.include('findFileNodeByFilename');
    });

    it('quotes the list item itself, so drift reads the annotation beside the claim', () => {
      // The quote is what every temporal screen keys on. A claim from a bullet
      // must carry THAT bullet, not the first prose line that happens to repeat
      // the token, or an annotation three lines up would excuse it.
      const raw = fm('concepts:', '  - prepareForSave lifecycle hook');
      const claim = enumerateClaims(raw).find(
        c => c.kind === 'symbol' && (c as { symbol: string }).symbol === 'prepareForSave'
      );
      expect(claim?.quote).to.equal('- prepareForSave lifecycle hook');
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

  describe('a quote that names one file and a claim that names another', () => {
    // 10344's Code Patterns is a `File:` list, one path per bullet. The model
    // paired `bindGenerator` (in the cht-datasource.service.ts bullet) with
    // local/libs/doc.ts from three bullets above. doc.ts correctly has 0 hits,
    // so a true claim came back as a misattribution — and the draft-wide guard
    // cannot see it, because doc.ts really is in the draft.
    const QUOTE = 'File: `webapp/src/ts/services/cht-datasource.service.ts` — `bindGenerator()` for generators.';
    const RAW = [
      '## Code Patterns',
      '',
      '- File: `shared-libs/cht-datasource/src/local/libs/doc.ts` — `getDocUuidsByIdRange()` for ID-only allDocs',
      `- ${QUOTE}`,
      '',
    ].join('\n');

    it('drops the location and checks the symbol alone', () => {
      const out = normaliseClaim(RAW, {
        kind: 'symbol-in-file',
        symbol: 'bindGenerator',
        file: 'shared-libs/cht-datasource/src/local/libs/doc.ts',
        quote: QUOTE,
      });
      expect(out?.kind).to.equal('symbol');
      expect((out as { file?: string } | null)?.file).to.equal(undefined);
    });

    it('keeps the pairing when the quote names that same file', () => {
      const out = normaliseClaim(RAW, {
        kind: 'symbol-in-file',
        symbol: 'bindGenerator',
        file: 'webapp/src/ts/services/cht-datasource.service.ts',
        quote: QUOTE,
      });
      expect(out?.kind).to.equal('symbol-in-file');
    });

    it('leaves a quote that names no path to the draft-wide check', () => {
      // No paths in the quote means no evidence either way, so the existing
      // behaviour must stand rather than this rule firing on everything.
      const out = normaliseClaim(RAW, {
        kind: 'symbol-in-file',
        symbol: 'bindGenerator',
        file: 'shared-libs/cht-datasource/src/local/libs/doc.ts',
        quote: 'the generator helper is bound once per call',
      });
      expect(out?.kind).to.equal('symbol-in-file');
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

    it('does not read a create verb spelled inside a FILENAME as a verb', () => {
      // Observed on cht-agent#122, draft 8336. "create" in the fixture name
      // ngo-create.xlsx matched ADD_VERB within reach of the next path, so a
      // file the PR only regenerated (M) was inferred as added and a true
      // sentence was reported as a defect.
      expect(statusOf(
        'Regenerated 53 config form fixtures plus the e2e and cht-form test fixtures ' +
          '(e.g. tests/e2e/default/contacts/forms/ngo-create.xlsx, ' +
          'tests/integration/cht-form/default/forms/dates.xml) to match the new pyxform output.',
        'tests/integration/cht-form/default/forms/dates.xml',
      )).to.equal(undefined);
    });

    it('still infers ADD when the verb is real and a pathy filename is nearby', () => {
      // The masking must not swallow a genuine claim that happens to sit beside
      // a path-shaped token.
      expect(statusOf(
        'Added tests/e2e/default/contacts/forms/ngo-create.xlsx as a new fixture.',
        'tests/e2e/default/contacts/forms/ngo-create.xlsx',
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

  describe('introduced-by — attribution, not existence', () => {
    const credited = (prose: string, symbol: string): number | undefined => {
      const c = enumerateClaims(`## Solution\n\n${prose}\n`)
        .find(x => x.kind === 'introduced-by' && (x as { symbol: string }).symbol === symbol);
      return (c as { prNumber?: number } | undefined)?.prNumber;
    };

    it('credits the sole PR in a create sentence', () => {
      // The #10071 shape: one PR named, one symbol, a create verb.
      expect(credited('The place half was added by PR #10099, which exports `createPlace`.', 'createPlace'))
        .to.equal(10099);
    });

    it('stays silent when two PRs share the sentence', () => {
      // A correct draft spanning PRs looks exactly like this; guessing one would
      // invent a defect.
      expect(credited("place's `createPlace` landed via #10065 and #10089.", 'createPlace'))
        .to.equal(undefined);
    });

    it('stays silent without a create verb', () => {
      expect(credited('#10099 aligned validation around `createPlace`.', 'createPlace'))
        .to.equal(undefined);
    });

    it('still emits the plain symbol claim alongside', () => {
      const claims = enumerateClaims('## Solution\n\nPR #10099 added `createPlace`.\n');
      expect(claims.some(c => c.kind === 'symbol' && (c as { symbol: string }).symbol === 'createPlace')).to.equal(true);
      expect(claims.some(c => c.kind === 'introduced-by')).to.equal(true);
    });

    // "and" does two jobs, and the clause rule has to tell them apart. Observed
    // on contacts 9835, ungrounded in three passes running: the second verb is
    // the one that governs the symbol, and reaching past it credits the PR with
    // introducing a helper it only widened.
    describe('a second verb after a conjunction', () => {
      it('does not credit a symbol the sentence says was merely generalized', () => {
        expect(credited(
          '`#10022` added `byReportQualifier` and generalized `hasField`/`hasFields` to take a descriptor.',
          'hasFields',
        )).to.equal(undefined);
      });

      it('still credits the first symbol in that same sentence', () => {
        expect(credited(
          '`#10022` added `byReportQualifier` and generalized `hasField`/`hasFields` to take a descriptor.',
          'byReportQualifier',
        )).to.equal(10022);
      });

      it('keeps crediting a plain conjoined list, where "and" is not a new verb', () => {
        // The regression risk of breaking on every "and": here `isPlace` really
        // was added by #10065 and must stay credited.
        expect(credited('#10065 added `createPlace` and `isPlace` to the local module.', 'isPlace'))
          .to.equal(10065);
      });

      it('does not credit across a contrastive verb', () => {
        expect(credited('#10099 added `createPlace` but renamed `isPlace` afterwards.', 'isPlace'))
          .to.equal(undefined);
      });
    });
  });

  // The literals the symbol probes could never see: a selector, an object
  // literal, a config line. #122 shipped one attributed to the wrong file.
  describe('a backticked literal bound to the file its sentence names', () => {
    const lits = (text: string): Array<{ literal: string; file: string; negated?: boolean }> =>
      enumerateClaims(text)
        .filter(c => c.kind === 'literal-in-file')
        .map(c => {
          const { literal, file, negated } = c as unknown as
            { literal: string; file: string; negated?: boolean };
          return negated === undefined ? { literal, file } : { literal, file, negated };
        });

    const NINE_THREE_OH_ONE =
      'The standalone `webapp/web-components/cht-form/src/app.component.ts` takes the subject summary ' +
      'as a `contactSummary` input and looks it up as `instance[id="contact-summary"]`.';

    it('extracts the selector and binds it to the file in that sentence', () => {
      expect(lits(NINE_THREE_OH_ONE)).to.deep.equal([{
        literal: 'instance[id="contact-summary"]',
        file: 'webapp/web-components/cht-form/src/app.component.ts',
      }]);
    });

    it('extracts it from the real 9301 draft bytes', () => {
      // FIXTURE: `9301-defective-a389ae0.md`, the draft as committed at the
      // promote branch head. The sentence is unchanged from 6e43e88 — the fix
      // for it is still a pending review suggestion.
      const hits = lits(fixture('9301-defective-a389ae0.md'));
      expect(hits.map(h => h.literal)).to.include('instance[id="contact-summary"]');
      expect(hits.find(h => h.literal === 'instance[id="contact-summary"]')?.file)
        .to.equal('webapp/web-components/cht-form/src/app.component.ts');
    });

    it('extracts the object literal the reviewer\'s replacement sentence quotes', () => {
      // The suggested repair: same file, the mechanism it really implements.
      const fixed = 'The standalone `webapp/web-components/cht-form/src/app.component.ts` takes the ' +
        'subject summary as a `contactSummary` input and tags it with the instance id this PR gave it ' +
        "(`{ id: 'contact-summary', context: value }`), then hands it to `EnketoService.renderForm`.";
      expect(lits(fixed).map(h => h.literal)).to.deep.equal(["{ id: 'contact-summary', context: value }"]);
    });

    it('refuses to guess when the sentence names two files', () => {
      expect(lits('Both `webapp/src/ts/services/form.service.ts` and ' +
        '`webapp/src/ts/services/xml-forms.service.ts` use `instance[id="contact-summary"]`.')).to.deep.equal([]);
    });

    it('inverts the reading for an outright negation', () => {
      const hits = lits('`webapp/web-components/cht-form/src/app.component.ts` does not look it up as ' +
        '`instance[id="contact-summary"]`.');
      expect(hits).to.have.lengthOf(1);
      expect(hits[0].negated).to.equal(true);
    });

    it('leaves an identifier written with its call suffix to the symbol probes', () => {
      // `getCurrentHref()` is declared `const getCurrentHref = () =>`, so
      // grepping the parenthesised form reports a true attribution as a defect.
      expect(lits('Extracted `webapp/src/js/enketo/lib/window.js` (`getCurrentHref()`) as a seam.'))
        .to.deep.equal([]);
    });

    it('ignores a backticked English phrase, however it was quoted', () => {
      // Nested backticks let a stray pairing capture prose outright; measured
      // on forms-and-reports as the literal `, carrying an`.
      expect(lits('See the `previous month` filter in `webapp/src/ts/modules/analytics/a.component.ts`.'))
        .to.deep.equal([]);
    });

    it('ignores how a thing is run: a shell command or an env assignment', () => {
      expect(lits('Run `npm run unit-webapp` against `webapp/tests/mocha/unit/enketo/x.spec.js`.'))
        .to.deep.equal([]);
      expect(lits('It must be stubbed under `UNIT_TEST_ENV=1` to satisfy the assertion in `api/src/db.js`.'))
        .to.deep.equal([]);
    });

    it('ignores a literal with its holes spelled out, or its middle elided', () => {
      expect(lits('The key is `sidebar_filter:analytics:<key>:select` in `webapp/src/ts/a.ts`.'))
        .to.deep.equal([]);
      expect(lits("`'user-file' + …` in `webapp/src/ts/services/enketo.service.ts`.")).to.deep.equal([]);
    });

    it('believes a sentence that puts the string inside a binary source', () => {
      expect(lits('The column header `instance::cht:duration` exists only inside the `.xlsx` workbook, ' +
        'not in `tests/e2e/default/enketo/forms/phone_widget.xlsx`.')).to.deep.equal([]);
    });

    it('says nothing when the sentence disclaims the thing it names', () => {
      expect(lits('Removed the `{ id: "contact-summary" }` shim from ' +
        '`webapp/src/ts/services/form.service.ts`.')).to.deep.equal([]);
    });
  });

  // A draft that says a COMMIT is gone is making a claim one `git for-each-ref`
  // settles, and #122's round 4 shipped one that was false. The sentence below is
  // the shape it took.
  describe('a commit the draft says is unreachable', () => {
    const shas = (text: string): string[] => enumerateClaims(text)
      .filter(c => c.kind === 'sha-unreachable')
      .map(c => (c as { sha: string }).sha);

    it('extracts the sha a squash is said to have swallowed', () => {
      expect(shas('The commit `70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87` is absent from a clone ' +
        'because the epic squashed it away.')).to.deep.equal(['70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87']);
    });

    it('reads an abbreviated sha too', () => {
      expect(shas('70b7be0b4 is unreachable from any branch.')).to.deep.equal(['70b7be0b4']);
    });

    it('needs the cue and the sha in ONE sentence, not merely on one line', () => {
      // This corpus writes a paragraph per line, so the line is far too coarse:
      // a squash mentioned in one sentence must not claim the next sentence's sha.
      expect(shas('The epic squashed it away. Separately, commit 70b7be0b4 landed on master.'))
        .to.deep.equal([]);
    });

    it('ignores an issue number, a date and a hex-looking English word', () => {
      expect(shas('Issue 10083 is unreachable, filed 20260817, and the cafefeed is absent from a clone.'))
        .to.deep.equal([]);
    });

    it('does not read "the commit stays reachable" as an absence claim', () => {
      expect(shas('The commit `70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87` stays reachable through the ' +
        'epic PR\'s durable pull ref.')).to.deep.equal([]);
    });

    it('says nothing about commits when the sentence makes no absence claim', () => {
      expect(shas('The fix landed as 70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87 on master.'))
        .to.deep.equal([]);
    });

    it('fires on the bytes that shipped the defect, and not on the repair', () => {
      // FIXTURES. `10180-defective-6e43e88.md` is the draft as committed at
      // scan-forms 6e43e88, whose Provenance says `source_sha` "is absent from
      // a clone because the epic squashed it away" — false; the commit is
      // reachable from refs/verify/pr10083. `10180-repaired-a389ae0.md` is the
      // same draft after the repair, which asserts reachability via the durable
      // pull ref instead. The repaired prose still discusses the commit at
      // length, so a cue-and-sha screen that is even slightly loose fires on it.
      // The sentence abbreviates, as prose does; the frontmatter carries the
      // full sha on a line of its own that asserts nothing.
      expect(shas(fixture('10180-defective-6e43e88.md'))).to.deep.equal(['70b7be0b4']);
      expect(shas(fixture('10180-repaired-a389ae0.md'))).to.deep.equal([]);
    });

    it('survives the disclaimer filters that silence ordinary existence claims', () => {
      // ABSENCE_CONTEXT exists to stop "removed X" being probed as "X exists".
      // Here the removal IS the claim, so the filter must not delete it.
      const claims = enumerateClaims('## Notes\n\nThe sha `70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87` was ' +
        'removed from history and is absent from a clone.\n');
      expect(claims.some(c => c.kind === 'sha-unreachable')).to.equal(true);
    });
  });

});
