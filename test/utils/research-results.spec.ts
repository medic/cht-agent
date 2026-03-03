import { expect } from 'chai';
import * as sinon from 'sinon';
import { ResearchState } from '../../src/types';

// Use require for proxyquire to avoid ESM conflicts
const proxyquire = require('proxyquire').noCallThru();

describe('research-results', () => {
  let mkdirSyncStub: sinon.SinonStub;
  let writeFileSyncStub: sinon.SinonStub;
  let outputSaver: any;

  beforeEach(() => {
    mkdirSyncStub = sinon.stub();
    writeFileSyncStub = sinon.stub();
    outputSaver = proxyquire('../../src/utils/research-results', {
      fs: {
        mkdirSync: mkdirSyncStub,
        writeFileSync: writeFileSyncStub,
      },
    });
  });

  describe('ensureOutputDirExists', () => {
    it('should create the output directory recursively', () => {
      outputSaver.ensureOutputDirExists();

      expect(mkdirSyncStub.calledOnce).to.be.true;
      const [dirPath, options] = mkdirSyncStub.firstCall.args;
      expect(dirPath).to.include('outputs');
      expect(dirPath).to.include('context-results');
      expect(options).to.deep.equal({ recursive: true });
    });
  });

  describe('saveResearchResults', () => {
    it('should write results to a JSON file', () => {
      const state: ResearchState = {
        messages: [],
        issue: {
          issue: {
            title: 'Test',
            type: 'feature',
            priority: 'medium',
            description: 'Test',
            technical_context: { domain: 'contacts', components: [] },
            requirements: [],
            acceptance_criteria: [],
            constraints: [],
          },
        },
        currentPhase: 'complete',
        errors: [],
      };

      const filePath = outputSaver.saveResearchResults(state);

      expect(mkdirSyncStub.calledOnce).to.be.true;
      expect(writeFileSyncStub.calledOnce).to.be.true;

      const [writtenPath, content, encoding] = writeFileSyncStub.firstCall.args;
      expect(writtenPath).to.include('contacts-');
      expect(writtenPath).to.include('.json');
      expect(encoding).to.equal('utf-8');

      const parsed = JSON.parse(content);
      expect(parsed.domain).to.equal('contacts');
      expect(parsed.phase).to.equal('complete');
      expect(filePath).to.equal(writtenPath);
    });

    it('should use "unknown" domain when issue is not provided', () => {
      const state: ResearchState = {
        messages: [],
        currentPhase: 'error',
        errors: ['something failed'],
      };

      outputSaver.saveResearchResults(state);

      const [writtenPath] = writeFileSyncStub.firstCall.args;
      expect(writtenPath).to.include('unknown-');
    });

    it('should include all result sections in output', () => {
      const state: ResearchState = {
        messages: [],
        issue: {
          issue: {
            title: 'Test',
            type: 'feature',
            priority: 'medium',
            description: 'Test',
            technical_context: { domain: 'contacts', components: [] },
            requirements: [],
            acceptance_criteria: [],
            constraints: [],
          },
        },
        researchFindings: {
          documentationReferences: [],
          relevantExamples: [],
          suggestedApproaches: [],
          relatedDomains: [],
          confidence: 0.8,
          source: 'cached',
        },
        codeContextFindings: {
          architectureInsights: [],
          moduleRelationships: [],
          diagrams: [],
          relevantRepos: ['cht-core'],
          warnings: [],
          confidence: 0.8,
          source: 'mock',
        },
        currentPhase: 'complete',
        errors: [],
      };

      outputSaver.saveResearchResults(state);

      const [, content] = writeFileSyncStub.firstCall.args;
      const parsed = JSON.parse(content);
      expect(parsed.researchFindings).to.not.be.null;
      expect(parsed.codeContextFindings).to.not.be.null;
    });
  });
});
