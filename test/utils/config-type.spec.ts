import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { classifyConfigType, guardConfigFix } from '../../src/utils/config-type';

describe('config-type boundary', () => {
  describe('classifyConfigType', () => {
    it('marks form + contact-form as fixable from a deployment', () => {
      expect(classifyConfigType('form').fixability).to.equal('fixable-from-deployment');
      expect(classifyConfigType('contact-form').fixability).to.equal('fixable-from-deployment');
    });

    it('marks JSON-shaped config (app-settings, purge, translations, resources) as fixable', () => {
      for (const artifact of ['app-settings', 'messaging', 'purge', 'translations', 'resources'] as const) {
        expect(classifyConfigType(artifact).fixability, artifact).to.equal('fixable-from-deployment');
      }
    });

    it('marks task + contact-summary as needing a source repo', () => {
      const task = classifyConfigType('task');
      expect(task.fixability).to.equal('needs-source-repo');
      expect(task.requiredSource).to.deep.equal(['tasks.js']);

      const cs = classifyConfigType('contact-summary');
      expect(cs.fixability).to.equal('needs-source-repo');
      expect(cs.requiredSource).to.include('contact-summary.templated.js');
    });

    it('treats a target DEFINITION change as fixable but target EMISSION LOGIC as needing source', () => {
      // No mechanism / a definition-style change: readable JSON in tasks.targets.items[]
      expect(classifyConfigType('target').fixability).to.equal('fixable-from-deployment');
      expect(classifyConfigType('target', 'schedule').fixability).to.equal('fixable-from-deployment');
      // Emission-logic mechanisms are minified into app_settings.tasks.rules
      expect(classifyConfigType('target', 'appliesIf').fixability).to.equal('needs-source-repo');
      expect(classifyConfigType('target', 'calculation').requiredSource).to.deep.equal(['targets.js']);
    });
  });

  describe('guardConfigFix', () => {
    it('lets a fixable-from-deployment artifact proceed', () => {
      const result = guardConfigFix({ artifact: 'form', configRoot: '/does/not/matter' });
      expect(result.ok).to.equal(true);
      expect(result.fixability).to.equal('fixable-from-deployment');
    });

    it('blocks a task fix with a qualified message when no source is mounted', () => {
      const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'no-source-'));
      try {
        const result = guardConfigFix({ artifact: 'task', configRoot: emptyRoot });
        expect(result.ok).to.equal(false);
        expect(result.sourcePresent).to.equal(false);
        expect(result.message).to.include('tasks.js');
        expect(result.message).to.include('reconstruct-rules'); // qualified, not an unconditional refusal
      } finally {
        fs.rmSync(emptyRoot, { recursive: true, force: true });
      }
    });

    it('lets a task fix proceed when tasks.js is mounted at CHT_CONF_PATH', () => {
      const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'with-source-'));
      try {
        fs.writeFileSync(path.join(sourceRoot, 'tasks.js'), 'module.exports = [];\n');
        const result = guardConfigFix({ artifact: 'task', configRoot: sourceRoot });
        expect(result.ok).to.equal(true);
        expect(result.sourcePresent).to.equal(true);
      } finally {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
      }
    });

    it('lets a contact-summary fix proceed when the templated source is mounted', () => {
      const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'with-cs-'));
      try {
        fs.writeFileSync(path.join(sourceRoot, 'contact-summary.templated.js'), 'module.exports = {};\n');
        const result = guardConfigFix({ artifact: 'contact-summary', configRoot: sourceRoot });
        expect(result.ok).to.equal(true);
      } finally {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
      }
    });
  });
});
