/**
 * Domain and Component Inference Utility
 *
 * Infers CHT domain and relevant components from ticket description
 * when not explicitly specified by the user.
 *
 * Uses:
 * 1. Indices (domain-to-components.json, component-to-domains.json) when available
 * 2. Claude LLM reasoning as fallback
 */

// import * as fs from 'fs';
// import * as path from 'path';
import { CHTDomain, IssueTemplate } from '../types';
import { createLLMProviderFromEnv } from '../llm';

/**
 * Load domain mapping indices if they exist
 * TODO: Use this function when implementing index-based inference
 */
// function loadDomainIndices(): {
//   domainToComponents: Record<string, any> | null;
//   componentToDomains: Record<string, string[]> | null;
// } {
//   const indicesDir = path.join(process.cwd(), 'agent-memory', 'indices');
//
//   let domainToComponents = null;
//   let componentToDomains = null;
//
//   try {
//     const domainToComponentsPath = path.join(indicesDir, 'domain-to-components.json');
//     if (fs.existsSync(domainToComponentsPath)) {
//       domainToComponents = JSON.parse(fs.readFileSync(domainToComponentsPath, 'utf-8'));
//     }
//   } catch (error) {
//     // Indices not available yet
//   }
//
//   try {
//     const componentToDomainsPath = path.join(indicesDir, 'component-to-domains.json');
//     if (fs.existsSync(componentToDomainsPath)) {
//       componentToDomains = JSON.parse(fs.readFileSync(componentToDomainsPath, 'utf-8'));
//     }
//   } catch (error) {
//     // Indices not available yet
//   }
//
//   return { domainToComponents, componentToDomains };
// }

/**
 * Format array items for prompt, handling empty arrays gracefully
 */
