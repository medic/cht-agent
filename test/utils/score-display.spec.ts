import { expect } from 'chai';
import {
  REFINEMENT_THRESHOLD,
  formatValidationScore,
  scoreOverriddenByApply,
} from '../../src/utils/score-display';

describe('score-display (F9 — validation-score honesty)', () => {
  describe('scoreOverriddenByApply', () => {
    it('is true when a verified apply is present and the LLM score is below threshold', () => {
      expect(
        scoreOverriddenByApply({ overallScore: REFINEMENT_THRESHOLD - 1, hasVerifiedApply: true }),
      ).to.equal(true);
      // the live-run case: 15% with a passing deterministic apply
      expect(scoreOverriddenByApply({ overallScore: 15, hasVerifiedApply: true })).to.equal(true);
    });

    it('is false at/above threshold even with an apply (no override happened)', () => {
      expect(
        scoreOverriddenByApply({ overallScore: REFINEMENT_THRESHOLD, hasVerifiedApply: true }),
      ).to.equal(false);
      expect(scoreOverriddenByApply({ overallScore: 90, hasVerifiedApply: true })).to.equal(false);
    });

    it('is false when there is no verified apply (cht-core ticket / failed apply)', () => {
      expect(scoreOverriddenByApply({ overallScore: 15, hasVerifiedApply: false })).to.equal(false);
    });

    it('is false when there is no score', () => {
      expect(scoreOverriddenByApply({ hasVerifiedApply: true })).to.equal(false);
    });
  });

  describe('formatValidationScore', () => {
    it('annotates an apply-overridden below-threshold score', () => {
      expect(formatValidationScore({ overallScore: 15, hasVerifiedApply: true })).to.equal(
        '15% (overridden by verified apply)',
      );
    });

    it('renders a plain percentage when no override applies', () => {
      expect(formatValidationScore({ overallScore: 90, hasVerifiedApply: true })).to.equal('90%');
      expect(formatValidationScore({ overallScore: 15, hasVerifiedApply: false })).to.equal('15%');
    });

    it('treats a missing score as 0% (no annotation)', () => {
      expect(formatValidationScore({ hasVerifiedApply: true })).to.equal('0%');
    });
  });
});
