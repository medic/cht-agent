/**
 * Research Results Saver
 *
 * Saves research results to disk for review and debugging
 */

import * as fs from 'fs';
import * as path from 'path';
import { ResearchState } from '../types';

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'outputs', 'context-results');

/**
 * Ensure the output directory exists
 */
export function ensureOutputDirExists(outputDir: string = DEFAULT_OUTPUT_DIR): void {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Save research results to a JSON file
 */
export function saveResearchResults(state: ResearchState, outputDir: string = DEFAULT_OUTPUT_DIR): string {
  ensureOutputDirExists(outputDir);

  const domain = state.issue?.issue.technical_context.domain || 'unknown';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${domain}-${timestamp}.json`;
  const filePath = path.join(outputDir, filename);

  const output = {
    timestamp: new Date().toISOString(),
    domain,
    phase: state.currentPhase,
    errors: state.errors,
    researchFindings: state.researchFindings || null,
    codeContextFindings: state.codeContextFindings || null,
    contextAnalysis: state.contextAnalysis || null,
    orchestrationPlan: state.orchestrationPlan || null,
  };

  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');

  return filePath;
}
