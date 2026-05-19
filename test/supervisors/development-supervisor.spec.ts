import { expect } from 'chai';
import {
  resolveValidateImplEdge,
  ValidateImplEdgeState,
} from '../../src/supervisors/development-supervisor';

describe('resolveValidateImplEdge (R17.4)', () => {
  const baseState: ValidateImplEdgeState = {
    validationResult: { overallScore: 90 },
    iterationCount: 0,
    codeGeneration: { crossFileIssues: [] },
  };

  it('returns __end__ when execute-no-op is present, even with iterations available', () => {
    const state: ValidateImplEdgeState = {
      ...baseState,
      validationResult: { overallScore: 30 }, // would normally trigger a loop
      iterationCount: 0,
      codeGeneration: {
        crossFileIssues: [
          { issueType: 'execute-no-op' },
          { issueType: 'plan-adherence-missing' }, // co-occurs naturally
        ],
      },
    };
    expect(resolveValidateImplEdge(state)).to.equal('__end__');
  });

  it('loops back to generateCode when score is below threshold and no execute-no-op', () => {
    const state: ValidateImplEdgeState = {
      ...baseState,
      validationResult: { overallScore: 50 },
      iterationCount: 0,
      codeGeneration: { crossFileIssues: [] },
    };
    expect(resolveValidateImplEdge(state)).to.equal('generateCode');
  });

  it('loops back to generateCode when other cross-file issues are present (e.g., compile-error)', () => {
    const state: ValidateImplEdgeState = {
      ...baseState,
      validationResult: { overallScore: 95 },
      iterationCount: 0,
      codeGeneration: {
        crossFileIssues: [{ issueType: 'compile-error' }],
      },
    };
    expect(resolveValidateImplEdge(state)).to.equal('generateCode');
  });

  it('returns __end__ on a clean high-score run with no issues', () => {
    expect(resolveValidateImplEdge(baseState)).to.equal('__end__');
  });

  it('returns __end__ when below threshold but iterations exhausted', () => {
    const state: ValidateImplEdgeState = {
      ...baseState,
      validationResult: { overallScore: 50 },
      iterationCount: 3, // MAX_ITERATIONS
      codeGeneration: { crossFileIssues: [] },
    };
    expect(resolveValidateImplEdge(state)).to.equal('__end__');
  });
});
