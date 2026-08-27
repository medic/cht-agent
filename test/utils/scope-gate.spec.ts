import { expect } from 'chai';
import {
  HC5_ACCEPTED_NOTE,
  HC5_PROMOTED_NOTE,
  PROTECTED_COVERAGE_THRESHOLD,
  SCOPE_GATE_OPTIONS,
  ScopeGateDecision,
  assessScope,
  attributeTier2,
  buildScopeGateDecision,
  buildWidenBrief,
  buildWidenedTicket,
  detectConflicts,
  parseScopeGateChoice,
  readConstraint,
  readConstraints,
  renderScopeAbandonBanner,
  renderScopeGatePanel,
  scopeGateOptions,
  significantWords,
  stampHumanDecision,
} from '../../src/utils/scope-gate';
import { IssueTemplate, QaResult, QaTier2Result, TriagedRecommendation } from '../../src/types';

/**
 * The two constraints of the live m4 ticket
 * (tickets/maisha-m4-immunization-defaulter-false-positive.md), VERBATIM with the
 * markdown bullet's continuation lines joined. HC5's conflict detector was
 * calibrated against exactly these; if a threshold moves, these numbers are what
 * moved under it.
 */
const M4_CONSTRAINT_1 =
  'Surgical: predicate replacement only; do not change vaccine schedules, ' +
  '`countTotalVaccinesByAge`, or form logic.';
const M4_CONSTRAINT_2 =
  "Regression surface: the partner repo's `test/contact-summary.spec.js` and " +
  '`test/targets/` immunization specs must stay green; add a case for the over-immunized child.';

const rec = (overrides: Partial<TriagedRecommendation> & { text: string }): TriagedRecommendation => ({
  severity: 'blocking',
  signal: 'correctness-verb',
  anchors: [],
  targetFiles: [],
  disposition: 'deferred',
  deferralReason: 'score above the refinement threshold; recorded only',
  firstRaisedOnIteration: 1,
  lastRaisedOnIteration: 1,
  ...overrides,
});

/** The three recommendations m4's validator raised and the loop deferred. */
const M4_DEFERRED = [
  rec({ text: 'Add opv0 to the birth entry of totalVaccinesDueByAge so newborns are scored correctly.' }),
  rec({ text: 'The yellow_fever rule is missing — re-add the yellow_fever rule to totalVaccinesDueByAge.' }),
  rec({ text: 'Key the measles entries in totalVaccinesDueByAge off months (9/18), not weeks.' }),
];

/** The change the ticket REQUIRES — it must never read as a conflict. */
const M4_REQUIRED_FIX = rec({
  text: 'Replace the length inequality with vaccinesNotReceivedByAge(contact, reports).length > 0.',
});

const ticketWith = (constraints: string[], requirements: string[] = ['Replace the predicate']): IssueTemplate => ({
  issue: {
    title: 'Fully-immunized children incorrectly flagged for defaulter tracing',
    type: 'bug',
    priority: 'high',
    description: 'The length-inequality predicate flags over-immunized children.',
    technical_context: { domain: 'tasks-and-targets', components: [], layer: 'cht-conf' },
    requirements,
    acceptance_criteria: ['Over-immunized children are not flagged'],
    constraints,
  },
});

const tier2 = (overrides: Partial<QaTier2Result> = {}): QaTier2Result => ({
  ran: true,
  passed: false,
  outputTail: '  1) contact-summary defaulter flag\n  AssertionError: expected no to equal yes\n\n  3 failing\n',
  specs: ['test/contact-summary.spec.js'],
  ...overrides,
});

const qaWith = (t2?: QaTier2Result): QaResult => ({
  ran: true,
  approved: true,
  reproduced: true,
  verified: true,
  succeeded: true,
  messages: [],
  ...(t2 ? { tier2: t2 } : {}),
});

describe('scope-gate (HC5) — significantWords', () => {
  it('splits camelCase identifiers, singularizes and drops stopwords', () => {
    expect([...significantWords('countTotalVaccinesByAge')].sort())
      .to.deep.equal(['age', 'count', 'total', 'vaccine']);
  });

  it('folds plurals so `vaccines`/`vaccine` and `schedules`/`schedule` match', () => {
    expect([...significantWords('vaccine schedules')].sort()).to.deep.equal(['schedule', 'vaccine']);
  });
});

