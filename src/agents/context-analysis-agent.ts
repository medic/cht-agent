/**
 * Context Analysis Agent
 *
 * Loads and analyzes relevant context:
 * 1. Historical context from agent-memory (past resolutions, patterns)
 * 2. Codebase context from cht-core (relevant source files for the domain)
 * Provides combined context insights to other agents
 */

import {
  ContextAnalysisResult,
  IssueTemplate,
  ResolvedIssueContext,
  CodePattern,
  DesignDecision,
  CHTDomain,
  DomainComponents,
  CodeContext,
} from '../types';
import {
  loadDomainOverview,
  loadDomainComponents,
  findResolvedIssuesByDomain,
  getRelatedDomains,
  ensureAgentMemoryExists,
} from '../utils/context-loader';
import { gatherDomainContext } from '../utils/cht-core-context';
import { TodoTracker, createAgentTodoTracker } from '../utils/todo-tracker';

export class ContextAnalysisAgent {
  private todos: TodoTracker;

  constructor(_options: { modelName?: string } = {}) {
    // Model will be used for advanced pattern analysis in future iterations
    // For now, we use rule-based analysis

    // Ensure agent-memory directory exists
    ensureAgentMemoryExists();

    this.todos = createAgentTodoTracker('Context Analysis');
  }

  /**
   * Main entry point for context analysis
   */
  async analyze(issue: IssueTemplate): Promise<ContextAnalysisResult> {
    console.log('\n[Context Analysis Agent] Starting context analysis...');
    console.log(`[Context Analysis Agent] Domain: ${issue.issue.technical_context.domain}`);

    // Clear any previous todos
    this.todos.clear();

    const domain = issue.issue.technical_context.domain;

    // Domain should have been inferred by now, but handle gracefully if missing
    if (!domain) {
      console.warn(
        '[Context Analysis Agent] Warning: No domain specified - returning empty analysis'
      );
      return {
        similarContexts: [],
        reusablePatterns: [],
        relevantDesignDecisions: [],
        recommendations: ['Domain not specified - unable to analyze context'],
        historicalSuccessRate: null,
        relatedDomains: [],
        codeContext: null,
      };
    }

    // Load domain context from agent-memory
    const loadContextId = this.todos.add('Load domain context', 'Loading domain context');
    this.todos.start(loadContextId);
    const domainOverview = loadDomainOverview(domain);
    const domainComponents = loadDomainComponents(domain);
    this.todos.complete(loadContextId);

    // Find similar past issues
    const similarContexts = await this.todos.run(
      'Find similar past issues',
      'Finding similar past issues',
      async () => this.findSimilarIssues(issue, domain)
    );
    console.log(`[Context Analysis Agent] Found ${similarContexts.length} similar past issues`);

    // Extract patterns from similar contexts
    const patterns = await this.todos.run(
      'Extract reusable patterns',
      'Extracting reusable patterns',
      async () => this.extractPatterns(similarContexts, domainComponents)
    );
    console.log(`[Context Analysis Agent] Extracted ${patterns.length} reusable patterns`);

    // Extract design decisions
    const designDecisions = await this.todos.run(
      'Extract design decisions',
      'Extracting design decisions',
      async () => this.extractDesignDecisions(similarContexts, domain)
    );
    console.log(
      `[Context Analysis Agent] Found ${designDecisions.length} relevant design decisions`
    );

    // Gather code context from cht-core codebase
    const codeContext = await this.todos.run(
      'Gather code context from cht-core',
      'Gathering code context from cht-core',
      async () => this.gatherCodeContext(domain)
    );

    // Generate recommendations (now including code context info)
    const recommendations = await this.todos.run(
      'Generate recommendations',
      'Generating recommendations',
      async () => this.generateRecommendations(
        issue,
        similarContexts,
        patterns,
        domainOverview?.content,
        codeContext
      )
    );
    console.log(`[Context Analysis Agent] Generated ${recommendations.length} recommendations`);

    // Calculate historical success rate (null if no data)
    const successRate = this.calculateSuccessRate(similarContexts);

    // Get related domains
    const relatedDomains = domainOverview ? getRelatedDomains(domain) : [];

    this.todos.printSummary();

    return {
      similarContexts,
      reusablePatterns: patterns,
      relevantDesignDecisions: designDecisions,
      recommendations,
      historicalSuccessRate: successRate,
      relatedDomains,
      codeContext,
    };
  }

