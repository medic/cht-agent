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
import { ChatAnthropic } from '@langchain/anthropic';
import { CHTDomain, IssueTemplate } from '../types';

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
 * Infer domain and components using Claude LLM
 */
async function inferUsingLLM(
  issue: IssueTemplate,
  modelName: string = 'claude-sonnet-4-20250514'
): Promise<{ domain: CHTDomain; components: string[] }> {
  const model = new ChatAnthropic({
    modelName,
    temperature: 0.2 // Low temperature for consistent categorization
  });

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

Issue to analyze:
Title: ${issue.issue.title}
Type: ${issue.issue.type}
Priority: ${issue.issue.priority}

Description:
${issue.issue.description}

Requirements:
${issue.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Constraints:
${issue.issue.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Based on this issue, identify:
1. The PRIMARY domain (one of the 7 listed above)
2. Likely components that would be affected (be specific but realistic)

Respond in this exact JSON format:
{
  "domain": "domain-name",
  "components": ["component1", "component2"],
  "reasoning": "Brief explanation of why this domain and these components"
}`;

  const response = await model.invoke(prompt);
  const content = response.content.toString();

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('LLM did not return valid JSON response');
  }

  const result = JSON.parse(jsonMatch[0]);

  return {
    domain: result.domain as CHTDomain,
    components: result.components || []
  };
}

/**
 * Main function: Infer domain and components for an issue
 */
export async function inferDomainAndComponents(
  issue: IssueTemplate,
  modelName?: string
): Promise<{ domain: CHTDomain; components: string[] }> {
  // If domain is already specified, keep it
  const hasExistingDomain = issue.issue.technical_context.domain !== undefined;
  const hasExistingComponents = issue.issue.technical_context.components.length > 0;

  if (hasExistingDomain && hasExistingComponents) {
    console.log('[Domain Inference] Using domain and components from ticket');
    return {
      domain: issue.issue.technical_context.domain!,
      components: issue.issue.technical_context.components
    };
  }

  console.log('[Domain Inference] Inferring domain and components...');

  // Try to use indices first (when implemented)
  // const indices = loadDomainIndices();
  // TODO: Implement index-based inference when indices are populated

  // For now, use LLM inference
  const inferred = await inferUsingLLM(issue, modelName);

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
        components: components.length > 0 ? components : issue.issue.technical_context.components
      }
    }
  };
}