describe('scope-gate (HC5) — readConstraint on the verbatim m4 constraints', () => {
  it('parses constraint 1 into its three protected surfaces', () => {
    const facts = readConstraint(M4_CONSTRAINT_1, 1);
    expect(facts.index).to.equal(1);
    expect(facts.prohibitive).to.equal(true);
    expect(facts.protectedSurfaces.map(s => s.label))
      .to.deep.equal(['vaccine schedules', 'countTotalVaccinesByAge', 'form logic']);
    const words = facts.protectedSurfaces.map(s => [...s.words].sort());
    expect(words[0]).to.deep.equal(['schedule', 'vaccine']);
    expect(words[1]).to.deep.equal(['age', 'count', 'total', 'vaccine']);
    expect(words[2]).to.deep.equal(['form', 'logic']);
  });

  // "Surgical" and "only" both fire: every deferral widens this ticket, which is
  // the backstop for a constraint whose surfaces the symbol test cannot name.
  it('flags constraint 1 as scope-limiting', () => {
    expect(readConstraint(M4_CONSTRAINT_1, 1).scopeLimiting).to.equal(true);
  });

  it('extracts constraint 2\'s protected paths and suppresses a bare `test/`', () => {
    const facts = readConstraint(M4_CONSTRAINT_2, 2);
    expect(facts.protectedPaths).to.deep.equal(['test/contact-summary.spec.js', 'test/targets/']);
    // No prohibition marker → no protected symbols, and it declares no scope limit.
    expect(facts.prohibitive).to.equal(false);
    expect(facts.protectedSurfaces).to.deep.equal([]);
    expect(facts.scopeLimiting).to.equal(false);
  });

  it('numbers constraints 1-based off the ticket, in order', () => {
    const facts = readConstraints(ticketWith([M4_CONSTRAINT_1, M4_CONSTRAINT_2]));
    expect(facts.map(f => f.index)).to.deep.equal([1, 2]);
    expect(facts[1].text).to.equal(M4_CONSTRAINT_2);
  });

  it('returns nothing protected for a constraint with neither marker nor path', () => {
    const facts = readConstraint('Ship it before Friday.', 1);
    expect(facts.prohibitive).to.equal(false);
    expect(facts.scopeLimiting).to.equal(false);
    expect(facts.protectedSurfaces).to.deep.equal([]);
    expect(facts.protectedPaths).to.deep.equal([]);
  });
});

