/**
 * Context Analysis Agent
 *
 * Loads and analyzes relevant context files from previous resolutions
 * Identifies patterns from similar past issues
 * Provides historical insights to other agents
 */

import {
  ContextAnalysisResult,
  IssueTemplate,
  ResolvedIssueContext,
  CodePattern,
  DesignDecision,
  CHTDomain,
  DomainComponents
} from '../types';
import {
  loadDomainOverview,
  loadDomainComponents,
  findResolvedIssuesByDomain,
  getRelatedDomains,
  ensureAgentMemoryExists
} from '../utils/context-loader';

export class ContextAnalysisAgent {
  constructor(_options: { modelName?: string } = {}) {
    // Model will be used for advanced pattern analysis in future iterations
    // For now, we use rule-based analysis

    // Ensure agent-memory directory exists
    ensureAgentMemoryExists();
  }

  /**
   * Main entry point for context analysis
   */
  async analyze(issue: IssueTemplate): Promise<ContextAnalysisResult> {
    console.log('\n[Context Analysis Agent] Starting context analysis...');
    console.log(`[Context Analysis Agent] Domain: ${issue.issue.technical_context.domain}`);

    const domain = issue.issue.technical_context.domain;

    // Domain should have been inferred by now, but handle gracefully if missing
    if (!domain) {
      console.warn('[Context Analysis Agent] Warning: No domain specified - returning empty analysis');
      return {
        similarContexts: [],
        reusablePatterns: [],
        relevantDesignDecisions: [],
        recommendations: ['Domain not specified - unable to analyze context'],
        historicalSuccessRate: 0.5,
        relatedDomains: []
      };
    }

    // Load domain context
    const domainOverview = loadDomainOverview(domain);
    const domainComponents = loadDomainComponents(domain);

    // Find similar past issues
    const similarContexts = this.findSimilarIssues(issue, domain);
    console.log(`[Context Analysis Agent] Found ${similarContexts.length} similar past issues`);

    // Extract patterns from similar contexts
    const patterns = this.extractPatterns(similarContexts, domainComponents);
    console.log(`[Context Analysis Agent] Extracted ${patterns.length} reusable patterns`);

    // Extract design decisions
    const designDecisions = this.extractDesignDecisions(similarContexts, domain);
    console.log(`[Context Analysis Agent] Found ${designDecisions.length} relevant design decisions`);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      issue,
      similarContexts,
      patterns,
      domainOverview?.content
    );
    console.log(`[Context Analysis Agent] Generated ${recommendations.length} recommendations`);

    // Calculate historical success rate
    const successRate = this.calculateSuccessRate(similarContexts);

    // Get related domains
    const relatedDomains = domainOverview
      ? getRelatedDomains(domain)
      : [];

    return {
      similarContexts,
      reusablePatterns: patterns,
      relevantDesignDecisions: designDecisions,
      recommendations,
      historicalSuccessRate: successRate,
      relatedDomains
    };
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
    const scoredIssues = resolvedIssues.map(resolved => ({
      issue: resolved,
      score: this.calculateSimilarityScore(issue, resolved)
    }));

    // Sort by score and return top 5
    return scoredIssues
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .filter(item => item.score > 0.3) // Minimum similarity threshold
      .map(item => item.issue);
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
    if (current.issue.technical_context.domain && resolved.domains.includes(current.issue.technical_context.domain)) {
      score += 0.4;
    }

    // Component overlap
    const currentComponents = current.issue.technical_context.components;
    const resolvedComponents = [
      ...(resolved.components.api || []),
      ...(resolved.components.webapp || []),
      ...(resolved.components.sentinel || []),
      ...(resolved.components.shared_libs || [])
    ];

    const componentOverlap = currentComponents.filter(comp =>
      resolvedComponents.some(resolvedComp =>
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

    contexts.forEach(context => {
      const allComponents = [
        ...(context.components.api || []),
        ...(context.components.webapp || []),
        ...(context.components.sentinel || [])
      ];

      allComponents.forEach(component => {
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
          example: `See resolved issues: ${contexts.map(c => c.id).join(', ')}`,
          domain: contexts[0].domains[0],
          frequency: contexts.length
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

    contexts.forEach(context => {
      if (context.tech_stack && context.tech_stack.length > 0) {
        decisions.push({
          decision: `Use ${context.tech_stack.join(', ')} for ${context.category}`,
          rationale: `Successfully used in ${context.id}`,
          alternatives: [],
          consequences: [`Reference implementation in ${context.id}`],
          domain
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
    domainOverview?: string
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

    // Domain-specific recommendations
    if (domainOverview) {
      recommendations.push(
        `Review domain overview for key concepts and technologies`
      );
    }

    // Issue type recommendations
    if (issue.issue.type === 'feature') {
      recommendations.push('Ensure comprehensive test coverage for new feature');
      recommendations.push('Update documentation and configuration examples');
    } else if (issue.issue.type === 'bug') {
      recommendations.push('Add regression tests to prevent recurrence');
      recommendations.push('Check for similar issues in related components');
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

    contexts.forEach(context => {
      const allComponents = [
        ...(context.components.api || []),
        ...(context.components.webapp || []),
        ...(context.components.sentinel || [])
      ];

      allComponents.forEach(component => {
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
   */
  private calculateSuccessRate(contexts: ResolvedIssueContext[]): number {
    if (contexts.length === 0) {
      return 0.5; // Neutral when no history
    }

    // All resolved issues are successful (phase: completed)
    // In a more complete system, we might track rollbacks, reverts, etc.
    const successfulContexts = contexts.filter(c => c.phase === 'completed');

    return successfulContexts.length / contexts.length;
  }
}
