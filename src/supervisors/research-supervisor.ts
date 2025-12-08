/**
 * Research Supervisor
 *
 * Orchestrates the research phase:
 * 1. Documentation Search Agent - searches CHT docs via Kapa.AI
 * 2. Context Analysis Agent - analyzes past implementations
 * 3. Generates orchestration plan for development phase
 */

import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import {
  IssueTemplate,
  ResearchState,
  ResearchFindings,
  ContextAnalysisResult,
  OrchestrationPlan,
} from '../types';
import { DocumentationSearchAgent } from '../agents/documentation-search-agent';
import { ContextAnalysisAgent } from '../agents/context-analysis-agent';

// Define the state annotation for type safety
const ResearchStateAnnotation = Annotation.Root({
  messages: Annotation<ResearchState['messages']>({
    reducer: (_current, update) => [..._current, ...update],
    default: () => [],
  }),
  issue: Annotation<IssueTemplate | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  researchFindings: Annotation<ResearchFindings | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  contextAnalysis: Annotation<ContextAnalysisResult | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  orchestrationPlan: Annotation<OrchestrationPlan | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  currentPhase: Annotation<ResearchState['currentPhase']>({
    reducer: (_current, update) => update,
    default: () => 'init' as const,
  }),
  errors: Annotation<string[]>({
    reducer: (_current, update) => [..._current, ...update],
    default: () => [],
  }),
});

export class ResearchSupervisor {
  private graph: ReturnType<typeof this.buildGraph>;
  private docSearchAgent: DocumentationSearchAgent;
  private contextAgent: ContextAnalysisAgent;
  private plannerModel: ChatAnthropic;

  constructor(options: { modelName?: string; useMockMCP?: boolean } = {}) {
    this.docSearchAgent = new DocumentationSearchAgent({
      modelName: options.modelName,
      useMockMCP: options.useMockMCP,
    });

    this.contextAgent = new ContextAnalysisAgent({
      modelName: options.modelName,
    });

    this.plannerModel = new ChatAnthropic({
      modelName: options.modelName || 'claude-sonnet-4-20250514',
      temperature: 0.3,
    });

    this.graph = this.buildGraph();
  }

  /**
   * Build the LangGraph workflow
   */
  private buildGraph() {
    const workflow = new StateGraph(ResearchStateAnnotation)
      // Define nodes
      .addNode('documentationSearch', this.documentationSearchNode.bind(this))
      .addNode('analyzeContext', this.contextAnalysisNode.bind(this))
      .addNode('generatePlan', this.generatePlanNode.bind(this))

      // Define edges
      .addEdge(START, 'documentationSearch')
      .addEdge('documentationSearch', 'analyzeContext')
      .addEdge('analyzeContext', 'generatePlan')
      .addEdge('generatePlan', END);

    return workflow.compile();
  }