describe('scope-gate (HC5) — detectConflicts against the real m4 shape', () => {
  const constraints = readConstraints(ticketWith([M4_CONSTRAINT_1, M4_CONSTRAINT_2]));

  it('fires on all three deferred recommendations, on the countTotalVaccinesByAge surface', () => {
    const conflicts = detectConflicts({ recommendations: M4_DEFERRED, constraints });
    expect(conflicts).to.have.length(3);
    for (const conflict of conflicts) {
      expect(conflict.kind).to.equal('protected-symbol');
      expect(conflict.constraintIndex).to.equal(1);
      expect(conflict.surface).to.equal('countTotalVaccinesByAge');
      // 3 of the surface's 4 words = 75%, printed so a human can overrule it.
      expect(conflict.evidence).to.contain('3 of 4 word(s)');
      expect(conflict.evidence).to.contain('(75%)');
    }
    expect(conflicts.map(c => c.recommendation)).to.deep.equal(M4_DEFERRED.map(r => r.text));
  });

  // The whole point of the 2/3 threshold: 0.75 (a real conflict) sits above it and
  // 0.50 (the predicate swap the ticket demands) sits below it.
  it('does NOT fire on the predicate replacement the ticket requires', () => {
    const conflicts = detectConflicts({ recommendations: [M4_REQUIRED_FIX], constraints });
    expect(conflicts).to.deep.equal([]);
    expect(PROTECTED_COVERAGE_THRESHOLD).to.be.greaterThan(0.5);
    expect(PROTECTED_COVERAGE_THRESHOLD).to.be.at.most(0.75);
  });

  it('does NOT fire on cosmetic recommendations', () => {
    const cosmetic = [
      rec({ text: 'Add a spec case for the over-immunized child.' }),
      rec({ text: 'Rename the local variable `flag` to `isDefaulter` for readability.' }),
    ];
    expect(detectConflicts({ recommendations: cosmetic, constraints })).to.deep.equal([]);
  });

  // The classic "make the test green" smell: editing the declared regression surface.
  it('fires protected-file when a recommendation names the protected spec', () => {
    const conflicts = detectConflicts({
      recommendations: [rec({ text: 'Update test/contact-summary.spec.js so the new predicate passes.' })],
      constraints,
    });
    expect(conflicts).to.have.length(1);
    expect(conflicts[0].kind).to.equal('protected-file');
    expect(conflicts[0].constraintIndex).to.equal(2);
    expect(conflicts[0].surface).to.equal('test/contact-summary.spec.js');
    expect(conflicts[0].evidence).to.contain('protected regression surface');
  });

  it('fires protected-file off targetFiles, not just the prose', () => {
    const conflicts = detectConflicts({
      recommendations: [rec({
        text: 'Cover the over-immunized child.',
        targetFiles: ['test/targets/immunization.spec.js'],
      })],
      constraints,
    });
    expect(conflicts.map(c => c.surface)).to.deep.equal(['test/targets/']);
  });

  it('a generic-only word overlap is not enough to carry a conflict', () => {
    // "form logic" => {form, logic}; `logic` is generic, so a 50% overlap on it alone
    // must not fire (and even at 100% the non-generic guard would still refuse).
    const conflicts = detectConflicts({
      recommendations: [rec({ text: 'Simplify the logic.' })],
      constraints,
    });
    expect(conflicts).to.deep.equal([]);
  });

  /**
   * HONEST LIMIT, exercised on purpose. utils/ticket-parser's extractBulletList
   * keeps only the first LINE of a markdown bullet, so the m4 constraint reaches
   * the pipeline truncated at the line break and `countTotalVaccinesByAge` is
   * never seen. The symbol test then misses — and the scope-limit backstop is
   * what still opens the gate.
   */
  it('degrades to the scope-limit backstop when the parser truncates the constraint', () => {
    const truncated = 'Surgical: predicate replacement only; do not change vaccine schedules,';
    const facts = readConstraints(ticketWith([truncated]));
    expect(facts[0].protectedSurfaces.map(s => s.label)).to.deep.equal(['vaccine schedules']);
    expect(detectConflicts({ recommendations: M4_DEFERRED, constraints: facts })).to.deep.equal([]);
    expect(facts[0].scopeLimiting).to.equal(true);
    const findings = assessScope({ ticket: ticketWith([truncated]), ledger: M4_DEFERRED });
    expect(findings.opens).to.equal(true);
    expect(findings.scopeLimited).to.have.length(1);
  });
});

describe('scope-gate (HC5) — attributeTier2', () => {
  it('reports nothing when tier-2 did not run or passed', () => {
    expect(attributeTier2(undefined).failed).to.equal(false);
    expect(attributeTier2(qaWith(tier2({ ran: false, passed: undefined }))).failed).to.equal(false);
    expect(attributeTier2(qaWith(tier2({ passed: true }))).failed).to.equal(false);
  });

  it('counts NEW failures against a parseable baseline', () => {
    const attribution = attributeTier2(qaWith(tier2({ baseline: { ran: true, passed: false, failing: 1 } })));
    expect(attribution.failed).to.equal(true);
    expect(attribution.newFailures).to.equal(2);
    expect(attribution.unattributed).to.equal(false);
    expect(attribution.line).to.contain('NEW failure(s)');
    expect(attribution.excerpt).to.contain('AssertionError');
  });

  // Unknown must never read as "none", or a real regression is silently excused.
  it('treats an unavailable baseline as unattributed, never as zero', () => {
    const attribution = attributeTier2(qaWith(tier2()));
    expect(attribution.failed).to.equal(true);
    expect(attribution.newFailures).to.equal(undefined);
    expect(attribution.unattributed).to.equal(true);
    expect(attribution.line).to.contain('NOT attributed');
  });
});

