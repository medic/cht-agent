import { ResearchSupervisor } from '../supervisors/research-supervisor';
import {
  CrossFileIssue,
  IssueTemplate,
  OrchestrationPlan,
  ResearchState,
  XlsformApplyResult,
  XlsformApplyExhausted,
} from '../types';
import { parseTicketFile } from '../utils/ticket-parser';
import { saveResearchResults } from '../utils/research-results';
import { isUsingCLIProvider } from '../llm/factory';

/**
 * H.4 (v6): per-issueType headings for the HC2 unresolved-issues banner.
 * Issues without a recognized `issueType` fall under {@link FALLBACK_HEADING}
 * (the static validators don't emit issueType, so their entries land there).
 */
const ISSUE_TYPE_HEADINGS: Record<string, string> = {
  'compile-error': 'TypeScript errors remain',
  'partial-completion': 'Generation ended before completing the plan',
  'plan-adherence-missing': 'Planned files were not modified',
  'plan-adherence-extra': 'Unplanned files were modified',
  'plan-discovered-missing': 'LLM flagged files it thinks are required but not in the approved plan',
  'execute-no-op': 'CLI explored but produced no edits (abstained even after relaxed retry)',
};

const FALLBACK_HEADING = 'Other unresolved issues';
const MAX_ENTRIES_PER_GROUP = 10;

/**
 * Render the HC2 unresolved-issues banner. Groups issues by issueType so each
 * failure mode gets its own labeled section; up to 10 entries per group, with
 * a "+ N more" footer for overflow. Returns an empty string when there are
 * no issues so callers can unconditionally render the result.
 */
export const renderCrossFileIssueBanner = (issues: CrossFileIssue[] | undefined): string => {
  if (!issues || issues.length === 0) return '';
  const groups = groupIssuesByType(issues);
  const lines: string[] = ['', '⚠️  UNRESOLVED ISSUES REMAIN AFTER REFINEMENT', '─'.repeat(70)];
  for (const [type, items] of groups) appendIssueGroup(lines, type, items);
  lines.push(
    'You may still accept the diff (manual fix required), refine further, or abandon.',
    '─'.repeat(70),
  );
  return lines.join('\n');
};

/**
 * Render the mission-05 HC2 bind-level diff for an XLSForm fix. The regenerated
 * XML is a whole-file rewrite, so the positional line differ is noise; this
 * banner is the trustworthy view — the one target bind old→new plus the count
 * of sibling top-level group binds verified byte-unchanged. Empty string when
 * there is no XLSForm apply (so callers render it unconditionally).
 */
export const renderXlsformBindDiffBanner = (apply: XlsformApplyResult | undefined): string => {
  if (!apply) return '';
  const { bindDiff, form, xlsxRelPath } = apply;
  // P2: render the full per-attribute before→after (value / '(absent)') so an
  // attrs-only fix (no `relevant` change, e.g. a removed `calculate`) shows its
  // real delta rather than an empty relevant line.
  const show = (v: string | null | undefined): string => (v === null || v === undefined ? '(absent)' : v);
  const attrLines = Object.keys(bindDiff.attrs).map(
    (attr) => `  ${attr}: ${show(bindDiff.attrsBefore[attr])} → ${show(bindDiff.attrs[attr])}`,
  );
  return [
    '',
    '🔧 XLSFORM FIX — verified against the OFFLINE conversion',
    '─'.repeat(70),
    `form:   ${form}  (source of truth: ${xlsxRelPath})`,
    `bind:   ${bindDiff.nodeset}`,
    ...attrLines,
    `${bindDiff.siblingsUnchanged} sibling top-level group bind(s) unchanged.`,
    'Trust this bind diff over the positional file diff below (the XML is a full rewrite).',
    '─'.repeat(70),
  ].join('\n');
};

