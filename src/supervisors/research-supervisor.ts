/**
 * Research Supervisor
 *
 * Orchestrates the research phase:
 * 1. Documentation Search Agent - searches CHT docs via Kapa.AI
 * 2. Context Analysis Agent - analyzes past implementations
 * 3. Generates orchestration plan for development phase
 */

import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import {
  IssueTemplate,
  ResearchState,
  ResearchFindings,
  ContextAnalysisResult,
  OrchestrationPlan,
  CodeContext,
} from '../types';
import { DocumentationSearchAgent } from '../agents/documentation-search-agent';
import { ContextAnalysisAgent } from '../agents/context-analysis-agent';
import { LLMProvider, createLLMProviderFromEnv } from '../llm';
import { TodoTracker, createSupervisorTodoTracker } from '../utils/todo-tracker';

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
  private llm: LLMProvider;
  private todos: TodoTracker;

  constructor(options: { modelName?: string; useMockMCP?: boolean; llmProvider?: LLMProvider } = {}) {
    this.docSearchAgent = new DocumentationSearchAgent({
      useMockMCP: options.useMockMCP,
    });

    this.contextAgent = new ContextAnalysisAgent({
      modelName: options.modelName,
    });

    // Use provided LLM provider or create from environment
    // Supports both API mode (ANTHROPIC_API_KEY) and CLI mode (LLM_PROVIDER=claude-cli)
    this.llm = options.llmProvider || createLLMProviderFromEnv();

    this.todos = createSupervisorTodoTracker('Research');

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

    const todoId = 'research-1'; // First todo
    this.todos.start(todoId);

    if (!state.issue) {
      this.todos.fail(todoId, 'No issue provided');
      return {
        errors: ['No issue provided for documentation search'],
        currentPhase: 'init' as const,
      };
    }

    try {
      const findings = await this.docSearchAgent.search(state.issue);
      this.todos.complete(todoId);

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
      this.todos.fail(todoId, errorMessage);
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

    const todoId = 'research-2'; // Second todo
    this.todos.start(todoId);

    if (!state.issue) {
      this.todos.fail(todoId, 'No issue provided');
      return {
        errors: ['No issue provided for context analysis'],
        currentPhase: 'context-analysis' as const,
      };
    }

    try {
      const analysis = await this.contextAgent.analyze(state.issue);
      this.todos.complete(todoId);

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
      this.todos.fail(todoId, errorMessage);
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

    const todoId = 'research-3'; // Third todo
    this.todos.start(todoId);

    if (!state.issue || !state.researchFindings || !state.contextAnalysis) {
      this.todos.fail(todoId, 'Missing required data');
      console.error('[Generate Plan Node] ERROR: Missing required state for plan generation');
      return {
        errors: ['Missing required data for plan generation'],
        currentPhase: 'plan-generation' as const,
      };
    }

    try {
      // Use code context from Context Analysis Agent (already gathered)
      const codeContext = state.contextAnalysis.codeContext;
      if (codeContext) {
        console.log(
          `[Research Supervisor] Using ${codeContext.codeSnippets.length} code snippets from context analysis`
        );
      } else {
        console.log('[Research Supervisor] No code context available from context analysis');
      }

      const plan = await this.generateOrchestrationPlan(
        state.issue,
        state.researchFindings,
        state.contextAnalysis,
        codeContext
      );

      this.todos.complete(todoId);
      this.todos.printSummary();

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
      this.todos.fail(todoId, errorMessage);
      this.todos.printSummary();
      console.error(`[Research Supervisor] Plan generation failed: ${errorMessage}`);
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
    analysis: ContextAnalysisResult,
    codeContext?: CodeContext | null
  ): Promise<OrchestrationPlan> {
    console.log('[Research Supervisor] Generating orchestration plan...');

    const prompt = this.buildPlanPrompt(issue, findings, analysis, codeContext);

    const response = await this.llm.invoke(prompt, { temperature: 0.3 });
    const content = response.content;

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
    analysis: ContextAnalysisResult,
    codeContext?: CodeContext | null
  ): string {
    const { issue: issueDetails } = issue;

    // Build code context section if available
    let codeContextSection = '';
    if (codeContext && codeContext.codeSnippets.length > 0) {
      codeContextSection = `
## CHT Core Code Context
The following code snippets are from the actual cht-core codebase for the "${codeContext.domain}" domain.
Use these to understand the existing patterns and where to make changes.

${codeContext.codeSnippets
  .map(
    (snippet) => `### ${snippet.filePath}
\`\`\`${snippet.language}
${snippet.content}
\`\`\``
  )
  .join('\n\n')}
`;
    }

    return `You are a CHT (Community Health Toolkit) development architect. Based on the research findings and actual codebase context, synthesize a concrete implementation plan with ACTIONABLE steps.

## Issue Details
**Title**: ${issueDetails.title}
**Type**: ${issueDetails.type}
**Priority**: ${issueDetails.priority}
**Domain**: ${issueDetails.technical_context.domain}
**Components**: ${issueDetails.technical_context.components.join(', ') || 'Not specified'}

**Description**:
${issueDetails.description}

**Requirements**:
${issueDetails.requirements.map((req, i) => `${i + 1}. ${req}`).join('\n')}

**Acceptance Criteria**:
${issueDetails.acceptance_criteria.map((criteria, i) => `${i + 1}. ${criteria}`).join('\n')}

**Constraints**:
${issueDetails.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n') || 'None specified'}

## Documentation Research (from CHT docs)
${findings.suggestedApproaches.map((approach, i) => `${i + 1}. ${approach}`).join('\n')}

**Relevant Documentation**:
${findings.documentationReferences.slice(0, 10).map((ref) => `- ${ref.title}: ${ref.url}`).join('\n')}
${codeContextSection}
## Context Analysis
**Similar Past Issues**: ${analysis.similarContexts.length}
**Reusable Patterns**: ${analysis.reusablePatterns.length}
**Historical Success Rate**: ${analysis.historicalSuccessRate !== null ? `${(analysis.historicalSuccessRate * 100).toFixed(0)}%` : 'N/A (no historical data)'}

## YOUR TASK

Based on the above research and CODE CONTEXT, provide:

### 1. IMPLEMENTATION APPROACH (3-5 bullet points)
Provide SPECIFIC, ACTIONABLE implementation steps based on the actual code you see above.
- Reference specific functions, classes, or patterns from the code context
- Each step should describe WHAT to do and WHERE in the codebase
- Example good approach: "Add a check for contact.muted in the canDisplay() method of contacts-content.component.ts"
- Example bad approach: "Muting is configured via app_settings.json" (this is a fact, not an action)

### 2. KEY FILES TO MODIFY
List the specific files from the code context that need changes.

### 3. IMPLEMENTATION PHASES
Break down into phases: Setup, Core Implementation, Testing, Documentation.

### 4. RISK FACTORS
What could go wrong or needs special attention?

Format your response with clear section headers (### IMPLEMENTATION APPROACH, ### KEY FILES, etc.) so it can be parsed.`;
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
    // Extract implementation approach from Claude's response
    const recommendedApproach = this.extractImplementationApproach(content);

    // Extract key files from Claude's response
    const keyFiles = this.extractKeyFiles(content);

    // Build key findings - combine research stats with LLM-extracted files
    const keyFindings = [
      `${findings.documentationReferences.length} documentation references found`,
      `${analysis.similarContexts.length} similar past implementations identified`,
      analysis.historicalSuccessRate !== null
        ? `Historical success rate: ${(analysis.historicalSuccessRate * 100).toFixed(0)}%`
        : 'No historical data available',
      ...analysis.recommendations.slice(0, 2),
    ];

    // Add key files to findings if extracted
    if (keyFiles.length > 0) {
      keyFindings.push(`Key files to modify: ${keyFiles.slice(0, 3).join(', ')}`);
    }

    // Estimate complexity based on requirements and constraints
    const complexity = this.estimateComplexity(issue, analysis);

    // Build phases
    const phases = this.buildPhases(issue, findings, analysis);

    // Extract risk factors - combine heuristic with LLM-extracted
    const heuristicRisks = this.identifyRiskFactors(issue, findings, analysis);
    const llmRisks = this.extractRiskFactors(content);
    const riskFactors = [...new Set([...heuristicRisks, ...llmRisks])].slice(0, 5);

    return {
      summary: content.substring(0, 300) + '...', // First 300 chars as summary
      keyFindings,
      recommendedApproach,
      estimatedComplexity: complexity,
      phases,
      riskFactors,
      estimatedEffort: this.estimateEffort(complexity, phases.length),
    };
  }

  /**
   * Extract implementation approach from Claude's response
   * Looks for the "### IMPLEMENTATION APPROACH" section and extracts bullet points
   */
  private extractImplementationApproach(content: string): string {
    // Try to find the IMPLEMENTATION APPROACH section
    const approachMatch = content.match(
      /###\s*(?:1\.\s*)?IMPLEMENTATION APPROACH[^\n]*\n([\s\S]*?)(?=###|$)/i
    );

    if (approachMatch) {
      const section = approachMatch[1].trim();
      // Extract bullet points
      const bullets = section
        .split('\n')
        .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map((line) => line.replace(/^[\s\-\*]+/, '').trim())
        .filter((line) => line.length > 0);

      if (bullets.length > 0) {
        // Return the first few bullets as the recommended approach
        return bullets.slice(0, 3).join('; ');
      }

      // If no bullets, return the first meaningful line
      const firstLine = section.split('\n').find((line) => line.trim().length > 20);
      if (firstLine) {
        return firstLine.trim();
      }
    }

    // Fallback: look for any numbered list or bullet points in the response
    const bulletMatch = content.match(/(?:^|\n)[\s]*[-*]\s+(.+?)(?=\n|$)/gm);
    if (bulletMatch && bulletMatch.length > 0) {
      return bulletMatch
        .slice(0, 3)
        .map((b) => b.replace(/^[\s\-\*]+/, '').trim())
        .join('; ');
    }

    return 'Follow CHT best practices and patterns from documentation';
  }

  /**
   * Extract key files to modify from Claude's response
   */
  private extractKeyFiles(content: string): string[] {
    const files: string[] = [];

    // Try to find the KEY FILES section
    const filesMatch = content.match(/###\s*(?:2\.\s*)?KEY FILES[^\n]*\n([\s\S]*?)(?=###|$)/i);

    if (filesMatch) {
      const section = filesMatch[1];
      // Look for file paths (containing / or ending in common extensions)
      const pathMatches = section.match(
        /[\w\-./]+(?:\.ts|\.js|\.html|\.json|\.service\.ts|\.component\.ts)/g
      );
      if (pathMatches) {
        files.push(...pathMatches);
      }
    }

    // Also look for backtick-wrapped file references throughout the content
    const backtickMatches = content.match(/`([^`]*(?:\.ts|\.js|\.html|\.json)[^`]*)`/g);
    if (backtickMatches) {
      backtickMatches.forEach((match) => {
        const file = match.replace(/`/g, '').trim();
        if (file.includes('/') || file.includes('.')) {
          files.push(file);
        }
      });
    }

    // Deduplicate and return
    return [...new Set(files)].slice(0, 10);
  }

  /**
   * Extract risk factors from Claude's response
   */
  private extractRiskFactors(content: string): string[] {
    const risks: string[] = [];

    // Try to find the RISK FACTORS section
    const riskMatch = content.match(/###\s*(?:4\.\s*)?RISK FACTORS[^\n]*\n([\s\S]*?)(?=###|$)/i);

    if (riskMatch) {
      const section = riskMatch[1];
      // Extract bullet points
      const bullets = section
        .split('\n')
        .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map((line) => line.replace(/^[\s\-\*]+/, '').trim())
        .filter((line) => line.length > 0);

      risks.push(...bullets);
    }

    return risks.slice(0, 5);
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
   * @param issue The issue template to research
   * @param additionalContext Optional additional context (e.g., human feedback from previous iteration)
   */
  async research(issue: IssueTemplate, additionalContext?: string): Promise<ResearchState> {
    console.log('\n========================================');
    console.log('RESEARCH SUPERVISOR - Starting Research Phase');
    console.log('========================================');
    console.log(`Issue: ${issue.issue.title}`);
    console.log(`Domain: ${issue.issue.technical_context.domain}`);
    console.log(`Components: ${issue.issue.technical_context.components.join(', ') || 'None specified'}`);
    if (additionalContext) {
      console.log(`Additional Context: ${additionalContext}`);
    }
    console.log('========================================\n');

    // Initialize todos for the research workflow
    this.todos.clear();
    this.todos.addMany([
      { content: 'Search documentation', activeForm: 'Searching documentation' },
      { content: 'Analyze context', activeForm: 'Analyzing context' },
      { content: 'Generate orchestration plan', activeForm: 'Generating orchestration plan' },
    ]);

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: string }> = [
      {
        role: 'user',
        content: `Research issue: ${issue.issue.title}`,
        timestamp: new Date().toISOString(),
      },
    ];

    // Add additional context as a system message if provided
    if (additionalContext) {
      messages.push({
        role: 'system',
        content: `Additional context from human feedback: ${additionalContext}`,
        timestamp: new Date().toISOString(),
      });
    }

    const initialState: typeof ResearchStateAnnotation.State = {
      messages,
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
    if (result.errors.length > 0) {
      console.log(`Error details: ${result.errors.join(', ')}`);
    }
    console.log('========================================\n');

    return result;
  }
}