describe('scope-gate (HC5) — assessScope', () => {
  it('opens on blocking deferrals with QA absent entirely', () => {
    const findings = assessScope({ ticket: ticketWith([M4_CONSTRAINT_1]), ledger: M4_DEFERRED });
    expect(findings.opens).to.equal(true);
    expect(findings.open).to.have.length(3);
    expect(findings.conflicts).to.have.length(3);
    expect(findings.scopeLimited).to.have.length(1);
    expect(findings.reason).to.contain('3 correctness recommendation(s) recorded and NOT applied');
    expect(findings.tier2.failed).to.equal(false);
  });

  it('opens on new tier-2 failures with an empty ledger', () => {
    const findings = assessScope({
      ticket: ticketWith([]),
      ledger: [],
      qa: qaWith(tier2({ baseline: { ran: true, passed: false, failing: 1 } })),
    });
    expect(findings.opens).to.equal(true);
    expect(findings.open).to.deep.equal([]);
    expect(findings.reason).to.contain('tier-2 reports 2 NEW failure(s)');
  });

  it('opens when tier-2 failed and no baseline could attribute it', () => {
    const findings = assessScope({ ticket: ticketWith([]), ledger: [], qa: qaWith(tier2()) });
    expect(findings.opens).to.equal(true);
    expect(findings.reason).to.contain('treated as possibly new');
  });

  it('stays shut when the ledger holds only advisory/applied entries and tier-2 passed', () => {
    const findings = assessScope({
      ticket: ticketWith([M4_CONSTRAINT_1]),
      ledger: [
        rec({ text: 'Consider extracting a helper.', severity: 'advisory' }),
        rec({
          text: 'Add opv0 to the birth entry of totalVaccinesDueByAge.',
          disposition: 'applied',
          deferralReason: undefined,
          evidence: 'regenerated common-extras.js',
        }),
      ],
      qa: qaWith(tier2({ passed: true })),
    });
    expect(findings.opens).to.equal(false);
    expect(findings.reason).to.equal('');
    // No open deferral ⇒ nothing widens the scope limit, so it is not reported.
    expect(findings.scopeLimited).to.deep.equal([]);
    expect(findings.conflicts).to.deep.equal([]);
  });

  it('stays shut on a clean run with no ledger at all', () => {
    expect(assessScope({ ticket: ticketWith([]), ledger: [] }).opens).to.equal(false);
  });
});

describe('scope-gate (HC5) — the offered choices', () => {
  const findingsFor = (ledger: TriagedRecommendation[], constraints: string[]) =>
    assessScope({ ticket: ticketWith(constraints), ledger });

  it('offers only accept/abandon when the sole signal is tier-2', () => {
    const findings = assessScope({ ticket: ticketWith([]), ledger: [], qa: qaWith(tier2()) });
    expect(scopeGateOptions(findings)).to.deep.equal([
      SCOPE_GATE_OPTIONS.accept,
      SCOPE_GATE_OPTIONS.abandon,
    ]);
  });

  // DEMO SAFETY CUT: scopeGateOptions currently returns accept/abandon only, so
  // the widen branches below are unreachable. They encode the DESIGNED behaviour
  // and are the coverage that comes back with it — un-skip both when the early
  // return in scopeGateOptions is removed. Not rewritten: their assertions are
  // correct, the production code is deliberately narrowed.
  it.skip('adds widen once there is something to promote', () => {
    const findings = findingsFor(M4_DEFERRED, []);
    expect(findings.conflicts).to.deep.equal([]);
    expect(scopeGateOptions(findings)).to.deep.equal([
      SCOPE_GATE_OPTIONS.accept,
      SCOPE_GATE_OPTIONS.widen,
      SCOPE_GATE_OPTIONS.abandon,
    ]);
  });

  it.skip('adds widen-relax only when a conflict was detected', () => {
    const findings = findingsFor(M4_DEFERRED, [M4_CONSTRAINT_1]);
    expect(scopeGateOptions(findings)).to.deep.equal([
      SCOPE_GATE_OPTIONS.accept,
      SCOPE_GATE_OPTIONS.widen,
      SCOPE_GATE_OPTIONS['widen-relax'],
      SCOPE_GATE_OPTIONS.abandon,
    ]);
  });
});