  /**
   * Node: Documentation Search
   */
  private async documentationSearchNode(state: typeof ResearchStateAnnotation.State) {
    console.log('\n=== DOCUMENTATION SEARCH NODE ===');

    if (!state.issue) {
      return {
        errors: ['No issue provided for documentation search'],
        currentPhase: 'init' as const,
      };
    }

    try {
      const findings = await this.docSearchAgent.search(state.issue);

      return {
        researchFindings: findings,
        currentPhase: 'context-analysis' as const,
        messages: [
          {
            role: 'assistant' as const,
            content: `Documentation search completed. Found ${findings.documentationReferences.length} references.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        errors: [`Documentation search failed: ${errorMessage}`],
        currentPhase: 'doc-search' as const,
      };
    }
  }

  /**
   * Node: Context Analysis
   */
  private async contextAnalysisNode(state: typeof ResearchStateAnnotation.State) {
    console.log('\n=== CONTEXT ANALYSIS NODE ===');

    if (!state.issue) {
      return {
        errors: ['No issue provided for context analysis'],
        currentPhase: 'context-analysis' as const,
      };
    }

    try {
      const analysis = await this.contextAgent.analyze(state.issue);

      return {
        contextAnalysis: analysis,
        currentPhase: 'plan-generation' as const,
        messages: [
          {
            role: 'assistant' as const,
            content: `Context analysis completed. Found ${analysis.similarContexts.length} similar issues.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        errors: [`Context analysis failed: ${errorMessage}`],
        currentPhase: 'context-analysis' as const,
      };
    }
  }

  /**
   * Node: Generate Orchestration Plan
   */
  private async generatePlanNode(state: typeof ResearchStateAnnotation.State) {
    console.log('\n=== GENERATE PLAN NODE ===');

    if (!state.issue || !state.researchFindings || !state.contextAnalysis) {
      return {
        errors: ['Missing required data for plan generation'],
        currentPhase: 'plan-generation' as const,
      };
    }

    try {
      const plan = await this.generateOrchestrationPlan(
        state.issue,
        state.researchFindings,
        state.contextAnalysis
      );

      return {
        orchestrationPlan: plan,
        currentPhase: 'complete' as const,
        messages: [
          {
            role: 'assistant' as const,
            content: 'Orchestration plan generated successfully.',
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        errors: [`Plan generation failed: ${errorMessage}`],
        currentPhase: 'plan-generation' as const,
      };
    }
  }

  /**
   * Generate orchestration plan using Claude
   */
  private async generateOrchestrationPlan(
    issue: IssueTemplate,
    findings: ResearchFindings,
    analysis: ContextAnalysisResult
  ): Promise<OrchestrationPlan> {
    console.log('[Research Supervisor] Generating orchestration plan...');

    const prompt = this.buildPlanPrompt(issue, findings, analysis);

    const response = await this.plannerModel.invoke(prompt);
    const content = response.content.toString();

    // Parse the response into structured plan
    const plan = this.parsePlanResponse(content, issue, findings, analysis);

    console.log('[Research Supervisor] Plan generated successfully');
    return plan;
  }

  /**
   * Build prompt for plan generation
   */
  private buildPlanPrompt(
    issue: IssueTemplate,
    findings: ResearchFindings,
    analysis: ContextAnalysisResult
  ): string {
    const { issue: issueDetails } = issue;

    return `You are a CHT development orchestration planner. Based on the research findings and context analysis, create a detailed implementation plan.

## Issue Details
**Title**: ${issueDetails.title}
**Type**: ${issueDetails.type}
**Priority**: ${issueDetails.priority}
**Domain**: ${issueDetails.technical_context.domain}
**Description**: ${issueDetails.description}

**Requirements**:
${issueDetails.requirements.map((req, i) => `${i + 1}. ${req}`).join('\n')}

**Acceptance Criteria**:
${issueDetails.acceptance_criteria.map((criteria, i) => `${i + 1}. ${criteria}`).join('\n')}

## Research Findings
**Documentation References**: ${findings.documentationReferences.length} found
${findings.documentationReferences.map((ref) => `- ${ref.title}: ${ref.url}`).join('\n')}

**Suggested Approaches**:
${findings.suggestedApproaches.map((approach, i) => `${i + 1}. ${approach}`).join('\n')}

**Confidence**: ${(findings.confidence * 100).toFixed(0)}%

## Context Analysis
**Similar Past Issues**: ${analysis.similarContexts.length}
**Reusable Patterns**: ${analysis.reusablePatterns.length}
**Historical Success Rate**: ${(analysis.historicalSuccessRate * 100).toFixed(0)}%

**Recommendations**:
${analysis.recommendations.map((rec, i) => `${i + 1}. ${rec}`).join('\n')}

## Your Task
Create a detailed orchestration plan with:
1. Summary of the approach
2. Key findings from research and context
3. Proposed implementation approach
4. Estimated complexity (low/medium/high)
5. Implementation phases with components and dependencies
6. Risk factors to consider
7. Estimated effort

Format your response as a structured plan that will guide the development team.`;
  }

  /**
   * Parse Claude's response into structured plan
   */
  private parsePlanResponse(
    content: string,
    issue: IssueTemplate,
    findings: ResearchFindings,
    analysis: ContextAnalysisResult
  ): OrchestrationPlan {
    // Extract key information from the response
    // Lines will be used for more detailed parsing in future iterations

    // Build key findings
    const keyFindings = [
      `${findings.documentationReferences.length} documentation references found`,
      `${analysis.similarContexts.length} similar past implementations identified`,
      `Historical success rate: ${(analysis.historicalSuccessRate * 100).toFixed(0)}%`,
      ...analysis.recommendations.slice(0, 2),
    ];

    // Estimate complexity based on requirements and constraints
    const complexity = this.estimateComplexity(issue, analysis);

    // Build phases
    const phases = this.buildPhases(issue, findings, analysis);

    // Extract risk factors
    const riskFactors = this.identifyRiskFactors(issue, findings, analysis);

    return {
      summary: content.substring(0, 300) + '...', // First 300 chars as summary
      keyFindings,
      proposedApproach: findings.suggestedApproaches[0] || 'Follow CHT best practices',
      estimatedComplexity: complexity,
      phases,
      riskFactors,
      estimatedEffort: this.estimateEffort(complexity, phases.length),
    };
  }

  /**
   * Estimate complexity based on issue details
   */
  private estimateComplexity(
    issue: IssueTemplate,
    analysis: ContextAnalysisResult
  ): 'low' | 'medium' | 'high' {
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
  }

  /**
   * Build implementation phases
   */
  private buildPhases(
    issue: IssueTemplate,
    _findings: ResearchFindings,
    analysis: ContextAnalysisResult
  ) {
    const phases = [
      {
        name: 'Setup and Configuration',
        description: 'Set up development environment and review documentation',
        estimatedComplexity: 'low' as const,
        suggestedComponents: ['development environment', 'documentation'],
        dependencies: [],
      },
      {
        name: 'Core Implementation',
        description: `Implement ${issue.issue.title}`,
        estimatedComplexity: this.estimateComplexity(issue, analysis),
        suggestedComponents: issue.issue.technical_context.components,
        dependencies: ['Setup and Configuration'],
      },
      {
        name: 'Testing',
        description: 'Write and run unit, integration, and e2e tests',
        estimatedComplexity: 'medium' as const,
        suggestedComponents: ['test suite', 'test data'],
        dependencies: ['Core Implementation'],
      },
      {
        name: 'Documentation',
        description: 'Update documentation and configuration examples',
        estimatedComplexity: 'low' as const,
        suggestedComponents: ['docs', 'examples'],
        dependencies: ['Testing'],
      },
    ];

    return phases;
  }

  /**
   * Identify risk factors
   */
  private identifyRiskFactors(
    issue: IssueTemplate,
    findings: ResearchFindings,
    analysis: ContextAnalysisResult
  ): string[] {
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
  }

  /**
   * Estimate effort based on complexity and phases
   */
  private estimateEffort(complexity: 'low' | 'medium' | 'high', phaseCount: number): string {
    const baseHours = {
      low: 4,
      medium: 16,
      high: 40,
    };

    const hours = baseHours[complexity] * (phaseCount / 4);

    if (hours < 8) return `${hours} hour${hours === 1 ? '' : 's'}`;
    if (hours < 40) {
      const days = Math.round(hours / 8);
      return `${days} day${days === 1 ? '' : 's'}`;
    }
    const weeks = Math.round(hours / 40);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }

  /**
   * Main entry point to run the research workflow
   * @param issue - The issue template to research
   * @param additionalContext - Optional feedback from human validation to refine research
   */
  async research(
    issue: IssueTemplate,
    additionalContext?: string
  ): Promise<ResearchState> {
    console.log('\n========================================');
    console.log('RESEARCH SUPERVISOR - Starting Research Phase');
    console.log('========================================');
    console.log(`Issue: ${issue.issue.title}`);

    if (additionalContext) {
      console.log('\n📝 Additional Context from Human Feedback:');
      console.log(`   ${additionalContext}`);
    }

    console.log(`Domain: ${issue.issue.technical_context.domain}`);
    console.log(`Components: ${issue.issue.technical_context.components.join(', ') || 'None specified'}`);
    console.log('========================================\n');

    // Build initial message, incorporating additional context if provided
    const initialMessage = additionalContext
      ? `Research issue: ${issue.issue.title}\n\nAdditional context from human feedback:\n${additionalContext}`
      : `Research issue: ${issue.issue.title}`;

    const initialState: typeof ResearchStateAnnotation.State = {
      messages: [
        {
          role: 'user',
          content: initialMessage,
          timestamp: new Date().toISOString(),
        },
      ],
      issue: issue,
      researchFindings: undefined,
      contextAnalysis: undefined,
      orchestrationPlan: undefined,
      currentPhase: 'init',
      errors: [],
    };

    let result: typeof ResearchStateAnnotation.State;
    try {
      result = await this.graph.invoke(initialState);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during graph execution';
      console.error('\n========================================');
      console.error('RESEARCH SUPERVISOR - Error during execution');
      console.error('========================================');
      console.error(`Error: ${errorMessage}`);
      console.error('========================================\n');

      // Return state with error recorded
      return {
        ...initialState,
        currentPhase: 'error',
        errors: [errorMessage],
      };
    }

    console.log('\n========================================');
    console.log('RESEARCH SUPERVISOR - Research Phase Complete');
    console.log('========================================');
    console.log(`Final Phase: ${result.currentPhase}`);
    console.log(`Errors: ${result.errors.length}`);
    console.log('========================================\n');

    return result;
  }
}
