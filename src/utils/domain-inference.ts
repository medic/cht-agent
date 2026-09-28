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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CHTDomain, IssueTemplate } from '../types';
import { createLLMProviderFromEnv } from '../llm';
import { CHT_DOMAINS } from '../constants';

interface DomainIndices {
  domainToComponents: Record<string, unknown> | null;
  componentToDomains: Record<string, string[]> | null;
}

/**
 * One-line description per domain, keyed by CHTDomain so the inference prompt's
 * roster is single-sourced from CHT_DOMAINS. The Record type fails to compile if
 * a domain is added without a description, which prevents the "7 vs 9" drift the
 * old hardcoded list had.
 */
const DOMAIN_DESCRIPTIONS: Record<CHTDomain, string> = {
  authentication: 'User login, permissions, roles, session management',
  contacts: 'Contact management, hierarchy, relationships, person/place management',
  'forms-and-reports': 'Form definitions, submissions, reports, Enketo integration',
  'tasks-and-targets': 'Task generation, targets, scheduling, rules engine',
  messaging: 'SMS integration, notifications, message sending/receiving',
  'data-sync': 'Replication, offline-first, conflict resolution, PouchDB/CouchDB sync',
  configuration: 'App configuration, settings, translations, admin features',
  interoperability: 'FHIR, OpenHIM, DHIS2, outbound push, external system integration',
  infrastructure: 'CI, build, release, deploy, Docker/Helm/HAProxy, upgrade tooling — operational lifecycle',
  'data-access': 'cht-datasource library API surface — entity modules, local/remote implementations, qualifiers, and the api controllers/routes that back the remote path. Use when the work extends the data-access layer itself, not when it merely consumes it',
};

/** Numbered domain roster injected into the inference prompt, derived from CHT_DOMAINS. */
const DOMAIN_ROSTER = CHT_DOMAINS
  .map((d, i) => `${i + 1}. ${d} - ${DOMAIN_DESCRIPTIONS[d]}`)
  .join('\n');

const loadJsonIndex = (filePath: string): Record<string, unknown> | null => {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // Index not available yet
  }
  return null;
};

const loadDomainIndices = (): DomainIndices => {
  const indicesDir = path.join(process.cwd(), 'agent-memory', 'indices');

  return {
    domainToComponents: loadJsonIndex(path.join(indicesDir, 'domain-to-components.json')),
    componentToDomains: loadJsonIndex(path.join(indicesDir, 'component-to-domains.json')) as Record<string, string[]> | null,
  };
};

/**
 * Format array items for prompt, handling empty arrays gracefully
 */
const formatListForPrompt = (items: string[], emptyMessage: string = 'None provided'): string => {
  if (!items || items.length === 0) {
    return emptyMessage;
  }
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
};

/**
 * Domain classification examples to guide the LLM
 * These are hardcoded examples that demonstrate correct domain categorization
 */
export const DOMAIN_EXAMPLES = `
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

6. "Add Brazilian Portuguese translations and register the pt locale"
   → Domain: configuration
   → Reasoning: App settings, translations, branding, and hierarchy config are canonically the configuration domain — these are strong fits, not catch-all picks

7. "Skip CouchDB compaction during API upgrade" / "Bump the CouchDB Docker image and rename the CI container" / "Fix build version computation for release branches"
   → Domain: infrastructure
   → Reasoning: OPERATIONAL lifecycle only — CI, build, release, deploy, Docker/Helm/HAProxy, upgrade tooling, runtime-dependency maintenance. Strong fit because it changes how the system is built/shipped/run, not application behavior.

8. "Migrate document ID generation from UUID v4 to v7" / "Add a length limit to Nouveau search index fields"
   → Domain: data-sync (weak fit is fine)
   → Reasoning: In-application code and data-layer/storage-engine internals (ID generation, CouchDB/Nouveau/Lucene index documents, B-tree concerns) are NOT infrastructure even when cross-cutting — keep them in the closest functional domain (here data-sync), not the ops bucket.

9. "Add createReport to the cht-datasource local adapter and export ReportQualifier" / "Create the REST API endpoint and controller for getting people through cht-datasource" / "Convert cht-script-api into the cht-datasource library"
   → Domain: data-access
   → Reasoning: Work that extends the cht-datasource library itself — entity modules, qualifiers, local/remote implementations, and the api controllers/routes that back the remote path — is data-access even when the entity is a contact or report. Code that merely CONSUMES the library (a caller migration, a service reading through it) stays in its own functional domain.
`;

/**
 * Common pitfalls to help the LLM avoid misclassification
 */
