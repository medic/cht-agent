import { expect } from 'chai';
import {
  bindExists,
  decodeXmlAttr,
  extractBindRelevant,
  extractTopLevelGroupBinds,
  verifyFormBinds,
} from '../../src/utils/xform-inspect';
import { FormBindExpectation } from '../../src/types';

// The PNC demo's yes-only gate (correct) and the planted, widened gate (buggy).
const YES_GATE = "selected(../pregnancy_summary/visit_option, 'yes')";
const PLANTED_GATE =
  "selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')";

// A minimal <model> with the three sibling group binds the PNC ticket names,
// plus a child bind so exact-nodeset matching can be exercised.
const modelXml = (dangerRelevant: string): string =>
  '<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms">' +
  '<h:head><model>' +
  `<bind nodeset="/data/pregnancy_ended" relevant="not(${YES_GATE})"/>` +
  `<bind nodeset="/data/danger_signs" relevant="${dangerRelevant}"/>` +
  '<bind nodeset="/data/danger_signs/r_danger_sign_present" type="string" relevant="true()"/>' +
  `<bind nodeset="/data/safe_pregnancy_practices" relevant="${YES_GATE}"/>` +
  `<bind nodeset="/data/summary" relevant="${YES_GATE}"/>` +
  '</model></h:head></h:html>';

const PLANTED_XML = modelXml(PLANTED_GATE);
const CORRECTED_XML = modelXml(YES_GATE);

const EXPECTATIONS: FormBindExpectation[] = [
  { nodeset: '/data/danger_signs', relevant: YES_GATE },
  { nodeset: '/data/safe_pregnancy_practices', relevant: YES_GATE },
  { nodeset: '/data/summary', relevant: YES_GATE },
];

