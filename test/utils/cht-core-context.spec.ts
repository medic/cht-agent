/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CHTDomain } from '../../src/types';

const proxyquire = require('proxyquire').noCallThru();

interface FakeIndex {
  last_updated?: string;
  domains: Record<string, FakeMapping>;
}

interface FakeMapping {
  description: string;
  api: { controllers: string[]; services: string[] };
  webapp: { modules: string[]; services: string[] };
  sentinel: { transitions: string[] };
  shared_libs: Array<{ name: string; path: string; critical: boolean }>;
  tests: { unit: string[]; integration: string[]; e2e: string[] };
}

/**
 * Load cht-core-context.ts with `loadIndex` stubbed to return a synthetic index.
 * The production code only calls loadIndex('domain-to-components'), so we can
 * substitute the module-level dependency without touching any other helpers.
 */
const loadModule = (index: FakeIndex | null) => {
  return proxyquire('../../src/utils/cht-core-context', {
    './context-loader': { loadIndex: () => index },
  });
};

const mkMapping = (overrides: Partial<FakeMapping> = {}): FakeMapping => ({
  description: 'test domain',
  api: { controllers: [], services: [] },
  webapp: { modules: [], services: [] },
  sentinel: { transitions: [] },
  shared_libs: [],
  tests: { unit: [], integration: [], e2e: [] },
  ...overrides,
});