describe('scope-gate (HC5) — parseScopeGateChoice', () => {
  it('round-trips every offered label', () => {
    expect(parseScopeGateChoice(SCOPE_GATE_OPTIONS.accept)).to.equal('accept');
    expect(parseScopeGateChoice(SCOPE_GATE_OPTIONS.widen)).to.equal('widen');
    expect(parseScopeGateChoice(SCOPE_GATE_OPTIONS['widen-relax'])).to.equal('widen-relax');
    expect(parseScopeGateChoice(SCOPE_GATE_OPTIONS.abandon)).to.equal('abandon');
  });

  it('accepts the bare verb with surrounding whitespace', () => {
    expect(parseScopeGateChoice('  widen-relax  ')).to.equal('widen-relax');
  });

  // Fails SAFE: an unreadable answer must never silently abandon or widen.
  it('falls back to accept on anything unrecognised', () => {
    expect(parseScopeGateChoice('')).to.equal('accept');
    expect(parseScopeGateChoice('yes please')).to.equal('accept');
    expect(parseScopeGateChoice('WIDEN')).to.equal('accept');
  });
});

describe('scope-gate (HC5) — buildScopeGateDecision', () => {
  const findings = assessScope({
    ticket: ticketWith([M4_CONSTRAINT_1, M4_CONSTRAINT_2]),
    ledger: M4_DEFERRED,
    qa: qaWith(tier2({ baseline: { ran: true, passed: false, failing: 1 } })),
  });

  it('promotes nothing and relaxes nothing on accept', () => {
    const decision = buildScopeGateDecision({ findings, choice: 'accept' });
    expect(decision.promoted).to.deep.equal([]);
    expect(decision.relaxedConstraints).to.deep.equal([]);
    expect(decision.newTier2Failures).to.equal(2);
    expect(decision.tier2Unattributed).to.equal(false);
    expect(decision.autoResolved).to.equal(undefined);
    expect(decision.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('promotes on widen but leaves the constraints alone', () => {
    const decision = buildScopeGateDecision({ findings, choice: 'widen' });
    expect(decision.promoted).to.deep.equal(M4_DEFERRED.map(r => r.text));
    expect(decision.relaxedConstraints).to.deep.equal([]);
  });

  it('relaxes exactly the conflicting constraints on widen-relax, de-duplicated', () => {
    const decision = buildScopeGateDecision({ findings, choice: 'widen-relax' });
    expect(decision.promoted).to.have.length(3);
    // All three conflicts sit on constraint 1, so it is named once.
    expect(decision.relaxedConstraints).to.deep.equal([M4_CONSTRAINT_1]);
  });

  it('records why it did not prompt when the run was non-interactive', () => {
    const decision = buildScopeGateDecision({
      findings, choice: 'accept', autoResolved: 'non-interactive run (--qa-auto)',
    });
    expect(decision.autoResolved).to.equal('non-interactive run (--qa-auto)');
  });
});

describe('scope-gate (HC5) — buildWidenedTicket', () => {
  const ticket = ticketWith([M4_CONSTRAINT_1, M4_CONSTRAINT_2], ['Replace the predicate']);
  const findings = assessScope({ ticket, ledger: M4_DEFERRED });

  it('appends the promoted recommendations to requirements, tagged', () => {
    const decision = buildScopeGateDecision({ findings, choice: 'widen' });
    const widened = buildWidenedTicket(ticket, decision);
    expect(widened.issue.requirements).to.have.length(4);
    expect(widened.issue.requirements[0]).to.equal('Replace the predicate');
    for (const promoted of widened.issue.requirements.slice(1)) {
      expect(promoted).to.contain('[PROMOTED AT HUMAN REVIEW (HC5)');
    }
    expect(widened.issue.requirements[1]).to.contain('Add opv0 to the birth entry');
  });

  it('leaves every constraint verbatim on plain widen', () => {
    const decision = buildScopeGateDecision({ findings, choice: 'widen' });
    expect(buildWidenedTicket(ticket, decision).issue.constraints)
      .to.deep.equal([M4_CONSTRAINT_1, M4_CONSTRAINT_2]);
  });

  it('rewrites ONLY the conflicting constraint on widen-relax', () => {
    const decision = buildScopeGateDecision({ findings, choice: 'widen-relax' });
    const constraints = buildWidenedTicket(ticket, decision).issue.constraints;
    expect(constraints[0]).to.contain(M4_CONSTRAINT_1);
    expect(constraints[0]).to.contain('[RELAXED AT HUMAN REVIEW (HC5)');
    expect(constraints[0]).to.contain('ONLY as far as a promoted requirement demands');
    expect(constraints[1]).to.equal(M4_CONSTRAINT_2);
  });

  // The ORIGINAL ticket keeps driving QA, so a mutation here would silently
  // renegotiate the assertions too.
  it('never mutates the input ticket', () => {
    const decision = buildScopeGateDecision({ findings, choice: 'widen-relax' });
    buildWidenedTicket(ticket, decision);
    expect(ticket.issue.requirements).to.deep.equal(['Replace the predicate']);
    expect(ticket.issue.constraints).to.deep.equal([M4_CONSTRAINT_1, M4_CONSTRAINT_2]);
  });
});

describe('scope-gate (HC5) — buildWidenBrief', () => {
  const findings = assessScope({ ticket: ticketWith([M4_CONSTRAINT_1]), ledger: M4_DEFERRED });

  it('lists the promoted items and names the relaxed constraint', () => {
    const brief = buildWidenBrief(buildScopeGateDecision({ findings, choice: 'widen-relax' }));
    expect(brief).to.contain('WIDENED this ticket');
    expect(brief).to.contain('1. Add opv0 to the birth entry');
    expect(brief).to.contain('RELAXED these constraints FOR THIS PASS ONLY');
    expect(brief).to.contain(M4_CONSTRAINT_1);
    expect(brief).to.contain('NOT DONE (constraint N)');
  });

  it('says plainly that nothing was relaxed on a plain widen', () => {
    const brief = buildWidenBrief(buildScopeGateDecision({ findings, choice: 'widen' }));
    expect(brief).to.contain('NO constraint was relaxed');
    expect(brief).to.not.contain('RELAXED these constraints');
  });
});

describe('scope-gate (HC5) — stampHumanDecision', () => {
  const ledger = [
    rec({ text: 'Add opv0 to the birth entry of totalVaccinesDueByAge so newborns are scored correctly.' }),
    rec({ text: 'Consider extracting a helper.', severity: 'advisory' }),
    rec({
      text: 'Key the measles entries in totalVaccinesDueByAge off months (9/18), not weeks.',
      disposition: 'applied',
      deferralReason: undefined,
      evidence: 'regenerated tasks.js',
    }),
  ];
  const decisionFor = (choice: ScopeGateDecision['choice'], promoted: string[] = []): ScopeGateDecision => ({
    choice,
    promoted,
    relaxedConstraints: [],
    conflicts: [],
    tier2Unattributed: false,
    timestamp: '2026-08-06T00:00:00.000Z',
  });

  it('appends the accepted note to open blocking entries without losing the machine reason', () => {
    const stamped = stampHumanDecision(ledger, decisionFor('accept'));
    expect(stamped[0].deferralReason)
      .to.equal(`score above the refinement threshold; recorded only — ${HC5_ACCEPTED_NOTE}`);
  });

  it('leaves advisory and applied entries untouched', () => {
    const stamped = stampHumanDecision(ledger, decisionFor('accept'));
    expect(stamped[1]).to.deep.equal(ledger[1]);
    expect(stamped[2]).to.deep.equal(ledger[2]);
  });

  it('is a no-op for abandon and for no decision at all', () => {
    expect(stampHumanDecision(ledger, decisionFor('abandon'))).to.deep.equal(ledger);
    expect(stampHumanDecision(ledger, undefined)).to.deep.equal(ledger);
  });

  it('on widen, stamps only entries matching a promoted text (similarText)', () => {
    const stamped = stampHumanDecision(ledger, decisionFor('widen', [
      'Add opv0 to the birth entry of totalVaccinesDueByAge so newborns are scored correctly.',
    ]));
    expect(stamped[0].deferralReason).to.contain(HC5_PROMOTED_NOTE);
    expect(stamped[1]).to.deep.equal(ledger[1]);
  });

  it('on widen, does NOT stamp an open blocking entry that was not promoted', () => {
    const stamped = stampHumanDecision(ledger, decisionFor('widen', ['Something else entirely.']));
    expect(stamped[0]).to.deep.equal(ledger[0]);
  });

  it('uses the note alone when no machine reason was recorded', () => {
    const bare = [rec({ text: 'Fix the thing.', deferralReason: undefined })];
    expect(stampHumanDecision(bare, decisionFor('accept'))[0].deferralReason)
      .to.equal(HC5_ACCEPTED_NOTE);
  });

  it('returns a copy, never the same array instance', () => {
    expect(stampHumanDecision(ledger, decisionFor('abandon'))).to.not.equal(ledger);
  });
});

describe('scope-gate (HC5) — the panel and the abandon banner', () => {
  it('shows why it opened, each deferral with its reason, the conflicts and the scope limit', () => {
    const panel = renderScopeGatePanel(assessScope({
      ticket: ticketWith([M4_CONSTRAINT_1, M4_CONSTRAINT_2]),
      ledger: M4_DEFERRED,
      qa: qaWith(tier2({ baseline: { ran: true, passed: false, failing: 1 } })),
    }));
    expect(panel).to.contain('HUMAN VALIDATION CHECKPOINT #5');
    expect(panel).to.contain('Why this gate opened: 3 correctness recommendation(s) recorded and NOT applied');
    expect(panel).to.contain('why deferred: score above the refinement threshold');
    expect(panel).to.contain('⚠ CONFLICTS WITH CONSTRAINT 1 (protected-symbol): countTotalVaccinesByAge');
    expect(panel).to.contain('THE TICKET DECLARES A LIMITED SCOPE');
    expect(panel).to.contain('All 3 item(s) above widen it');
    // Attribution, never a raw count.
    expect(panel).to.contain('TIER-2 FAILURES (attributed against the pre-fix baseline)');
    expect(panel).to.contain('2 NEW failure(s) introduced by this change');
  });

  it('omits the tier-2 and scope-limit blocks when they have nothing to say', () => {
    const panel = renderScopeGatePanel(assessScope({ ticket: ticketWith([]), ledger: M4_DEFERRED }));
    expect(panel).to.not.contain('TIER-2 FAILURES');
    expect(panel).to.not.contain('LIMITED SCOPE');
    expect(panel).to.contain('DEFERRED ITEMS');
  });

  it('renders machine evidence FIRST when supplied, and omits the block when not', () => {
    const findings = assessScope({ ticket: ticketWith([]), ledger: M4_DEFERRED });
    const withEvidence = renderScopeGatePanel(findings, [
      'XLSForm apply VERIFIED: the corrected bind asserted',
      'QA red→green on the LIVE instance',
    ]);
    expect(withEvidence).to.contain('MACHINE EVIDENCE');
    expect(withEvidence).to.contain('✓ XLSForm apply VERIFIED');
    expect(withEvidence).to.contain('✓ QA red→green on the LIVE instance');
    // Evidence renders before the deferred items so it frames them.
    expect(withEvidence.indexOf('MACHINE EVIDENCE')).to.be.lessThan(withEvidence.indexOf('DEFERRED ITEMS'));

    const without = renderScopeGatePanel(findings);
    expect(without).to.not.contain('MACHINE EVIDENCE');
    expect(without).to.not.contain('✓ ');
    const empty = renderScopeGatePanel(findings, []);
    expect(empty).to.not.contain('MACHINE EVIDENCE');
  });

  it('stamps items deferred by the PRE-VERDICT blanket reasons, and only those', () => {
    const ledger: TriagedRecommendation[] = [
      rec({
        text: 'Actually implement the fix: edit the workbook cell',
        deferralReason: 'blocking — the deterministic XLSForm apply owns the verdict on this path',
      }),
      rec({
        text: 'A genuinely open follow-up',
        deferralReason: 'score above the refinement threshold',
      }),
    ];
    const panel = renderScopeGatePanel(assessScope({ ticket: ticketWith([]), ledger }));
    expect(panel).to.contain('written by the PRE-VERDICT reviewer');
    // Exactly one stamped item — the blanket-reason one.
    expect(panel.match(/PRE-VERDICT reviewer/g)).to.have.property('length', 1);
  });

  it('the abandon banner names the files HC2 already wrote and the exact revert command', () => {
    const banner = renderScopeAbandonBanner(['tasks.js', 'contact-summary.templated.js'], '/workspace/conf');
    expect(banner).to.contain('ABANDONED AT HC5 — no PR bundle written');
    expect(banner).to.contain('  - tasks.js');
    expect(banner).to.contain('cd /workspace/conf && git checkout -- tasks.js contact-summary.templated.js');
  });

  it('omits the revert command when there is no config root or nothing was written', () => {
    expect(renderScopeAbandonBanner(['tasks.js'])).to.not.contain('git checkout --');
    expect(renderScopeAbandonBanner([], '/workspace/conf')).to.not.contain('git checkout --');
  });
});
