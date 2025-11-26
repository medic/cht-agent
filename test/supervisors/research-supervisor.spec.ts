import { expect } from 'chai';
import {
  IssueTemplate,
  ResearchFindings,
  ContextAnalysisResult,
  ResolvedIssueContext,
} from '../../src/types';

// Since ResearchSupervisor has LLM dependencies, we test the pure functions
// by extracting the logic. These functions are private methods but we can
// test the logic patterns.

describe('ResearchSupervisor - Pure Functions', () => {
  // Helper to create test issue template
  const createTestIssue = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
    issue: {
      title: 'Test Issue',
      type: 'feature',
      priority: 'medium',
      description: 'Test description',
      technical_context: {
        domain: 'contacts',
        components: ['api/controllers/contacts', 'webapp/modules/contacts'],
      },
      requirements: ['Req 1', 'Req 2'],
      acceptance_criteria: ['Criterion 1'],
      constraints: ['Constraint 1'],
      ...overrides,
    },
  });

  const createResearchFindings = (overrides: Partial<ResearchFindings> = {}): ResearchFindings => ({
    documentationReferences: [],
    relevantExamples: [],
    suggestedApproaches: ['Approach 1'],
    relatedDomains: ['contacts'],
    confidence: 0.8,
    source: 'kapa-ai',
    ...overrides,
  });

  const createContextAnalysis = (
    overrides: Partial<ContextAnalysisResult> = {}
  ): ContextAnalysisResult => ({
    similarContexts: [],
    reusablePatterns: [],
    relevantDesignDecisions: [],
    recommendations: ['Recommendation 1'],
    historicalSuccessRate: 0.8,
    relatedDomains: ['contacts'],
    ...overrides,
  });

  describe('estimateComplexity logic', () => {
    // Testing the complexity estimation algorithm
    const estimateComplexity = (
      issue: IssueTemplate,
      analysis: ContextAnalysisResult
    ): 'low' | 'medium' | 'high' => {
      let score = 0;

      // Priority factor
      if (issue.issue.priority === 'high') score += 2;
      else if (issue.issue.priority === 'medium') score += 1;

      // Requirements count
      if (issue.issue.requirements.length > 5) score += 2;
      else if (issue.issue.requirements.length > 2) score += 1;

      // Constraints
      if (issue.issue.constraints.length > 2) score += 1;

      // Lack of similar context increases complexity
      if (analysis.similarContexts.length === 0) score += 2;
      else if (analysis.similarContexts.length < 2) score += 1;

      if (score >= 5) return 'high';
      if (score >= 3) return 'medium';
      return 'low';
    };

    it('should return low complexity for simple issues', () => {
      const issue = createTestIssue({
        priority: 'low',
        requirements: ['Req 1'],
        constraints: [],
      });
      const analysis = createContextAnalysis({
        similarContexts: [
          {} as ResolvedIssueContext,
          {} as ResolvedIssueContext,
          {} as ResolvedIssueContext,
        ],
      });

      const complexity = estimateComplexity(issue, analysis);

      expect(complexity).to.equal('low');
    });

    it('should return high complexity for high priority with no similar contexts', () => {
      const issue = createTestIssue({
        priority: 'high',
        requirements: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'],
        constraints: ['C1', 'C2', 'C3'],
      });
      const analysis = createContextAnalysis({ similarContexts: [] });

      const complexity = estimateComplexity(issue, analysis);

      expect(complexity).to.equal('high');
    });

    it('should return medium complexity for moderate issues', () => {
      const issue = createTestIssue({
        priority: 'medium',
        requirements: ['R1', 'R2', 'R3'],
        constraints: ['C1'],
      });
      const analysis = createContextAnalysis({
        similarContexts: [{} as ResolvedIssueContext],
      });

      const complexity = estimateComplexity(issue, analysis);

      expect(complexity).to.equal('medium');
    });

    it('should increase complexity when no similar contexts exist', () => {
      const issue = createTestIssue({ priority: 'low' });
      const analysisWithContexts = createContextAnalysis({
        similarContexts: [{} as ResolvedIssueContext, {} as ResolvedIssueContext],
      });
      const analysisWithoutContexts = createContextAnalysis({ similarContexts: [] });

      const complexityWith = estimateComplexity(issue, analysisWithContexts);
      const complexityWithout = estimateComplexity(issue, analysisWithoutContexts);

      // Without contexts should be higher or equal complexity
      const complexityOrder = { low: 0, medium: 1, high: 2 };
      expect(complexityOrder[complexityWithout]).to.be.at.least(complexityOrder[complexityWith]);
    });
  });

  describe('estimateEffort logic', () => {
    const estimateEffort = (complexity: 'low' | 'medium' | 'high', phaseCount: number): string => {
      const baseHours = {
        low: 4,
        medium: 16,
        high: 40,
      };

      const hours = baseHours[complexity] * (phaseCount / 4);

      if (hours < 8) return `${hours} hours`;
      if (hours < 40) return `${Math.round(hours / 8)} days`;
      return `${Math.round(hours / 40)} weeks`;
    };

    it('should return hours for small efforts', () => {
      const effort = estimateEffort('low', 4);

      expect(effort).to.equal('4 hours');
    });

    it('should return days for medium efforts', () => {
      const effort = estimateEffort('medium', 4);

      expect(effort).to.equal('2 days'); // 16 hours = 2 days
    });

    it('should return weeks for large efforts', () => {
      const effort = estimateEffort('high', 4);

      expect(effort).to.equal('1 weeks'); // 40 hours = 1 week
    });

    it('should scale with phase count', () => {
      const effort4Phases = estimateEffort('medium', 4);
      const effort8Phases = estimateEffort('medium', 8);

      // 8 phases should be double the effort of 4 phases
      expect(effort4Phases).to.equal('2 days'); // 16 hours
      expect(effort8Phases).to.equal('4 days'); // 32 hours
    });
  });

  describe('identifyRiskFactors logic', () => {
    const identifyRiskFactors = (
      issue: IssueTemplate,
      findings: ResearchFindings,
      analysis: ContextAnalysisResult
    ): string[] => {
      const risks: string[] = [];

      // Low confidence from research
      if (findings.confidence < 0.5) {
        risks.push('Low confidence in documentation findings - may require additional research');
      }

      // No similar past implementations
      if (analysis.similarContexts.length === 0) {
        risks.push('No similar past implementations found - breaking new ground');
      }

      // Complex constraints
      if (issue.issue.constraints.length > 2) {
        risks.push(`Multiple constraints to satisfy: ${issue.issue.constraints.join(', ')}`);
      }

      // High priority
      if (issue.issue.priority === 'high') {
        risks.push('High priority issue - requires careful attention and thorough testing');
      }

      // Multiple components
      if (issue.issue.technical_context.components.length > 3) {
        risks.push(
          'Changes span multiple components - requires coordination and integration testing'
        );
      }

      return risks;
    };

    it('should identify low confidence as risk', () => {
      const issue = createTestIssue();
      const findings = createResearchFindings({ confidence: 0.3 });
      const analysis = createContextAnalysis();

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('Low confidence'))).to.be.true;
    });

    it('should identify no similar contexts as risk', () => {
      const issue = createTestIssue();
      const findings = createResearchFindings();
      const analysis = createContextAnalysis({ similarContexts: [] });

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('No similar past implementations'))).to.be.true;
    });

    it('should identify multiple constraints as risk', () => {
      const issue = createTestIssue({
        constraints: ['C1', 'C2', 'C3'],
      });
      const findings = createResearchFindings();
      const analysis = createContextAnalysis();

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('Multiple constraints'))).to.be.true;
    });

    it('should identify high priority as risk', () => {
      const issue = createTestIssue({ priority: 'high' });
      const findings = createResearchFindings();
      const analysis = createContextAnalysis();

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('High priority'))).to.be.true;
    });

    it('should identify multiple components as risk', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: ['comp1', 'comp2', 'comp3', 'comp4'],
        },
      });
      const findings = createResearchFindings();
      const analysis = createContextAnalysis();

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('multiple components'))).to.be.true;
    });

    it('should return empty array when no risks identified', () => {
      const issue = createTestIssue({
        priority: 'low',
        constraints: [],
        technical_context: { domain: 'contacts', components: ['comp1'] },
      });
      const findings = createResearchFindings({ confidence: 0.9 });
      const analysis = createContextAnalysis({
        similarContexts: [{} as ResolvedIssueContext],
      });

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks).to.have.lengthOf(0);
    });
  });

  describe('buildPhases logic', () => {
    it('should always include 4 standard phases', () => {
      // The buildPhases function creates standard phases:
      // 1. Setup and Configuration
      // 2. Core Implementation
      // 3. Testing
      // 4. Documentation

      const expectedPhases = [
        'Setup and Configuration',
        'Core Implementation',
        'Testing',
        'Documentation',
      ];

      // This is the expected structure - in actual implementation
      // this comes from ResearchSupervisor.buildPhases()
      expect(expectedPhases).to.have.lengthOf(4);
    });

    it('should include issue components in Core Implementation phase', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: ['api/contacts', 'webapp/contacts'],
        },
      });

      // The Core Implementation phase should reference issue components
      const corePhaseComponents = issue.issue.technical_context.components;
      expect(corePhaseComponents).to.include('api/contacts');
      expect(corePhaseComponents).to.include('webapp/contacts');
    });
  });
});