describe('cht-core-context (v9a.5)', () => {
  let scratch: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-agent-cht-core-test-'));
    originalEnv = process.env.CHT_CORE_PATH;
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.CHT_CORE_PATH;
    else process.env.CHT_CORE_PATH = originalEnv;
    await fs.rm(scratch, { recursive: true, force: true });
  });

  describe('getCHTCorePath', () => {
    it('returns the CHT_CORE_PATH env value when it points to an existing directory', () => {
      process.env.CHT_CORE_PATH = scratch;
      const { getCHTCorePath } = loadModule({ domains: {} });
      expect(getCHTCorePath()).to.equal(scratch);
    });

    it('falls through to common-locations search when env var points to a non-existent path', () => {
      // Point env at a definitely-missing path; the module then probes common
      // fallback locations (none of which we control). It returns null when
      // none exist on the test host.
      process.env.CHT_CORE_PATH = path.join(scratch, 'does-not-exist');
      const { getCHTCorePath } = loadModule({ domains: {} });
      const result = getCHTCorePath();
      // Either null (no fallback hit) or a real cht-core path on the dev host;
      // both are acceptable shapes. The assertion verifies the function does
      // not return the bogus env value.
      expect(result).to.not.equal(process.env.CHT_CORE_PATH);
    });
  });

  describe('gatherDomainContext', () => {
    it('returns null when cht-core path cannot be resolved', () => {
      delete process.env.CHT_CORE_PATH;
      // The HOME-based common locations may or may not exist on this host;
      // skip this test if any common location actually exists. The function's
      // shape guarantee is the focus here: it returns null when nothing resolves.
      const { gatherDomainContext, getCHTCorePath } = loadModule({ domains: {} });
      if (getCHTCorePath()) return; // host happens to have a real cht-core; can't verify the null branch here
      expect(gatherDomainContext('contacts' as CHTDomain)).to.equal(null);
    });

    it('returns null when the domain is not present in the index', () => {
      process.env.CHT_CORE_PATH = scratch;
      const { gatherDomainContext } = loadModule({ domains: {} });
      expect(gatherDomainContext('contacts' as CHTDomain)).to.equal(null);
    });

    it('reads files listed in the mapping and tags them with the right relevance', () => {
      process.env.CHT_CORE_PATH = scratch;
      // Create a synthetic file the mapping refers to.
      fsSync.writeFileSync(path.join(scratch, 'foo.ts'), 'export const foo = 1;\n', 'utf-8');

      const { gatherDomainContext } = loadModule({
        domains: {
          contacts: mkMapping({
            description: 'Contacts domain',
            webapp: { services: ['foo.ts'], modules: [] },
          }),
        },
      });

      const context = gatherDomainContext('contacts' as CHTDomain);
      expect(context).to.not.equal(null);
      expect(context!.domain).to.equal('contacts');
      expect(context!.description).to.equal('Contacts domain');
      expect(context!.codeSnippets).to.have.length(1);
      expect(context!.codeSnippets[0].filePath).to.equal('foo.ts');
      expect(context!.codeSnippets[0].relevance).to.equal('high');
      expect(context!.codeSnippets[0].language).to.equal('typescript');
      expect(context!.availableFiles).to.deep.equal(['foo.ts']);
      expect(context!.missingFiles).to.deep.equal([]);
    });

    it('records mapping paths that do not resolve as missingFiles', () => {
      process.env.CHT_CORE_PATH = scratch;
      const { gatherDomainContext } = loadModule({
        domains: {
          contacts: mkMapping({
            api: { controllers: ['nowhere/controller.ts'], services: [] },
          }),
        },
      });

      const context = gatherDomainContext('contacts' as CHTDomain);
      expect(context!.missingFiles).to.include('nowhere/controller.ts');
      expect(context!.availableFiles).to.deep.equal([]);
    });

    it('honors the maxSnippets cap', () => {
      process.env.CHT_CORE_PATH = scratch;
      for (let i = 0; i < 5; i++) {
        fsSync.writeFileSync(path.join(scratch, `f${i}.ts`), `// ${i}\n`, 'utf-8');
      }
      const { gatherDomainContext } = loadModule({
        domains: {
          contacts: mkMapping({
            webapp: {
              services: ['f0.ts', 'f1.ts', 'f2.ts', 'f3.ts', 'f4.ts'],
              modules: [],
            },
          }),
        },
      });
      const context = gatherDomainContext('contacts' as CHTDomain, { maxSnippets: 2 });
      expect(context!.codeSnippets).to.have.length(2);
    });

    it('prioritizes paths that match the `prioritize` substrings even at lower relevance', () => {
      process.env.CHT_CORE_PATH = scratch;
      fsSync.writeFileSync(path.join(scratch, 'high-rel.ts'), 'high\n', 'utf-8');
      fsSync.writeFileSync(path.join(scratch, 'priority-marker.ts'), 'priority\n', 'utf-8');
      const { gatherDomainContext } = loadModule({
        domains: {
          contacts: mkMapping({
            webapp: { services: ['high-rel.ts'], modules: [] }, // high relevance
            api: { controllers: ['priority-marker.ts'], services: [] }, // medium relevance
          }),
        },
      });
      const context = gatherDomainContext('contacts' as CHTDomain, { prioritize: ['priority-marker'] });
      // Despite being medium relevance, the matching-priority path lands first.
      expect(context!.codeSnippets[0].filePath).to.equal('priority-marker.ts');
    });
  });

  describe('formatContextForPrompt', () => {
    it('returns the empty string when context has no snippets', () => {
      const { formatContextForPrompt } = loadModule({ domains: {} });
      const empty = {
        domain: 'contacts' as CHTDomain,
        description: '',
        codeSnippets: [],
        availableFiles: [],
        missingFiles: [],
      };
      expect(formatContextForPrompt(empty)).to.equal('');
    });

    it('renders snippets with file path, relevance, language fence, and content', () => {
      const { formatContextForPrompt } = loadModule({ domains: {} });
      const context = {
        domain: 'contacts' as CHTDomain,
        description: 'Contacts domain',
        codeSnippets: [
          {
            filePath: 'webapp/services/contacts.ts',
            content: 'export class ContactsService {}',
            language: 'typescript',
            relevance: 'high' as const,
          },
        ],
        availableFiles: ['webapp/services/contacts.ts'],
        missingFiles: [],
      };
      const out = formatContextForPrompt(context);
      expect(out).to.include('## CHT Core Code Context (contacts)');
      expect(out).to.include('Domain: Contacts domain');
      expect(out).to.include('#### webapp/services/contacts.ts (high relevance)');
      expect(out).to.include('```typescript');
      expect(out).to.include('export class ContactsService {}');
    });

    it('lists missing files when present', () => {
      const { formatContextForPrompt } = loadModule({ domains: {} });
      const context = {
        domain: 'contacts' as CHTDomain,
        description: '',
        codeSnippets: [{ filePath: 'a.ts', content: 'x', language: 'typescript', relevance: 'high' as const }],
        availableFiles: ['a.ts'],
        missingFiles: ['nowhere/x.ts', 'nowhere/y.ts'],
      };
      const out = formatContextForPrompt(context);
      expect(out).to.include('### Files not found');
      expect(out).to.include('- nowhere/x.ts');
      expect(out).to.include('- nowhere/y.ts');
    });
  });

  describe('getDomainComponentSummary', () => {
    it('returns null when the domain is missing from the index', () => {
      const { getDomainComponentSummary } = loadModule({ domains: {} });
      expect(getDomainComponentSummary('contacts' as CHTDomain)).to.equal(null);
    });

    it('returns null when no index is loaded at all', () => {
      const { getDomainComponentSummary } = loadModule(null);
      expect(getDomainComponentSummary('contacts' as CHTDomain)).to.equal(null);
    });

    it('renders each populated section with the configured component list', () => {
      const { getDomainComponentSummary } = loadModule({
        domains: {
          contacts: mkMapping({
            description: 'Contacts mgmt',
            webapp: {
              services: ['webapp/services/contacts.ts'],
              modules: ['webapp/modules/contacts'],
            },
            api: { controllers: ['api/controllers/contacts.js'], services: [] },
            sentinel: { transitions: ['sentinel/muting'] },
            shared_libs: [
              { name: 'cht-datasource', path: 'shared-libs/cht-datasource', critical: true },
              { name: 'cht-form-validator', path: 'shared-libs/cht-form-validator', critical: false },
            ],
          }),
        },
      });

      const out = getDomainComponentSummary('contacts' as CHTDomain);
      expect(out).to.include('## contacts Domain Components');
      expect(out).to.include('**Description:** Contacts mgmt');
      expect(out).to.include('**Webapp Services:**');
      expect(out).to.include('- webapp/services/contacts.ts');
      expect(out).to.include('**Webapp Modules:**');
      expect(out).to.include('- webapp/modules/contacts');
      expect(out).to.include('**API Controllers:**');
      expect(out).to.include('- api/controllers/contacts.js');
      expect(out).to.include('**Sentinel Transitions:**');
      expect(out).to.include('- sentinel/muting');
      expect(out).to.include('**Shared Libraries:**');
      expect(out).to.include('- cht-datasource (critical)');
      expect(out).to.include('- cht-form-validator (optional)');
    });

    it('omits empty sections so the prompt stays focused', () => {
      const { getDomainComponentSummary } = loadModule({
        domains: {
          contacts: mkMapping({
            description: 'sparse domain',
            // Only webapp services is populated.
            webapp: { services: ['x.ts'], modules: [] },
          }),
        },
      });
      const out = getDomainComponentSummary('contacts' as CHTDomain);
      expect(out).to.include('**Webapp Services:**');
      expect(out).to.not.include('**Webapp Modules:**');
      expect(out).to.not.include('**API Controllers:**');
      expect(out).to.not.include('**Sentinel Transitions:**');
      expect(out).to.not.include('**Shared Libraries:**');
    });
  });
});