export const DOMAIN_PITFALLS = `
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

6. Infrastructure is for OPERATIONAL lifecycle only (CI, build, release, deploy, Docker/Helm/HAProxy, upgrade tooling, runtime-dependency maintenance) — it is NOT a catch-all for cross-cutting code.
   → Don't put CI/build/deploy/upgrade-lifecycle PRs into configuration — those are infrastructure.
   → Don't put in-application code refactors, data-layer/storage-engine internals (UUID/ID generation, CouchDB/Nouveau/Lucene index design docs, B-tree concerns), or library dependency bumps that change app behavior into infrastructure — keep those in the closest functional domain (often data-sync).
   → Exception: work on the cht-datasource library itself (entity modules, qualifiers, local/remote adapters, and the api controllers/routes backing them) is data-access, not data-sync and not the entity's product domain — data-sync keeps only genuine replication and storage-engine internals.
`;

// Derived from the single taxonomy source so it can't drift from CHT_DOMAINS.
const VALID_DOMAINS: readonly CHTDomain[] = CHT_DOMAINS;

const extractJson = (content: string): string => {
  const jsonRegex = /\{[^{}]*(?:\{[^{}]*}[^{}]*)*}/;
  const match = jsonRegex.exec(content);
  if (!match) {
    throw new Error('LLM did not return valid JSON response');
  }
  return match[0];
};

const parseJsonSafe = (jsonStr: string): { domain?: string; components?: string[] } => {
  try {
    return JSON.parse(jsonStr);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`LLM returned malformed JSON. Parse error: ${msg}. Raw: ${jsonStr.substring(0, 200)}...`);
  }
};

const parseLLMResponse = (content: string): { domain: CHTDomain; components: string[] } => {
  const result = parseJsonSafe(extractJson(content));

  if (!result.domain) {
    throw new Error(`LLM response missing required "domain" field. Got: ${JSON.stringify(result)}`);
  }

  if (!VALID_DOMAINS.includes(result.domain as CHTDomain)) {
    throw new Error(`LLM returned invalid domain: "${result.domain}". Must be one of: ${VALID_DOMAINS.join(', ')}`);
  }

  return {
    domain: result.domain as CHTDomain,
    components: Array.isArray(result.components) ? result.components : [],
  };
};

/**
 * Infer domain and components using LLM
 * Supports both API mode (ANTHROPIC_API_KEY) and CLI mode (LLM_PROVIDER=claude-cli)
 */
const inferUsingLLM = async (
  issue: IssueTemplate
): Promise<{ domain: CHTDomain; components: string[] }> => {
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
${DOMAIN_ROSTER}

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
1. The PRIMARY domain (one of the ${CHT_DOMAINS.length} listed above)
2. Likely components that would be affected (be specific but realistic)

Respond in this exact JSON format:
{
  "domain": "domain-name",
  "components": ["component1", "component2"],
  "reasoning": "Brief explanation of why this domain and these components"
}`;

  const response = await llm.invoke(prompt);
  // Providers return string content, but stringify defensively in case one
  // surfaces structured content (preserves the prior ChatAnthropic behavior).
  const rawContent: unknown = response.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

  return parseLLMResponse(content);
};

/**
 * Main function: Infer domain and components for an issue
 */
export const inferDomainAndComponents = async (
  issue: IssueTemplate,
  _modelName?: string // Deprecated: model is now determined by LLM_PROVIDER env var
): Promise<{ domain: CHTDomain; components: string[] }> => {
  // If domain is already specified, keep it
  const hasExistingDomain = issue.issue.technical_context.domain !== undefined;
  const hasExistingComponents = issue.issue.technical_context.components.length > 0;

  if (hasExistingDomain && hasExistingComponents) {
    console.log('[Domain Inference] Using domain and components from ticket');
    return {
      domain: issue.issue.technical_context.domain,
      components: issue.issue.technical_context.components,
    };
  }

  console.log('[Domain Inference] Inferring domain and components...');

  const indices = loadDomainIndices();
  const hasIndices = indices.domainToComponents !== null || indices.componentToDomains !== null;
  console.log(`[Domain Inference] Index-based inference ${hasIndices ? 'available' : 'not available, using LLM'}`);

  // For now, use LLM inference
  const inferred = await inferUsingLLM(issue);

  console.log(`[Domain Inference] Inferred domain: ${inferred.domain}`);
  console.log(`[Domain Inference] Inferred components: ${inferred.components.join(', ')}`);

  return inferred;
};

/**
 * Enrich an issue template with inferred domain/components
 */
export const enrichIssueTemplate = async (
  issue: IssueTemplate,
  modelName?: string
): Promise<IssueTemplate> => {
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
};
