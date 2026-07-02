import { expect } from 'chai';
import {
  parseFrontmatter,
  loadDomainOverview,
  loadDomainComponents,
  findResolvedIssuesByDomain,
  getRelatedDomains,
  ensureAgentMemoryExists,
} from '../../src/utils/context-loader';

// Use require for proxyquire to avoid ESM conflicts
const proxyquire = require('proxyquire').noCallThru();

describe('context-loader', () => {
  describe('parseFrontmatter', () => {
    it('should parse valid YAML frontmatter', () => {
      const content = `---
domain: contacts
last_updated: 2024-01-15
related_domains: [forms-and-reports, tasks-and-targets]
---

# Domain Overview

This is the body content.`;

      const result = parseFrontmatter(content);

      expect(result.metadata.domain).to.equal('contacts');
      expect(result.metadata.last_updated).to.equal('2024-01-15');
      expect(result.metadata.related_domains).to.deep.equal([
        'forms-and-reports',
        'tasks-and-targets',
      ]);
      expect(result.body).to.include('# Domain Overview');
      expect(result.body).to.include('This is the body content.');
    });

    it('should handle content without frontmatter', () => {
      const content = `# Just a regular markdown file

No frontmatter here.`;

      const result = parseFrontmatter(content);

      expect(result.metadata).to.deep.equal({});
      expect(result.body).to.equal(content);
    });

    it('should return original content when frontmatter is empty or malformed', () => {
      const content = `---
---

Body content only.`;

      const result = parseFrontmatter(content);

      expect(result.body).to.include('Body content only.');
    });

    it('should parse frontmatter with quoted values', () => {
      const content = `---
title: "My Title"
description: 'Single quoted'
---

Body`;

      const result = parseFrontmatter(content);

      expect(result.metadata.title).to.equal('My Title');
      expect(result.metadata.description).to.equal('Single quoted');
    });

    it('should handle arrays in frontmatter', () => {
      const content = `---
tags: [tag1, tag2, tag3]
---

Body`;

      const result = parseFrontmatter(content);

      expect(result.metadata.tags).to.deep.equal(['tag1', 'tag2', 'tag3']);
    });

    it('should handle nested objects in frontmatter', () => {
      const content = `---
config:
  key1: value1
  key2: value2
---

Body`;

      const result = parseFrontmatter(content);

      expect(result.metadata.config).to.deep.equal({ key1: 'value1', key2: 'value2' });
    });

    it('should handle numeric values', () => {
      const content = `---
count: 42
score: 3.14
---

Body`;

      const result = parseFrontmatter(content);

      expect(result.metadata.count).to.equal(42);
      expect(result.metadata.score).to.equal(3.14);
    });

    it('should handle boolean values', () => {
      const content = `---
enabled: true
disabled: false
---

Body`;

      const result = parseFrontmatter(content);

      expect(result.metadata.enabled).to.equal(true);
      expect(result.metadata.disabled).to.equal(false);
    });
  });

  describe('loadDomainOverview', () => {
    it('should return null when domain overview file does not exist', () => {
      const result = loadDomainOverview('authentication');
      if (result !== null) {
        expect(result).to.have.property('metadata');
        expect(result).to.have.property('content');
      }
    });
  });

  describe('loadDomainComponents', () => {
    it('should handle domain components lookup', () => {
      const result = loadDomainComponents('authentication');
      if (result !== null) {
        expect(result).to.have.property('domain');
        expect(result).to.have.property('components');
      }
    });
  });

  describe('findResolvedIssuesByDomain', () => {
    it('should return array for domain resolved issues lookup', () => {
      const result = findResolvedIssuesByDomain('authentication');
      expect(result).to.be.an('array');
    });
  });

  describe('getRelatedDomains', () => {
    it('should return array for related domains lookup', () => {
      const result = getRelatedDomains('authentication');
      expect(result).to.be.an('array');
    });
  });

  describe('ensureAgentMemoryExists', () => {
    it('should not throw when called', () => {
      expect(() => ensureAgentMemoryExists()).to.not.throw();
    });
  });

  // Tests using proxyquire to mock fs module
  describe('with mocked fs (proxyquire)', () => {
    describe('loadDomainOverview', () => {
      it('should return null when file does not exist', () => {
        const mockFs = {
          existsSync: () => false,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadDomainOverview('contacts');
        expect(result).to.be.null;
      });

      it('should return parsed overview when file exists', () => {
        const mockContent = `---
domain: contacts
last_updated: 2024-01-15
related_domains: [forms-and-reports]
---

# Contacts Domain

Overview content here.`;

        const mockFs = {
          existsSync: () => true,
          readFileSync: () => mockContent,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadDomainOverview('contacts');

        expect(result).to.not.be.null;
        expect(result.metadata.domain).to.equal('contacts');
        expect(result.content).to.include('Contacts Domain');
      });
    });

    describe('loadDomainComponents', () => {
      it('should return null when file does not exist', () => {
        const mockFs = {
          existsSync: () => false,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadDomainComponents('contacts');
        expect(result).to.be.null;
      });

      it('should return parsed components when file exists', () => {
        const mockComponents = {
          domain: 'contacts',
          components: {
            api: ['contacts-controller'],
            webapp: ['contacts-module'],
          },
        };

        const mockFs = {
          existsSync: () => true,
          readFileSync: () => JSON.stringify(mockComponents),
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadDomainComponents('contacts');

        expect(result).to.not.be.null;
        expect(result.domain).to.equal('contacts');
        expect(result.components.api).to.include('contacts-controller');
      });
    });

    describe('loadWorkflowComponents', () => {
      it('should return null when file does not exist', () => {
        const mockFs = {
          existsSync: () => false,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadWorkflowComponents('contact-creation');
        expect(result).to.be.null;
      });

      it('should return parsed workflow components when file exists', () => {
        const mockWorkflow = {
          workflow: 'contact-creation',
          primary_domains: ['contacts'],
          components: { api: ['contacts-controller'] },
        };

        const mockFs = {
          existsSync: () => true,
          readFileSync: () => JSON.stringify(mockWorkflow),
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadWorkflowComponents('contact-creation');

        expect(result).to.not.be.null;
        expect(result.workflow).to.equal('contact-creation');
      });
    });

    describe('loadWorkflowFlow', () => {
      it('should return null when file does not exist', () => {
        const mockFs = {
          existsSync: () => false,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadWorkflowFlow('contact-creation');
        expect(result).to.be.null;
      });

      it('should return parsed workflow flow when file exists', () => {
        const mockContent = `---
workflow: contact-creation
version: 1.0
---

# Contact Creation Flow

Step-by-step workflow.`;

        const mockFs = {
          existsSync: () => true,
          readFileSync: () => mockContent,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadWorkflowFlow('contact-creation');

        expect(result).to.not.be.null;
        expect(result.metadata.workflow).to.equal('contact-creation');
        expect(result.content).to.include('Contact Creation Flow');
      });
    });

    describe('loadIndex', () => {
      it('should return null when index file does not exist', () => {
        const mockFs = {
          existsSync: () => false,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadIndex('domain-to-components');
        expect(result).to.be.null;
      });

      it('should return parsed index when file exists', () => {
        const mockIndex = {
          contacts: ['api/contacts', 'webapp/contacts'],
          authentication: ['api/auth'],
        };

        const mockFs = {
          existsSync: () => true,
          readFileSync: () => JSON.stringify(mockIndex),
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.loadIndex('domain-to-components');

        expect(result).to.not.be.null;
        expect(result.contacts).to.deep.equal(['api/contacts', 'webapp/contacts']);
      });
    });

    describe('findResolvedIssuesByDomain', () => {
      it('should return empty array when domain directory does not exist', () => {
        const mockFs = {
          existsSync: () => false,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.findResolvedIssuesByDomain('contacts');
        expect(result).to.deep.equal([]);
      });

      it('should map pipeline-draft frontmatter onto ResolvedIssueContext', () => {
        const draft = `---
id: cht-core-9601
category: feature
domain: contacts
issueNumber: 9601
summary: Prevent duplicate sibling contact creation.
services:
  - webapp
  - api
techStack:
  - typescript
source_pr: medic/cht-core#9650
tags:
  - deduplication
  - contacts
---

Issue content.`;

        const mockFs = {
          existsSync: () => true,
          readdirSync: () => [{ name: '9601-prevent-dupes.md', isDirectory: () => false }],
          readFileSync: () => draft,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.findResolvedIssuesByDomain('contacts');

        expect(result).to.have.lengthOf(1);
        const issue = result[0];
        expect(issue.id).to.equal('cht-core-9601');
        expect(issue.issue_number).to.equal(9601);
        expect(issue.phase).to.equal('completed');
        expect(issue.task_id).to.equal('medic/cht-core#9650');
        expect(issue.domains).to.deep.equal(['contacts']);
        // services map into components; tags fold into shared_libs for overlap signal
        expect(issue.components.api).to.deep.equal(['api']);
        expect(issue.components.webapp).to.deep.equal(['webapp']);
        expect(issue.components.sentinel).to.deep.equal([]);
        expect(issue.components.shared_libs).to.include('deduplication');
        expect(issue.tags).to.deep.equal(['deduplication', 'contacts']);
        // layer defaults to cht-core; no config fields for a core entry
        expect(issue.layer).to.equal('cht-core');
        expect(issue.configArtifact).to.be.undefined;
        expect(issue.mechanism).to.be.undefined;
      });

      it('should map cht-conf config fields when present', () => {
        const draft = `---
id: cht-conf-pnc-001
category: bug
domain: forms-and-reports
issueNumber: 1
layer: cht-conf
configArtifact: form
mechanism: relevant
summary: PNC follow-up prompts after miscarriage.
---

Config content.`;

        const mockFs = {
          existsSync: () => true,
          readdirSync: () => [{ name: 'pnc.md', isDirectory: () => false }],
          readFileSync: () => draft,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.findResolvedIssuesByDomain('forms-and-reports');

        expect(result).to.have.lengthOf(1);
        expect(result[0].layer).to.equal('cht-conf');
        expect(result[0].configArtifact).to.equal('form');
        expect(result[0].mechanism).to.equal('relevant');
      });

      it('should ignore unrecognized enum values for config fields', () => {
        const draft = `---
id: cht-conf-bad
domain: forms-and-reports
issueNumber: 2
layer: not-a-layer
configArtifact: not-an-artifact
---

Content.`;

        const mockFs = {
          existsSync: () => true,
          readdirSync: () => [{ name: 'bad.md', isDirectory: () => false }],
          readFileSync: () => draft,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.findResolvedIssuesByDomain('forms-and-reports');

        expect(result).to.have.lengthOf(1);
        // invalid layer falls back to the cht-core default; invalid artifact drops out
        expect(result[0].layer).to.equal('cht-core');
        expect(result[0].configArtifact).to.be.undefined;
      });

      it('should skip files with neither domain nor issueNumber', () => {
        const draft = `---
title: not a real draft
---

Content.`;

        const mockFs = {
          existsSync: () => true,
          readdirSync: () => [{ name: 'stray.md', isDirectory: () => false }],
          readFileSync: () => draft,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.findResolvedIssuesByDomain('contacts');
        expect(result).to.deep.equal([]);
      });

      it('should recursively scan subdirectories', () => {
        const issue1 = `---
id: issue-001
domain: contacts
issueNumber: 1
---
Content.`;

        const issue2 = `---
id: issue-002
domain: contacts
issueNumber: 2
---
Content.`;

        let readdirCallCount = 0;
        let readFileCallCount = 0;

        const mockFs = {
          existsSync: () => true,
          readdirSync: () => {
            readdirCallCount++;
            if (readdirCallCount === 1) {
              return [
                { name: 'subdir', isDirectory: () => true },
                { name: 'issue-001.md', isDirectory: () => false },
              ];
            }
            return [{ name: 'issue-002.md', isDirectory: () => false }];
          },
          readFileSync: () => {
            readFileCallCount++;
            return readFileCallCount === 1 ? issue1 : issue2;
          },
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.findResolvedIssuesByDomain('contacts');

        expect(result).to.have.lengthOf(2);
        expect(result.map((r: any) => r.id)).to.include('issue-001');
        expect(result.map((r: any) => r.id)).to.include('issue-002');
      });

      it('should skip non-markdown files', () => {
        const mockFs = {
          existsSync: () => true,
          readdirSync: () => [
            { name: 'readme.txt', isDirectory: () => false },
            { name: 'data.json', isDirectory: () => false },
          ],
          readFileSync: () => '',
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.findResolvedIssuesByDomain('contacts');
        expect(result).to.deep.equal([]);
      });
    });

    describe('getRelatedDomains', () => {
      it('should return empty array when domain overview does not exist', () => {
        const mockFs = {
          existsSync: () => false,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.getRelatedDomains('contacts');
        expect(result).to.deep.equal([]);
      });

      it('should return empty array when no related_domains in metadata', () => {
        const mockContent = `---
domain: contacts
---

Domain overview.`;

        const mockFs = {
          existsSync: () => true,
          readFileSync: () => mockContent,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.getRelatedDomains('contacts');
        expect(result).to.deep.equal([]);
      });

      it('should return related domains from overview metadata', () => {
        const mockContent = `---
domain: contacts
related_domains: [forms-and-reports, tasks-and-targets]
---

Domain overview.`;

        const mockFs = {
          existsSync: () => true,
          readFileSync: () => mockContent,
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        const result = contextLoader.getRelatedDomains('contacts');
        expect(result).to.deep.equal(['forms-and-reports', 'tasks-and-targets']);
      });
    });

    describe('ensureAgentMemoryExists', () => {
      it('should create directories that do not exist', () => {
        const createdDirs: string[] = [];

        const mockFs = {
          existsSync: () => false,
          mkdirSync: (dirPath: string) => {
            createdDirs.push(dirPath);
          },
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        contextLoader.ensureAgentMemoryExists();

        expect(createdDirs.length).to.be.greaterThan(0);
        expect(createdDirs.some((d) => d.includes('domains'))).to.be.true;
        expect(createdDirs.some((d) => d.includes('workflows'))).to.be.true;
        expect(createdDirs.some((d) => d.includes('indices'))).to.be.true;
      });

      it('should not create directories that already exist', () => {
        const createdDirs: string[] = [];

        const mockFs = {
          existsSync: () => true,
          mkdirSync: (dirPath: string) => {
            createdDirs.push(dirPath);
          },
        };

        const contextLoader = proxyquire('../../src/utils/context-loader', {
          'node:fs': mockFs,
        });

        contextLoader.ensureAgentMemoryExists();

        expect(createdDirs).to.have.lengthOf(0);
      });
    });
  });
});