describe('xform-inspect', () => {
  describe('extractBindRelevant', () => {
    it('reads the target bind relevant from the planted XML', () => {
      expect(extractBindRelevant(PLANTED_XML, '/data/danger_signs')).to.equal(PLANTED_GATE);
    });

    it('matches the exact nodeset, not a longer child bind', () => {
      // /data/danger_signs must return the GROUP bind, not the child field bind.
      expect(extractBindRelevant(CORRECTED_XML, '/data/danger_signs')).to.equal(YES_GATE);
      expect(extractBindRelevant(CORRECTED_XML, '/data/danger_signs/r_danger_sign_present')).to.equal('true()');
    });

    it('returns undefined for a bind that does not exist', () => {
      expect(extractBindRelevant(CORRECTED_XML, '/data/nope')).to.equal(undefined);
    });
  });

  describe('decodeXmlAttr', () => {
    it('decodes the entities xls2xform emits in attribute values', () => {
      expect(decodeXmlAttr('. &lt;= today() &amp;&amp; x &gt; 0')).to.equal('. <= today() && x > 0');
      expect(decodeXmlAttr("selected(x, &apos;yes&apos;)")).to.equal("selected(x, 'yes')");
      expect(decodeXmlAttr('a &#39;b&#39; c')).to.equal("a 'b' c");
    });
  });

  describe('extractTopLevelGroupBinds', () => {
    it('returns the /data top-level group binds (existing behavior, unchanged)', () => {
      const binds = extractTopLevelGroupBinds(CORRECTED_XML);
      // /data/danger_signs (group) + /data/safe_pregnancy_practices + /data/summary +
      // /data/pregnancy_ended — but NOT the child /data/danger_signs/r_danger_sign_present.
      const nodesets = binds.map((b) => b.nodeset);
      expect(nodesets).to.include('/data/danger_signs');
      expect(nodesets).to.include('/data/safe_pregnancy_practices');
      expect(nodesets).to.include('/data/summary');
      expect(nodesets).to.include('/data/pregnancy_ended');
      expect(nodesets).to.not.include('/data/danger_signs/r_danger_sign_present');
    });

    // F2 (mission 05 follow-up): real partner forms use the form id as the
    // primary-instance root, not /data. The binds below are shaped after the
    // demo-conf postnatal_care_service form (copied at authoring time; the
    // partner repo is never read at test runtime). The old hardcoded /data
    // regex returned [] for these, aborting QA's deriveVerifyOptions.
    describe('non-/data instance root (e.g. /postnatal_care_service)', () => {
      const PNC_XML =
        '<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms">' +
        '<h:head><model>' +
        '<bind nodeset="/postnatal_care_service/inputs/source" type="string" relevant="hidden"/>' +
        '<bind nodeset="/postnatal_care_service/group_follow_up" relevant="./client_available = \'yes\'"/>' +
        '<bind nodeset="/postnatal_care_service/group_follow_up/n_remind" type="string" relevant="./client_available = \'no\'"/>' +
        '<bind nodeset="/postnatal_care_service/group_mother_pnc_danger_signs" relevant="./condition = \'alive\'"/>' +
        '<bind nodeset="/postnatal_care_service/group_mother_pnc_danger_signs/mother_danger_signs_other" type="string" relevant="selected(../mother_danger_signs, \'other\')"/>' +
        '</model></h:head></h:html>';

      it('derives the /postnatal_care_service root and returns its two-segment group binds', () => {
        const binds = extractTopLevelGroupBinds(PNC_XML);
        const nodesets = binds.map((b) => b.nodeset);
        expect(nodesets).to.deep.equal([
          '/postnatal_care_service/group_follow_up',
          '/postnatal_care_service/group_mother_pnc_danger_signs',
        ]);
      });

      it('excludes deeper (child/nested) binds and the inputs subtree', () => {
        const nodesets = extractTopLevelGroupBinds(PNC_XML).map((b) => b.nodeset);
        // three-segment child binds are excluded
        expect(nodesets).to.not.include('/postnatal_care_service/group_follow_up/n_remind');
        expect(nodesets).to.not.include(
          '/postnatal_care_service/group_mother_pnc_danger_signs/mother_danger_signs_other'
        );
        // /postnatal_care_service/inputs/source is three-segment, so excluded too
        expect(nodesets).to.not.include('/postnatal_care_service/inputs/source');
      });

      it('decodes entities in the returned relevant expressions for a non-/data root', () => {
        const xml =
          '<model><bind nodeset="/postnatal_care_service/group_x" relevant="a &gt; b"/></model>';
        const binds = extractTopLevelGroupBinds(xml);
        expect(binds).to.have.length(1);
        expect(binds[0].relevant).to.equal('a > b');
      });
    });

    it('returns [] when the XML has no multi-segment absolute bind nodeset', () => {
      // nothing to derive a root from -> empty snapshot (fail-closed for QA)
      expect(extractTopLevelGroupBinds('<model><bind nodeset="/data"/></model>')).to.deep.equal([]);
      expect(extractTopLevelGroupBinds('<model></model>')).to.deep.equal([]);
    });
  });

  describe('verifyFormBinds', () => {
    it('FAILS on the planted XML — danger_signs mismatches, siblings unchanged (reproduction)', () => {
      const result = verifyFormBinds(PLANTED_XML, EXPECTATIONS);

      expect(result.passed).to.equal(false);
      const danger = result.checks.find((c) => c.nodeset === '/data/danger_signs');
      expect(danger?.passed).to.equal(false);
      expect(danger?.actual).to.equal(PLANTED_GATE);
      // The sibling binds are unchanged and must still pass — the failure is
      // isolated to danger_signs (the "only miscarriage misfires" diagnostic).
      const siblings = result.checks.filter((c) => c.nodeset !== '/data/danger_signs');
      expect(siblings.every((c) => c.passed)).to.equal(true);
    });

    it('PASSES on the corrected XML — every bind matches (fix proof)', () => {
      const result = verifyFormBinds(CORRECTED_XML, EXPECTATIONS);

      expect(result.passed).to.equal(true);
      expect(result.checks.every((c) => c.passed)).to.equal(true);
    });

    it('fails a check when an expected bind is missing from the XML', () => {
      const result = verifyFormBinds(CORRECTED_XML, [{ nodeset: '/data/ghost', relevant: YES_GATE }]);

      expect(result.passed).to.equal(false);
      expect(result.checks[0].note).to.match(/not found/);
      // Absent (no <bind> tag at all) — no `actual` recorded, distinct note.
      expect(result.checks[0].actual).to.equal(undefined);
    });

    // F5: distinguish a bind PRESENT-but-without-relevant from an ABSENT bind.
    // The deployed child bind exists (the group renders) but was never gated —
    // it must count as a MISMATCH (expected "<expr>", actual "(none)"), so the
    // reproduce step fires RED, not a silent pass and not a "bind not found" that
    // reads as a wiring error.
    describe('F5 — expected relevant vs a deployed bind that lacks the attribute', () => {
      const PRESENT_NO_RELEVANT =
        '<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms">' +
        '<h:head><model>' +
        // present, but NO relevant — the still-buggy deployed child bind
        '<bind nodeset="/data/danger_signs/next_pnc_visit_date" type="date"/>' +
        '</model></h:head></h:html>';

      it('registers a present-but-unrelevant bind as a MISMATCH with actual "(none)"', () => {
        const result = verifyFormBinds(PRESENT_NO_RELEVANT, [
          { nodeset: '/data/danger_signs/next_pnc_visit_date', relevant: YES_GATE },
        ]);

        expect(result.passed).to.equal(false);
        const check = result.checks[0];
        expect(check.passed).to.equal(false);
        expect(check.expected).to.equal(YES_GATE);
        expect(check.actual).to.equal('(none)');
        // Honest message: the fix was not deployed — NOT "bind not found".
        expect(check.note).to.match(/present but carries no relevant/);
        expect(check.note).to.not.match(/not found/);
      });

      it('a genuinely absent bind keeps the distinct "bind not found" note (no actual)', () => {
        const result = verifyFormBinds(PRESENT_NO_RELEVANT, [
          { nodeset: '/data/does_not_exist', relevant: YES_GATE },
        ]);

        expect(result.passed).to.equal(false);
        const check = result.checks[0];
        expect(check.actual).to.equal(undefined);
        expect(check.note).to.match(/bind not found/);
      });
    });
  });

  describe('bindExists', () => {
    it('true for a bind present with a relevant, and present without one', () => {
      expect(bindExists(CORRECTED_XML, '/data/danger_signs')).to.equal(true);
      expect(
        bindExists('<model><bind nodeset="/data/x" type="date"/></model>', '/data/x')
      ).to.equal(true);
    });

    it('false for an absent bind, and does not match a longer child nodeset', () => {
      expect(bindExists(CORRECTED_XML, '/data/nope')).to.equal(false);
      // exact-quote match: /data/danger_signs must not match /data/danger_signs/child
      expect(
        bindExists('<model><bind nodeset="/data/danger_signs/child"/></model>', '/data/danger_signs')
      ).to.equal(false);
    });
  });
});