  /**
   * Gather code context from cht-core codebase
   */
  private gatherCodeContext(domain: CHTDomain): CodeContext | null {
    console.log(`[Context Analysis Agent] Gathering code context for domain: ${domain}`);

    const context = gatherDomainContext(domain, { maxSnippets: 8 });

    if (context) {
      console.log(
        `[Context Analysis Agent] Found ${context.codeSnippets.length} code snippets from cht-core`
      );
      return {
        domain: context.domain,
        description: context.description,
        codeSnippets: context.codeSnippets,
        availableFiles: context.availableFiles,
        missingFiles: context.missingFiles,
      };
    } else {
      console.log('[Context Analysis Agent] No code context available (CHT_CORE_PATH not set?)');
      return null;
    }
  }

  /**
   * Find similar issues from knowledge base
   */
  private findSimilarIssues(issue: IssueTemplate, domain: CHTDomain): ResolvedIssueContext[] {
    // Load resolved issues for this domain
    const resolvedIssues = findResolvedIssuesByDomain(domain);

    if (resolvedIssues.length === 0) {
      console.log(`[Context Analysis Agent] No resolved issues found for domain: ${domain}`);
      return [];
    }

    // Score and rank issues by similarity
    const scoredIssues = resolvedIssues.map((resolved) => ({
      issue: resolved,
      score: this.calculateSimilarityScore(issue, resolved),
    }));

    // Sort by score and return top 5
    return scoredIssues
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .filter((item) => item.score > 0.3) // Minimum similarity threshold
      .map((item) => item.issue);
  }

  /**
   * Calculate similarity score between current issue and resolved issue
   */
  private calculateSimilarityScore(current: IssueTemplate, resolved: ResolvedIssueContext): number {
    let score = 0;

    // Category match
    if (resolved.category === current.issue.type) {
      score += 0.3;
    }

    // Domain match (already filtered, but check related domains)
    if (
      current.issue.technical_context.domain &&
      resolved.domains.includes(current.issue.technical_context.domain)
    ) {
      score += 0.4;
    }

    // Component overlap
    const currentComponents = current.issue.technical_context.components;
    const resolvedComponents = [
      ...(resolved.components.api || []),
      ...(resolved.components.webapp || []),
      ...(resolved.components.sentinel || []),
      ...(resolved.components.shared_libs || []),
    ];

    const componentOverlap = currentComponents.filter((comp) =>
      resolvedComponents.some(
        (resolvedComp) =>
          resolvedComp.toLowerCase().includes(comp.toLowerCase()) ||
          comp.toLowerCase().includes(resolvedComp.toLowerCase())
      )
    ).length;

    if (componentOverlap > 0) {
      score += 0.3 * (componentOverlap / currentComponents.length);
    }

    return Math.min(score, 1.0);
  }

  /**
   * Extract reusable patterns from similar contexts
   */
  private extractPatterns(
    contexts: ResolvedIssueContext[],
    _domainComponents: DomainComponents | null
  ): CodePattern[] {
    const patterns: CodePattern[] = [];

    // Group contexts by components
    const componentGroups = new Map<string, ResolvedIssueContext[]>();

    contexts.forEach((context) => {
      const allComponents = [
        ...(context.components.api || []),
        ...(context.components.webapp || []),
        ...(context.components.sentinel || []),
      ];

      allComponents.forEach((component) => {
        if (!componentGroups.has(component)) {
          componentGroups.set(component, []);
        }
        componentGroups.get(component)!.push(context);
      });
    });

    // Create patterns for frequently used components
    componentGroups.forEach((contexts, component) => {
      if (contexts.length >= 2) {
        patterns.push({
          pattern: `${component} implementation pattern`,
          description: `Commonly used pattern for ${component}`,
          example: `See resolved issues: ${contexts.map((c) => c.id).join(', ')}`,
          domain: contexts[0].domains[0],
          frequency: contexts.length,
        });
      }
    });

    return patterns;
  }

