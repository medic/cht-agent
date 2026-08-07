import { expect } from 'chai';
import {
  deriveVerifyScope,
  representativeScopeLine,
  ticketScopeLine,
  tier2SkipIsFatal,
} from '../../src/utils/verify-scope';
import { IssueTemplate } from '../../src/types';

const issue = (
  tc: Partial<IssueTemplate['issue']['technical_context']> = {}
): IssueTemplate => ({
  issue: {
    title: 'Child registration asks orphan status even after both parents are captured',
    type: 'bug',
    priority: 'medium',
    description: 'the orphan question is gated on age only',
    technical_context: {
      domain: 'contacts',
      components: [],
      layer: 'cht-conf',
      ...tc,
    },
    requirements: [],
    acceptance_criteria: [],
    constraints: [],
  },
} as IssueTemplate);

/**
 * m7's Technical Context, as `parseTicketFile` actually yields it: bullet prose
 * with the paths inline and a `:line` (or `:from-to`) suffix. Two of these name
 * the SAME second site, and two name the verified artifact.
 */
const M7_COMPONENTS = [
  'The `is_orphan` question is gated **only on age**, ignoring the',
  'forms/contact/e_household-create.xml:21441',
  'forms/contact/f_client-create.xml:19317',
  'The parent-status signals that should participate in the gate exist in',
  'e_household-create.xml:21329-21330',
  'f_client-create.xml:19314',
];

describe('verify-scope (representative-form scope)', () => {
  describe('deriveVerifyScope', () => {
    // The m7 shape: tier-1 asserts e_household-create; the ticket names another
    // copy of the same defect in a different form, which the run never touches.
    it('names the ticket sites the singular tier-1 oracle does NOT verify', () => {
      const scope = deriveVerifyScope(
        issue({ configArtifact: 'contact-form', artifactName: 'e_household-create', components: M7_COMPONENTS })
      );

      expect(scope.verified).to.equal('e_household-create');
      expect(scope.unverified).to.deep.equal(['forms/contact/f_client-create.xml']);
    });

    it('strips the :line suffix and de-duplicates a site named twice', () => {
      const scope = deriveVerifyScope(
        issue({
          configArtifact: 'form',
          artifactName: 'pregnancy_home_visit',
          components: ['forms/app/other.xml:12', 'other.xml:99-104', '`forms/app/other.xml`'],
        })
      );

      expect(scope.unverified).to.deep.equal(['forms/app/other.xml']);
    });

    it('returns nothing for a single-artifact ticket (the verified form only)', () => {
      const scope = deriveVerifyScope(
        issue({
          configArtifact: 'contact-form',
          artifactName: 'f_client-create',
          components: [
            'Broken bind — `forms/contact/f_client-create.xml:19310`:',
            'Same defect on the sibling field `hh_member_occupation`',
          ],
        })
      );

      expect(scope.unverified).to.deep.equal([]);
      expect(representativeScopeLine(scope)).to.equal(undefined);
    });

    // The compiled-settings oracle compares the WHOLE compiled tasks section, so
    // a task ticket naming tasks.js has no unverified site — warning there would
    // be crying wolf on every settings ticket.
    it('treats tasks.js as covered for a task ticket (m3) but not for a contact-summary one (m4)', () => {
      const m3 = deriveVerifyScope(
        issue({
          domain: 'tasks-and-targets',
          configArtifact: 'task',
          artifactName: 'newborn-immunization-followup',
          components: ['The newborn follow-up task (`tasks.js:1341-1370`) is', 'Its `resolvedIf` (`tasks.js:1368`) is broken'],
        })
      );
      expect(m3.unverified).to.deep.equal([]);

      const m4 = deriveVerifyScope(
        issue({
          domain: 'tasks-and-targets',
          configArtifact: 'contact-summary',
          artifactName: 'is_immunization_defaulter',
          components: [
            '**Broken (length inequality)** — `contact-summary.templated.js:175`',
            'Downstream: `postnatal_care_service_newborn.xml:558` consumes the flag',
            'Related dead code: `tasks.js:1007` keys a task off it',
          ],
        })
      );
      expect(m4.unverified).to.deep.equal(['postnatal_care_service_newborn.xml', 'tasks.js']);
    });

    it('ignores scaffolding, node_modules and spec files — they are never deployment sites', () => {
      const scope = deriveVerifyScope(
        issue({
          configArtifact: 'form',
          artifactName: 'pregnancy_home_visit',
          components: [
            'pin the surface in `test/forms/pregnancy_home_visit.spec.js`',
            'the harness args live in `harness.defaults.json`',
            'bumped in `package.json`',
            'vendored copy at node_modules/cht-conf-test-harness/index.js',
          ],
        })
      );

      expect(scope.unverified).to.deep.equal([]);
    });

    it('parses defensively — no paths, no components, no crash', () => {
      expect(deriveVerifyScope(issue({ components: [] })).unverified).to.deep.equal([]);
      expect(
        deriveVerifyScope(issue({ components: ['prose with no path at all', '', 'convert-contact-forms'] })).unverified
      ).to.deep.equal([]);
      // A ticket whose components arrived as non-strings (hand-written YAML) must
      // not throw the QA phase.
      const junk = issue({ components: [null, 42, { path: 'x.xml' }] as unknown as string[] });
      expect(deriveVerifyScope(junk).unverified).to.deep.equal([]);
    });

    it('also reads existing_references, the other ticket field carrying paths', () => {
      const scope = deriveVerifyScope(
        issue({
          configArtifact: 'form',
          artifactName: 'pregnancy_home_visit',
          existing_references: ['forms/app/postnatal_care.xml'],
        })
      );

      expect(scope.unverified).to.deep.equal(['forms/app/postnatal_care.xml']);
    });
  });

  describe('representativeScopeLine', () => {
    it('says what tier-1 verified and how many named sites it did not', () => {
      const line = ticketScopeLine(
        issue({ configArtifact: 'contact-form', artifactName: 'e_household-create', components: M7_COMPONENTS })
      );

      expect(line).to.contain('tier-1 verified e_household-create');
      expect(line).to.contain('1 further site(s) named by this ticket are NOT deployment-verified');
      expect(line).to.contain('forms/contact/f_client-create.xml');
    });

    it('caps the named sites and counts the overflow', () => {
      const line = representativeScopeLine({
        verified: 'a',
        unverified: ['b.xml', 'c.xml', 'd.xml', 'e.xml', 'f.xml', 'g.xml', 'h.xml'],
      });

      expect(line).to.contain('7 further site(s)');
      expect(line).to.contain('+2 more');
      expect(line).to.not.contain('h.xml');
    });

    it('is silent when nothing is unverified', () => {
      expect(representativeScopeLine({ verified: 'a', unverified: [] })).to.equal(undefined);
    });
  });

  describe('tier2SkipIsFatal', () => {
    // Today's honest-skip semantics, preserved for the single-artifact case.
    it('leaves a skip free when tier-1 covered every site the ticket names', () => {
      expect(tier2SkipIsFatal({ pinnedSpecs: true, unverifiedSites: 0 })).to.equal(false);
    });

    it('leaves a skip free when the ticket pinned no regression surface', () => {
      expect(tier2SkipIsFatal({ pinnedSpecs: false, unverifiedSites: 3 })).to.equal(false);
    });

    it('condemns a skipped pin on a ticket with sites tier-1 never verified', () => {
      expect(tier2SkipIsFatal({ pinnedSpecs: true, unverifiedSites: 1 })).to.equal(true);
    });
  });
});