/**
 * Render the mission-05 F4 "NO FIX PRODUCED" banner. Shown at HC2 (and echoed by
 * the CLI failure summary) when the XLSForm-fix refinement loop exhausted every
 * iteration without a converting descriptor. Staging writes nothing on this
 * path and the workflow result is a failure; this banner tells the human WHY.
 * Empty string when there is no exhaustion marker (so callers render it
 * unconditionally).
 */
export const renderXlsformExhaustedBanner = (exhausted: XlsformApplyExhausted | undefined): string => {
  if (!exhausted) return '';
  return [
    '',
    `❌ NO FIX PRODUCED — xlsform apply failed after ${exhausted.iterations} iteration(s)`,
    '─'.repeat(70),
    `Last failure: ${exhausted.reason}`,
    'Nothing was staged and no changes will be written. The descriptor never',
    'converted cleanly, so there is no verified fix to apply. Refine the ticket',
    'or the fix descriptor and re-run.',
    '─'.repeat(70),
  ].join('\n');
};

function groupIssuesByType(issues: CrossFileIssue[]): Map<string, CrossFileIssue[]> {
  const groups = new Map<string, CrossFileIssue[]>();
  for (const issue of issues) {
    const key = issue.issueType ?? 'other';
    const bucket = groups.get(key);
    if (bucket) bucket.push(issue);
    else groups.set(key, [issue]);
  }
  return groups;
}

function appendIssueGroup(lines: string[], type: string, items: CrossFileIssue[]): void {
  const heading = ISSUE_TYPE_HEADINGS[type] ?? FALLBACK_HEADING;
  lines.push(`${heading} (${items.length}):`);
  for (const item of items.slice(0, MAX_ENTRIES_PER_GROUP)) {
    const detail = item.description ?? item.reason ?? '(no detail)';
    lines.push(`  - ${item.filePath}: ${detail}`);
  }
  if (items.length > MAX_ENTRIES_PER_GROUP) {
    lines.push(`  ... and ${items.length - MAX_ENTRIES_PER_GROUP} more`);
  }
  lines.push('');
}

/**
 * Render a separate banner when the compile gate did not run (e.g., tsc
 * unavailable in cht-core's node_modules). The user sees the remediation
 * command alongside the diff so they know what to do.
 */
export const renderCompileGateSkipBanner = (skipReason: string, chtCorePath: string): string => {
  return [
    '',
    '⚠️  COMPILE GATE NOT RUN',
    '─'.repeat(70),
    `Reason: ${skipReason}`,
    `Remediation: cd ${chtCorePath} && npm install`,
    'You may still accept the diff (compile not verified), refine, or abandon.',
    '─'.repeat(70),
  ].join('\n');
};

export const validateEnvironment = () => {
  if (isUsingCLIProvider()) {
    console.log('🔌 LLM provider: claude-cli — no ANTHROPIC_API_KEY required\n');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables');
    console.log('\nPlease create a .env file with your Anthropic API key:');
    console.log('ANTHROPIC_API_KEY=your_api_key_here\n');
    process.exit(1);
  }
};

export const displayIssueDetails = (ticket: IssueTemplate) => {
  console.log('📋 Issue Details:');
  console.log('━'.repeat(70));
  console.log(`Title: ${ticket.issue.title}`);
  console.log(`Type: ${ticket.issue.type}`);
  console.log(`Priority: ${ticket.issue.priority}`);
  if (ticket.issue.technical_context.domain) {
    console.log(`Domain: ${ticket.issue.technical_context.domain}`);
  }
  if (ticket.issue.technical_context.components.length > 0) {
    console.log(`Components: ${ticket.issue.technical_context.components.join(', ')}`);
  }
  console.log('━'.repeat(70));
  console.log();
};

