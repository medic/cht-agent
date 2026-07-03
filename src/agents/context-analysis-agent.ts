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
  CHTLayer,
  ConfigMechanism,
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
  private readonly todos: TodoTracker;

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
        relatedDomains: [],
        codeContext: null,
      };
    }

    // Load domain context
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
      async () => this.generateRecommendations({
        issue,
        similarContexts,
        patterns,
        domainOverview: domainOverview?.content,
        codeContext,
      })
    );
    console.log(`[Context Analysis Agent] Generated ${recommendations.length} recommendations`);

    // Get related domains
    const relatedDomains = domainOverview ? getRelatedDomains(domain) : [];

    this.todos.printSummary();

    return {
      similarContexts,
      reusablePatterns: patterns,
      relevantDesignDecisions: designDecisions,
      recommendations,
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
    }

    console.log('[Context Analysis Agent] No code context available (CHT_CORE_PATH not set?)');
    return null;
  }

  /**
   * Find similar issues from knowledge base. Entries are scoped to the ticket's
   * layer first (a config ticket must never surface platform fixes and vice
   * versa; investigate tickets keep both layers in play), then scored, then
   * de-duplicated by issue id.
   */
  private findSimilarIssues(issue: IssueTemplate, domain: CHTDomain): ResolvedIssueContext[] {
    // Load resolved issues for this domain
    const resolvedIssues = findResolvedIssuesByDomain(domain);

    if (resolvedIssues.length === 0) {
      console.log(`[Context Analysis Agent] No resolved issues found for domain: ${domain}`);
      return [];
    }

    const ticketLayer: CHTLayer = issue.issue.technical_context.layer ?? 'cht-core';
    const layerScoped = resolvedIssues.filter((resolved) => {
      if (ticketLayer === 'investigate') {
        return true;
      }
      return (resolved.layer ?? 'cht-core') === ticketLayer;
    });

    // Score and rank issues by similarity
    const scoredIssues = layerScoped.map((resolved) => ({
      issue: resolved,
      score: this.calculateSimilarityScore(issue, resolved),
    }));

    return this.dedupeByIssueId(scoredIssues.toSorted((a, b) => b.score - a.score))
      .slice(0, 5)
      .filter((item) => item.score > 0.3)
      .map((item) => item.issue);
  }

  /**
   * The corpus can hold several drafts distilled from the same GitHub issue
   * (one per source PR). The #129 relink made the issue id trustworthy, so keep
   * only the highest-scoring entry per issue (the input is sorted by score).
   * Entries without an issue_number fall back to their draft id — the loader
   * derives it from the draft's file name when frontmatter has neither field,
   * so distinct files keep distinct keys.
   */
  private dedupeByIssueId(
    sorted: Array<{ issue: ResolvedIssueContext; score: number }>
  ): Array<{ issue: ResolvedIssueContext; score: number }> {
    const seen = new Set<string>();
    return sorted.filter(({ issue }) => {
      const key = issue.issue_number === undefined ? issue.id : String(issue.issue_number);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Calculate similarity score between current issue and resolved issue.
   * Core tickets keep the original category/domain/component scoring; when
   * either side is a cht-conf entry the config-shaped scoring applies instead
   * (strong layer match plus configArtifact/mechanism overlap — core-shaped
   * service/component overlap carries no signal for config fixes).
   */
  private calculateSimilarityScore(current: IssueTemplate, resolved: ResolvedIssueContext): number {
    const ticketLayer: CHTLayer = current.issue.technical_context.layer ?? 'cht-core';
    const entryLayer: CHTLayer = resolved.layer ?? 'cht-core';

    if (ticketLayer !== 'cht-conf' && entryLayer !== 'cht-conf') {
      return this.calculateCoreSimilarityScore(current, resolved);
    }

    return this.calculateConfigSimilarityScore(current, resolved, ticketLayer, entryLayer);
  }

  private calculateCoreSimilarityScore(
    current: IssueTemplate,
    resolved: ResolvedIssueContext
  ): number {
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

    return Math.min(score, 1);
  }

  private calculateConfigSimilarityScore(
    current: IssueTemplate,
    resolved: ResolvedIssueContext,
    ticketLayer: CHTLayer,
    entryLayer: CHTLayer
  ): number {
    let score = 0;

    // Category match (weaker than for core: config fixes cluster by artifact, not type)
    if (resolved.category === current.issue.type) {
      score += 0.2;
    }

    // Strong layer match. An investigate ticket treats both layers as
    // compatible — it is the one case with a mixed candidate pool, and without
    // this its config entries would be capped at 0.7 while core entries (scored
    // by the core path) can reach 1.0. For cht-conf tickets the pool is all-conf
    // after layer scoping, so the term simply keeps conf scores comparable.
    if (ticketLayer === entryLayer || ticketLayer === 'investigate') {
      score += 0.3;
    }

    // Suspect artifact match: the strongest config signal
    const ticketArtifact = current.issue.technical_context.configArtifact;
    if (ticketArtifact && resolved.configArtifact === ticketArtifact) {
      score += 0.3;
    }

    // Mechanism overlap: the entry's mechanism is named in the ticket text
    if (resolved.mechanism && this.ticketMentionsMechanism(current, resolved.mechanism)) {
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  private ticketMentionsMechanism(current: IssueTemplate, mechanism: ConfigMechanism): boolean {
    const haystack = [
      current.issue.title,
      current.issue.description,
      ...current.issue.technical_context.components,
    ].join(' ');

    // Word-boundary match: 'events' must not fire inside 'prevents', nor
    // 'relevant' inside 'irrelevant'. Mechanisms are plain \w tokens, so no
    // regex escaping is needed.
    return new RegExp(`\\b${mechanism}\\b`, 'i').test(haystack);
  }

  /**
   * Extract reusable patterns from similar contexts. Core entries are grouped
   * by frequently-shared components; for cht-conf entries the reusable pattern
   * is the config snippet itself (the before/after expression from the draft's
   * Config Pattern section), one pattern per entry.
   */
  private extractPatterns(
    contexts: ResolvedIssueContext[],
    _domainComponents: DomainComponents | null
  ): CodePattern[] {
    const coreContexts = contexts.filter((context) => !this.isConfigContext(context));
    const configContexts = contexts.filter((context) => this.isConfigContext(context));

    const patterns: CodePattern[] = [];

    // Group core contexts by components
    const componentGroups = new Map<string, ResolvedIssueContext[]>();

    coreContexts.forEach((context) => {
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
    componentGroups.forEach((groupContexts, component) => {
      if (groupContexts.length >= 2) {
        patterns.push({
          pattern: `${component} implementation pattern`,
          description: `Commonly used pattern for ${component}`,
          example: `See resolved issues: ${groupContexts.map((c) => c.id).join(', ')}`,
          domain: groupContexts[0].domains[0],
          frequency: groupContexts.length,
        });
      }
    });

    configContexts.forEach((context) => {
      patterns.push(this.buildConfigPattern(context));
    });

    return patterns;
  }

  private isConfigContext(context: ResolvedIssueContext): boolean {
    return (context.layer ?? 'cht-core') === 'cht-conf';
  }

  private buildConfigPattern(context: ResolvedIssueContext): CodePattern {
    const mechanism = context.mechanism ?? 'config';
    const artifact = context.configArtifact ?? 'configuration';

    return {
      pattern: `${mechanism} fix for ${artifact} (${context.id})`,
      description: context.summary || `Config fix from ${context.id}`,
      example: context.fix ?? `See resolved issue: ${context.id}`,
      domain: context.domains[0],
      frequency: 1,
    };
  }

  /**
   * Extract design decisions from similar contexts. Core entries derive a
   * tech-stack decision; cht-conf entries record that the fix belongs at the
   * config layer (artifact + mechanism), pointing at the reusable snippet.
   */
  private extractDesignDecisions(
    contexts: ResolvedIssueContext[],
    domain: CHTDomain
  ): DesignDecision[] {
    const decisions: DesignDecision[] = [];

    // For POC, generate decisions based on context metadata
    // In production, these would be extracted from the full context files

    contexts.forEach((context) => {
      if (this.isConfigContext(context)) {
        decisions.push(this.buildConfigDesignDecision(context, domain));
        return;
      }

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

  private buildConfigDesignDecision(
    context: ResolvedIssueContext,
    domain: CHTDomain
  ): DesignDecision {
    const mechanism = context.mechanism ?? 'configuration';
    const artifact = context.configArtifact ?? 'config artifact';

    return {
      decision: `Fix at the config layer: edit the ${artifact} ${mechanism}, not cht-core code`,
      rationale: context.summary || `Successfully resolved in ${context.id}`,
      alternatives: [],
      consequences: [`Reusable config snippet available from ${context.id}`],
      domain,
    };
  }

  /**
   * Generate recommendations based on analysis.
   */
  private generateRecommendations(opts: {
    issue: IssueTemplate;
    similarContexts: ResolvedIssueContext[];
    patterns: CodePattern[];
    domainOverview?: string;
    codeContext?: CodeContext | null;
  }): string[] {
    const { issue, similarContexts, patterns, domainOverview, codeContext } = opts;
    return [
      ...this.recommendationsFromSimilarContexts(similarContexts),
      ...this.recommendationsFromPatterns(patterns),
      ...this.recommendationsFromCodeContext(codeContext),
      ...(domainOverview ? ['Review domain overview for key concepts and technologies'] : []),
      ...this.getIssueTypeRecommendations(issue),
    ];
  }

  private recommendationsFromSimilarContexts(similarContexts: ResolvedIssueContext[]): string[] {
    if (similarContexts.length === 0) return [];
    const recs: string[] = [
      `Review ${similarContexts.length} similar past implementation(s) for guidance`,
    ];
    const commonComponents = this.findCommonComponents(similarContexts);
    if (commonComponents.length > 0) {
      recs.push(`Focus on these frequently modified components: ${commonComponents.join(', ')}`);
    }
    return recs;
  }

  private recommendationsFromPatterns(patterns: CodePattern[]): string[] {
    if (patterns.length === 0) return [];
    const topPattern = patterns.toSorted((a, b) => b.frequency - a.frequency)[0];
    return [`Reuse established pattern: "${topPattern.pattern}" (used ${topPattern.frequency} times)`];
  }

  private recommendationsFromCodeContext(codeContext: CodeContext | null | undefined): string[] {
    if (!codeContext?.codeSnippets.length) return [];
    const highRelevanceFiles = codeContext.codeSnippets
      .filter(s => s.relevance === 'high')
      .map(s => s.filePath);
    if (highRelevanceFiles.length === 0) return [];
    return [`Key files to review/modify: ${highRelevanceFiles.slice(0, 3).join(', ')}`];
  }

  private getIssueTypeRecommendations(issue: IssueTemplate): string[] {
    const typeRecs: Record<string, string[]> = {
      feature: [
        'Ensure comprehensive test coverage for new feature',
        'Update documentation and configuration examples',
      ],
      bug: [
        'Add regression tests to prevent recurrence',
        'Check for similar issues in related components',
      ],
      improvement: [
        'Add or extend tests around the improved behavior',
        'Confirm no regressions in related workflows',
      ],
    };

    const recs = typeRecs[issue.issue.type] || [];

    if (issue.issue.priority === 'high') {
      recs.push('Validate changes with integration tests before deployment');
    }

    return recs;
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
      .toSorted((a, b) => b[1] - a[1])
      .map(([component]) => component)
      .slice(0, 3);
  }

}
