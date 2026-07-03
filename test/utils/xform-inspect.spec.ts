import { expect } from 'chai';
import { decodeXmlAttr, extractBindRelevant, verifyFormBinds } from '../../src/utils/xform-inspect';
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
    });
  });
});