export const displayResearchFindings = (result: ResearchState) => {
  if (!result.researchFindings) return;

  console.log('📚 DOCUMENTATION SEARCH RESULTS');
  console.log('─'.repeat(70));
  console.log(`Source: ${result.researchFindings.source}`);
  console.log(`Confidence: ${(result.researchFindings.confidence * 100).toFixed(0)}%`);
  console.log(
    `\nDocumentation References (${result.researchFindings.documentationReferences.length}):`
  );

  result.researchFindings.documentationReferences.forEach((ref, i) => {
    console.log(`\n${i + 1}. ${ref.title}`);
    console.log(`   URL: ${ref.url}`);
    console.log(`   Topics: ${ref.topics.join(', ')}`);
    if (ref.relevantSections && ref.relevantSections.length > 0) {
      console.log(`   Sections: ${ref.relevantSections.join(', ')}`);
    }
  });

  if (result.researchFindings.suggestedApproaches.length > 0) {
    console.log('\nSuggested Approaches:');
    result.researchFindings.suggestedApproaches.forEach((approach, i) => {
      console.log(`   ${i + 1}. ${approach}`);
    });
  }

  console.log();
};

export const displayCodeContextFindings = (result: ResearchState) => {
  if (!result.codeContextFindings) return;

  console.log('🏗️  CODE CONTEXT RESULTS');
  console.log('─'.repeat(70));
  console.log(`Source: ${result.codeContextFindings.source}`);
  console.log(`Confidence: ${(result.codeContextFindings.confidence * 100).toFixed(0)}%`);
  console.log(`Repos: ${result.codeContextFindings.relevantRepos.join(', ')}`);
  console.log(
    `\nArchitecture Insights (${result.codeContextFindings.architectureInsights.length}):`
  );

  result.codeContextFindings.architectureInsights.forEach((insight, i) => {
    console.log(`\n${i + 1}. ${insight.component}`);
    console.log(`   ${insight.description}`);
    console.log(`   Patterns: ${insight.patterns.join(', ')}`);
    console.log(`   Dependencies: ${insight.dependencies.join(', ')}`);
  });

  if (result.codeContextFindings.moduleRelationships.length > 0) {
    console.log(
      `\nModule Relationships (${result.codeContextFindings.moduleRelationships.length}):`
    );
    result.codeContextFindings.moduleRelationships.forEach((rel, i) => {
      console.log(`   ${i + 1}. ${rel.source} → ${rel.target} (${rel.relationship})`);
      console.log(`      ${rel.description}`);
    });
  }

  if (result.codeContextFindings.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.codeContextFindings.warnings.forEach(warning => {
      console.log(`   - ${warning}`);
    });
  }

  console.log();
};

export const displayContextAnalysis = (result: ResearchState) => {
  if (!result.contextAnalysis) return;

  console.log('🔎 CONTEXT ANALYSIS RESULTS');
  console.log('─'.repeat(70));
  console.log(`Similar Past Issues: ${result.contextAnalysis.similarContexts.length}`);
  console.log(`Reusable Patterns: ${result.contextAnalysis.reusablePatterns.length}`);
  console.log(`Design Decisions: ${result.contextAnalysis.relevantDesignDecisions.length}`);

  if (result.contextAnalysis.recommendations.length > 0) {
    console.log('\nRecommendations:');
    result.contextAnalysis.recommendations.forEach((rec, i) => {
      console.log(`   ${i + 1}. ${rec}`);
    });
  }

  if (result.contextAnalysis.reusablePatterns.length > 0) {
    console.log('\nReusable Patterns:');
    result.contextAnalysis.reusablePatterns.forEach((pattern, i) => {
      console.log(`   ${i + 1}. ${pattern.pattern} (used ${pattern.frequency} times)`);
      console.log(`      ${pattern.description}`);
    });
  }

  console.log();
};