function formatListForPrompt(items: string[], emptyMessage: string = 'None provided'): string {
  if (!items || items.length === 0) {
    return emptyMessage;
  }
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

/**
 * Domain classification examples to guide the LLM
 * These are hardcoded examples that demonstrate correct domain categorization
 */
const DOMAIN_EXAMPLES = `
Seeds/Examples (Correct Domain Classifications):

1. "Add search functionality to find contacts by phone number"
   → Domain: contacts
   → Reasoning: Directly involves contact lookup and management

2. "Fix login session expiring too quickly on mobile devices"
   → Domain: authentication
   → Reasoning: Session management is part of auth, even though it affects mobile UX

3. "SMS notifications not being sent when tasks are overdue"
   → Domain: messaging
   → Reasoning: Primary issue is SMS delivery, tasks-and-targets is secondary

4. "Form submission fails when offline and doesn't sync when back online"
   → Domain: data-sync
   → Reasoning: Core issue is sync/replication failure, not the form itself

5. "Add new target widget to show monthly vaccination coverage"
   → Domain: tasks-and-targets
   → Reasoning: Targets and coverage metrics are part of tasks-and-targets domain
`;

/**
 * Common pitfalls to help the LLM avoid misclassification
 */
const DOMAIN_PITFALLS = `
Pitfalls (Common Misclassifications to Avoid):

1. Avoid placing "form validation errors" into forms-and-reports when the issue is actually about offline behavior.
   → If sync is involved, prefer data-sync domain.

2. Avoid placing "user can't see certain contacts" into contacts when the issue is about permissions.
   → If roles/permissions are involved, prefer authentication domain.

3. Avoid placing "task not appearing" into tasks-and-targets when the issue is about rules engine configuration.
   → If app settings/config changes are needed, consider configuration domain.

4. Avoid placing "SMS not received" into messaging when the issue is about a gateway/integration setup.
   → If it's a setup/config issue, prefer configuration domain.

5. Avoid placing "report shows wrong data" into forms-and-reports when the issue is about data not syncing.
   → If data freshness/replication is the root cause, prefer data-sync domain.
`;

/**
 * Infer domain and components using LLM
 * Supports both API mode (ANTHROPIC_API_KEY) and CLI mode (LLM_PROVIDER=claude-cli)
 */
async function inferUsingLLM(
  issue: IssueTemplate
): Promise<{ domain: CHTDomain; components: string[] }> {
  const llm = createLLMProviderFromEnv();

  // Format reference data for the prompt
  const similarImplementations = formatListForPrompt(
    issue.issue.reference_data?.similar_implementations || [],
    'None provided'
  );
  const existingReferences = formatListForPrompt(
    issue.issue.technical_context.existing_references || [],
    'None provided'
  );

  const prompt = `You are analyzing a Community Health Toolkit (CHT) issue to identify the relevant domain and components.

CHT Domains:
1. authentication - User login, permissions, roles, session management
2. contacts - Contact management, hierarchy, relationships, person/place management
3. forms-and-reports - Form definitions, submissions, reports, Enketo integration
4. tasks-and-targets - Task generation, targets, scheduling, rules engine
5. messaging - SMS integration, notifications, message sending/receiving
6. data-sync - Replication, offline-first, conflict resolution, PouchDB/CouchDB sync
7. configuration - App configuration, settings, admin features

CHT Architecture Components (examples):
- webapp/modules/* (Angular webapp modules)
- api/controllers/* (API endpoints)
- sentinel/transitions/* (Background processing)
- shared-libs/* (Shared libraries: rules-engine, lineage, cht-datasource, etc.)
- ddocs/* (CouchDB design documents)

${DOMAIN_EXAMPLES}

${DOMAIN_PITFALLS}

Issue to analyze:
Title: ${issue.issue.title}
Type: ${issue.issue.type}
Priority: ${issue.issue.priority}

Description:
${issue.issue.description}

Requirements:
${formatListForPrompt(issue.issue.requirements)}

Constraints:
${formatListForPrompt(issue.issue.constraints)}

Similar Implementations (PRs/code that solved similar problems):
${similarImplementations}

Existing Code References (paths in codebase mentioned by ticket author):
${existingReferences}

Based on this issue and the examples/pitfalls above, identify:
1. The PRIMARY domain (one of the 7 listed above)
2. Likely components that would be affected (be specific but realistic)

Respond in this exact JSON format:
{
  "domain": "domain-name",
  "components": ["component1", "component2"],
  "reasoning": "Brief explanation of why this domain and these components"
}`;

  const response = await llm.invoke(prompt, { temperature: 0.2 });
  const content = response.content;

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('LLM did not return valid JSON response');
  }

  // Parse JSON with error handling
  let result: { domain?: string; components?: string[]; reasoning?: string };
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error(
      `LLM returned malformed JSON. Parse error: ${error instanceof Error ? error.message : 'Unknown error'}. Raw response: ${jsonMatch[0].substring(0, 200)}...`
    );
  }

  // Validate required fields
  if (!result.domain || typeof result.domain !== 'string') {
    throw new Error(
      `LLM response missing required "domain" field. Got: ${JSON.stringify(result)}`
    );
  }

  // Validate domain is one of the valid CHT domains
  const validDomains: CHTDomain[] = [
    'authentication',
    'contacts',
    'forms-and-reports',
    'tasks-and-targets',
    'messaging',
    'data-sync',
    'configuration',
  ];

  if (!validDomains.includes(result.domain as CHTDomain)) {
    throw new Error(
      `LLM returned invalid domain: "${result.domain}". Must be one of: ${validDomains.join(', ')}`
    );
  }

  return {
    domain: result.domain as CHTDomain,
    components: Array.isArray(result.components) ? result.components : [],
  };
}

/**
 * Main function: Infer domain and components for an issue
 */
export async function inferDomainAndComponents(
  issue: IssueTemplate,
  _modelName?: string // Deprecated: model is now determined by LLM_PROVIDER env var
): Promise<{ domain: CHTDomain; components: string[] }> {
  // If domain is already specified, keep it
  const hasExistingDomain = issue.issue.technical_context.domain !== undefined;
  const hasExistingComponents = issue.issue.technical_context.components.length > 0;

  if (hasExistingDomain && hasExistingComponents) {
    console.log('[Domain Inference] Using domain and components from ticket');
    return {
      domain: issue.issue.technical_context.domain!,
      components: issue.issue.technical_context.components,
    };
  }

  console.log('[Domain Inference] Inferring domain and components...');

  // Try to use indices first (when implemented)
  // const indices = loadDomainIndices();
  // TODO: Implement index-based inference when indices are populated

  // For now, use LLM inference
  const inferred = await inferUsingLLM(issue);

  console.log(`[Domain Inference] Inferred domain: ${inferred.domain}`);
  console.log(`[Domain Inference] Inferred components: ${inferred.components.join(', ')}`);

  return inferred;
}

/**
 * Enrich an issue template with inferred domain/components
 */
export async function enrichIssueTemplate(
  issue: IssueTemplate,
  modelName?: string
): Promise<IssueTemplate> {
  const { domain, components } = await inferDomainAndComponents(issue, modelName);

  return {
    issue: {
      ...issue.issue,
      technical_context: {
        ...issue.issue.technical_context,
        domain: domain,
        components: components.length > 0 ? components : issue.issue.technical_context.components,
      },
    },
  };
}
