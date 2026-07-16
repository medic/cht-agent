/**
 * Validation-score display honesty (mission 05, F9).
 *
 * The dev phase's LLM validator scores the generated artifact 0–100 and the
 * refinement loop trips below `REFINEMENT_THRESHOLD`. But for a cht-conf form
 * fix (F8 iteration economics), a DETERMINISTIC `applyXlsformFix` verdict
 * outranks the LLM score: a passing apply proceeds even when the LLM score is
 * below threshold (the validator does not understand the descriptor contract, so
 * a low number there is not a failed run). When that override happened, a bare
 * "15%" reads as a failure; this module annotates the displayed score so it
 * reads honestly.
 *
 * The signal is derived from existing state, not new bookkeeping: a verified
 * apply is present (`xlsformApply`) AND the LLM score is below threshold.
 */

/**
 * The refinement-loop threshold. Single source of truth — the supervisor imports
 * it so the edge resolver and every display site agree on the same number.
 */
export const REFINEMENT_THRESHOLD = 75;

/** Just enough of the two channels to decide + render the annotation. */
export interface ScoreDisplayInputs {
  /** The LLM validator's overall score (0–100), if a validation ran. */
  overallScore?: number;
  /**
   * True when a verified deterministic XLSForm apply is present — i.e. the F8
   * economics path let the run proceed on the apply verdict, not the LLM score.
   */
  hasVerifiedApply: boolean;
}

/**
 * True when the deterministic apply verdict overrode a below-threshold LLM
 * score (the F8 economics path). Exported so a caller can branch on it without
 * re-deriving the condition.
 */
export const scoreOverriddenByApply = ({ overallScore, hasVerifiedApply }: ScoreDisplayInputs): boolean =>
  hasVerifiedApply && overallScore !== undefined && overallScore < REFINEMENT_THRESHOLD;

/**
 * Render the score for a display line: `"15% (overridden by verified apply)"`
 * when the deterministic apply proceeded despite a below-threshold LLM score, or
 * plain `"15%"` otherwise. Returns just the value portion (no label) so each
 * call site keeps its own prefix ("Validation Score: ", "Overall Score: ", …).
 */
export const formatValidationScore = (inputs: ScoreDisplayInputs): string => {
  const value = `${inputs.overallScore ?? 0}%`;
  return scoreOverriddenByApply(inputs) ? `${value} (overridden by verified apply)` : value;
};