export const displayPlanPhases = (plan: OrchestrationPlan) => {
  console.log(`\nImplementation Phases (${plan.phases.length}):`);
  plan.phases.forEach((phase, i) => {
    console.log(`\n   ${i + 1}. ${phase.name} [${phase.estimatedComplexity}]`);
    console.log(`      ${phase.description}`);
    console.log(`      Components: ${phase.suggestedComponents.join(', ')}`);
    if (phase.dependencies.length > 0) {
      console.log(`      Dependencies: ${phase.dependencies.join(', ')}`);
    }
  });

  if (plan.riskFactors.length > 0) {
    console.log('\n⚠️  Risk Factors:');
    plan.riskFactors.forEach((risk, i) => {
      console.log(`   ${i + 1}. ${risk}`);
    });
  }
};

export const displayOrchestrationPlan = (result: ResearchState) => {
  if (!result.orchestrationPlan) return;

  console.log('📋 ORCHESTRATION PLAN');
  console.log('─'.repeat(70));
  console.log(
    `Estimated Complexity: ${result.orchestrationPlan.estimatedComplexity.toUpperCase()}`
  );
  console.log(`Estimated Effort: ${result.orchestrationPlan.estimatedEffort}`);
  console.log('\nProposed Approach:');
  console.log(`   ${result.orchestrationPlan.proposedApproach}`);

  console.log('\nKey Findings:');
  result.orchestrationPlan.keyFindings.forEach((finding, i) => {
    console.log(`   ${i + 1}. ${finding}`);
  });

  displayPlanPhases(result.orchestrationPlan);
  console.log();
};

export const loadTicket = (ticketPath: string, helpHints: string[]): IssueTemplate => {
  try {
    const ticket = parseTicketFile(ticketPath);
    console.log('✅ Ticket parsed successfully!\n');
    return ticket;
  } catch (error) {
    console.error('❌ Error parsing ticket file:');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    }
    console.log('\n💡 Ticket file format:');
    helpHints.forEach(hint => console.log(`   - ${hint}`));
    console.log('   - See tickets/contact-search-feature.md for an example');
    console.log('   - See tickets/README.md for complete documentation\n');
    process.exit(1);
  }
};

export const runResearchWorkflow = async (
  bannerTitle: string,
  getTicketPath: () => string,
  helpHints: string[],
) => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log(`║${bannerTitle.padStart(34 + bannerTitle.length / 2).padEnd(64)}║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  validateEnvironment();

  const ticketPath = getTicketPath();
  console.log(`📄 Loading ticket from: ${ticketPath}\n`);

  const ticket = loadTicket(ticketPath, helpHints);

  console.log('🤖 Initializing Research Supervisor...\n');
  const supervisor = new ResearchSupervisor({
    modelName: process.env.RESEARCH_MODEL || 'claude-sonnet-4-20250514',
    useMockMCP: false,
  });

  displayIssueDetails(ticket);

  console.log('🔍 Running Research Phase...\n');
  const startTime = Date.now();
  const result = await supervisor.research(ticket);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  displayResults(result, duration);
};

export const displayResults = (result: ResearchState, duration: string) => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      RESEARCH RESULTS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`⏱️  Duration: ${duration} seconds`);
  console.log(`📊 Phase: ${result.currentPhase}`);
  console.log(`❌ Errors: ${result.errors.length}\n`);

  if (result.errors.length > 0) {
    console.log('⚠️  Errors encountered:');
    result.errors.forEach(error => console.log(`   - ${error}`));
    console.log();
  }

  displayResearchFindings(result);
  displayCodeContextFindings(result);
  displayContextAnalysis(result);
  displayOrchestrationPlan(result);

  try {
    const outputPath = saveResearchResults(result);
    console.log(`💾 Results saved to: ${outputPath}\n`);
  } catch (saveError) {
    console.warn('⚠️  Could not save results to file:', saveError);
  }

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                  Research Phase Complete! ✅                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('💡 Next Steps:');
  console.log('   1. Review the orchestration plan');
  console.log('   2. Validate research findings');
  console.log('   3. Proceed to Development Phase');
  console.log();
};