  /**
   * Extract design decisions from similar contexts
   */
  private extractDesignDecisions(
    contexts: ResolvedIssueContext[],
    domain: CHTDomain
  ): DesignDecision[] {
    const decisions: DesignDecision[] = [];

    // For POC, generate decisions based on context metadata
    // In production, these would be extracted from the full context files

    contexts.forEach((context) => {
      if (context.tech_stack && context.tech_stack.length > 0) {
        decisions.push({
          decision: `Use ${context.tech_stack.join(', ')} for ${context.category}`,
          rationale: `Successfully used in ${context.id}`,
          alternatives: [],
          consequences: [`Reference implementation in ${context.id}`],
          domain,
        });
      }
    });

    return decisions;
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    issue: IssueTemplate,
    similarContexts: ResolvedIssueContext[],
    patterns: CodePattern[],
    domainOverview?: string,
    codeContext?: CodeContext | null
  ): string[] {
    const recommendations: string[] = [];

    // Recommendations from similar contexts
    if (similarContexts.length > 0) {
      recommendations.push(
        `Review ${similarContexts.length} similar past implementation(s) for guidance`
      );

      // Component-specific recommendations
      const commonComponents = this.findCommonComponents(similarContexts);
      if (commonComponents.length > 0) {
        recommendations.push(
          `Focus on these frequently modified components: ${commonComponents.join(', ')}`
        );
      }
    }

    // Pattern-based recommendations
    if (patterns.length > 0) {
      const topPattern = patterns.sort((a, b) => b.frequency - a.frequency)[0];
      recommendations.push(
        `Reuse established pattern: "${topPattern.pattern}" (used ${topPattern.frequency} times)`
      );
    }

    // Code context recommendations
    if (codeContext && codeContext.codeSnippets.length > 0) {
      const highRelevanceFiles = codeContext.codeSnippets
        .filter((s) => s.relevance === 'high')
        .map((s) => s.filePath);
      if (highRelevanceFiles.length > 0) {
        recommendations.push(
          `Key files to review/modify: ${highRelevanceFiles.slice(0, 3).join(', ')}`
        );
      }
    }

    // Domain-specific recommendations
    if (domainOverview) {
      recommendations.push(`Review domain overview for key concepts and technologies`);
    }

    // Issue type recommendations (only if no better recommendations exist)
    if (recommendations.length < 2) {
      if (issue.issue.type === 'feature') {
        recommendations.push('Ensure comprehensive test coverage for new feature');
      } else if (issue.issue.type === 'bug') {
        recommendations.push('Add regression tests to prevent recurrence');
      }
    }

    // Priority-based recommendations
    if (issue.issue.priority === 'high') {
      recommendations.push('Validate changes with integration tests before deployment');
    }

    return recommendations;
  }

  /**
   * Find components that appear frequently in similar contexts
   */
  private findCommonComponents(contexts: ResolvedIssueContext[]): string[] {
    const componentCounts = new Map<string, number>();

    contexts.forEach((context) => {
      const allComponents = [
        ...(context.components.api || []),
        ...(context.components.webapp || []),
        ...(context.components.sentinel || []),
      ];

      allComponents.forEach((component) => {
        componentCounts.set(component, (componentCounts.get(component) || 0) + 1);
      });
    });

    // Return components that appear in at least 2 contexts
    return Array.from(componentCounts.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([component]) => component)
      .slice(0, 3);
  }

  /**
   * Calculate historical success rate from similar contexts
   * Returns null if no historical data available
   */
  private calculateSuccessRate(contexts: ResolvedIssueContext[]): number | null {
    if (contexts.length === 0) {
      return null; // No historical data available
    }

    // All resolved issues are successful (phase: completed)
    // In a more complete system, we might track rollbacks, reverts, etc.
    const successfulContexts = contexts.filter((c) => c.phase === 'completed');

    return successfulContexts.length / contexts.length;
  }
}
