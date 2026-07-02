/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import { IssueTemplate, CHTDomain } from '../../src/types';
import { DOMAIN_EXAMPLES, DOMAIN_PITFALLS } from '../../src/utils/domain-inference';
import type { InvokeOptions } from '../../src/llm/types';

const proxyquire = require('proxyquire').noCallThru();

// Shared, file-scope helpers so the mocked-LLM, CLI-provider, and explicit-API
// describes all use one issue factory and one rejection asserter.
const makeIssue = (over: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
  issue: {
    title: 'T', type: 'feature', priority: 'medium', description: 'd',
    technical_context: { domain: undefined as unknown as CHTDomain, components: [] },
    requirements: ['r'], acceptance_criteria: ['a'], constraints: ['c'],
    ...over,
  },
});

const expectReject = async (p: Promise<unknown>, re: RegExp): Promise<void> => {
  try {
    await p;
  } catch (e) {
    expect((e as Error).message).to.match(re);
    return;
  }
  throw new Error('expected promise to reject');
};

interface RecordedCall {
  prompt: string;
  options?: InvokeOptions;
}

describe('domain-inference', () => {
  // Helper to create test issue template
  const createTestIssue = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
    issue: {
      title: 'Test Issue',
      type: 'feature',
      priority: 'medium',
      description: 'Test description',
      technical_context: {
        domain: undefined as unknown as CHTDomain,
        components: [],
      },
      requirements: ['Req 1'],
      acceptance_criteria: ['Criterion 1'],
      constraints: ['Constraint 1'],
      ...overrides,
    },
  });

  describe('IssueTemplate structure', () => {
    it('should create valid issue template with domain', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: ['api/contacts-controller'],
        },
      });

      expect(issue.issue.technical_context.domain).to.equal('contacts');
      expect(issue.issue.technical_context.components).to.deep.equal(['api/contacts-controller']);
    });

    it('should handle all valid CHT domains', () => {
      const validDomains: CHTDomain[] = [
        'authentication',
        'contacts',
        'forms-and-reports',
        'tasks-and-targets',
        'messaging',
        'data-sync',
        'configuration',
        'interoperability',
      ];

      for (const domain of validDomains) {
        const issue = createTestIssue({
          technical_context: { domain, components: [] },
        });

        expect(issue.issue.technical_context.domain).to.equal(domain);
      }
    });

    it('should include requirements in issue template', () => {
      const issue = createTestIssue({
        requirements: ['First requirement', 'Second requirement'],
      });

      expect(issue.issue.requirements).to.have.lengthOf(2);
      expect(issue.issue.requirements).to.include('First requirement');
    });

    it('should include constraints in issue template', () => {
      const issue = createTestIssue({
        constraints: ['Must work offline', 'Must be fast'],
      });

      expect(issue.issue.constraints).to.have.lengthOf(2);
      expect(issue.issue.constraints).to.include('Must work offline');
    });

    it('should include reference data in issue template', () => {
      const issue = createTestIssue({
        reference_data: {
          similar_implementations: ['https://github.com/medic/cht-core/pull/123'],
          documentation: ['https://docs.communityhealthtoolkit.org/'],
        },
      });

      expect(issue.issue.reference_data?.similar_implementations).to.have.lengthOf(1);
      expect(issue.issue.reference_data?.documentation).to.have.lengthOf(1);
    });

    it('should include existing references in technical context', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: [],
          existing_references: ['api/contacts/controller.js', 'webapp/modules/contacts'],
        },
      });

      expect(issue.issue.technical_context.existing_references).to.have.lengthOf(2);
    });
  });

  describe('infrastructure domain scoping guidance', () => {
    it('scopes infrastructure to operational lifecycle, excluding data-layer internals', () => {
      // Pitfall must steer storage-engine internals AWAY from infrastructure so
      // PRs like UUID v4→v7 (10935) and Nouveau index limits don't over-capture.
      expect(DOMAIN_PITFALLS).to.match(/operational lifecycle/i);
      expect(DOMAIN_PITFALLS).to.match(/storage-engine internals/i);
      expect(DOMAIN_PITFALLS).to.match(/not.*infrastructure|into infrastructure/i);
    });

    it('gives a data-layer counter-example that stays in data-sync, not infrastructure', () => {
      expect(DOMAIN_EXAMPLES).to.match(/UUID v4 to v7|Nouveau/i);
      expect(DOMAIN_EXAMPLES).to.match(/data-sync/);
    });
  });
});

describe('domain-inference (mocked LLM)', () => {
  // This suite is the default (API-key) path no-regression suite. It exercises the
  // REAL isUsingCLIProvider (only '@langchain/anthropic'/'node:fs' are stubbed), so
  // LLM_PROVIDER must be unset — an ambient claude-cli would reroute these to the CLI
  // chain and the ChatAnthropic stub below would never run.
  let savedProvider: string | undefined;
  beforeEach(() => {
    savedProvider = process.env.LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
  });
  afterEach(() => {
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = savedProvider;
  });

  // Replace ChatAnthropic with a stub whose invoke returns canned
  // content, so the inference logic is gated without a live API call.
  const loadInference = (
    invokeImpl: () => Promise<{ content: unknown }>,
    fsStub?: Record<string, unknown>,
  ) => {
    const invokeStub = sinon.stub().callsFake(invokeImpl);
    const FakeChatAnthropic = function FakeChatAnthropic(this: object) {
      return Object.assign(this, { invoke: invokeStub });
    } as unknown as { new (args: Record<string, unknown>): { invoke: typeof invokeStub } };
    const stubs: Record<string, unknown> = {
      '@langchain/anthropic': { ChatAnthropic: FakeChatAnthropic },
    };
    if (fsStub) stubs['node:fs'] = fsStub;
    return { mod: proxyquire('../../src/utils/domain-inference', stubs), invokeStub };
  };

  it('returns ticket domain/components without calling the LLM when both are present', async () => {
    const { mod, invokeStub } = loadInference(async () => ({ content: '{}' }));
    const res = await mod.inferDomainAndComponents(
      makeIssue({ technical_context: { domain: 'contacts', components: ['api/x'] } }),
    );
    expect(res).to.deep.equal({ domain: 'contacts', components: ['api/x'] });
    expect(invokeStub.called).to.equal(false);
  });

  it('falls through to the LLM when a domain is set but components are empty', async () => {
    const { mod, invokeStub } = loadInference(async () => ({ content: '{"domain":"contacts","components":["c"]}' }));
    await mod.inferDomainAndComponents(makeIssue({ technical_context: { domain: 'contacts', components: [] } }));
    expect(invokeStub.called).to.equal(true);
  });

  it('infers domain/components from the LLM JSON, with the roster derived from CHT_DOMAINS', async () => {
    const { mod, invokeStub } = loadInference(async () => ({
      content: '{"domain":"messaging","components":["api/sms"],"reasoning":"x"}',
    }));
    const res = await mod.inferDomainAndComponents(makeIssue());
    expect(res.domain).to.equal('messaging');
    expect(res.components).to.deep.equal(['api/sms']);
    expect(invokeStub.firstCall.args[0]).to.include('infrastructure -'); // 9th domain present
  });

  it('stringifies non-string message content before parsing', async () => {
    const { mod } = loadInference(async () => ({ content: { domain: 'contacts' } }));
    const res = await mod.inferDomainAndComponents(makeIssue());
    expect(res.domain).to.equal('contacts');
    expect(res.components).to.deep.equal([]); // components missing -> []
  });

  it('enrichIssueTemplate merges the inferred domain into technical_context', async () => {
    const { mod } = loadInference(async () => ({ content: '{"domain":"data-sync","components":["shared-libs/sync"]}' }));
    const enriched = await mod.enrichIssueTemplate(makeIssue());
    expect(enriched.issue.technical_context.domain).to.equal('data-sync');
    expect(enriched.issue.technical_context.components).to.deep.equal(['shared-libs/sync']);
  });

  it('throws when the LLM returns no JSON object', async () => {
    const { mod } = loadInference(async () => ({ content: 'no json here' }));
    await expectReject(mod.inferDomainAndComponents(makeIssue()), /did not return valid JSON/);
  });

  it('throws on malformed JSON', async () => {
    const { mod } = loadInference(async () => ({ content: '{"domain": }' }));
    await expectReject(mod.inferDomainAndComponents(makeIssue()), /malformed JSON/);
  });

  it('throws when the domain field is missing', async () => {
    const { mod } = loadInference(async () => ({ content: '{"components":[]}' }));
    await expectReject(mod.inferDomainAndComponents(makeIssue()), /missing required "domain"/);
  });

  it('throws when the domain is not a valid CHTDomain', async () => {
    const { mod } = loadInference(async () => ({ content: '{"domain":"nope"}' }));
    await expectReject(mod.inferDomainAndComponents(makeIssue()), /invalid domain/);
  });

  it('uses index files when present (loadDomainIndices happy path)', async () => {
    const fsStub = { existsSync: () => true, readFileSync: () => JSON.stringify({ contacts: ['api/x'] }) };
    const { mod } = loadInference(async () => ({ content: '{"domain":"contacts","components":[]}' }), fsStub);
    expect((await mod.inferDomainAndComponents(makeIssue())).domain).to.equal('contacts');
  });

  it('tolerates unreadable index files (loadJsonIndex catch)', async () => {
    const fsStub = { existsSync: () => true, readFileSync: () => { throw new Error('EACCES'); } };
    const { mod } = loadInference(async () => ({ content: '{"domain":"contacts","components":[]}' }), fsStub);
    expect((await mod.inferDomainAndComponents(makeIssue())).domain).to.equal('contacts');
  });
});

describe('domain-inference (CLI provider path)', () => {
  // Integration-grade loader: compose the REAL structured-cli adapter over a fake
  // provider, then inject it into domain-inference. The '@langchain/anthropic' ctor
  // is a tripwire that throws if constructed — asserting the CLI branch is taken.
  const loadCliInference = (response: unknown) => {
    const calls: RecordedCall[] = [];
    const fakeProvider = {
      invokeForJSON: async <T>(prompt: string, options?: InvokeOptions): Promise<T> => {
        calls.push({ prompt, options });
        return response as T;
      },
    };
    const structuredCli = proxyquire('../../src/llm/structured-cli', {
      './factory': { createLLMProviderFromEnv: () => fakeProvider, isUsingCLIProvider: () => true },
    });
    const anthropicCtor = sinon.stub().throws(new Error('ChatAnthropic constructed in CLI mode'));
    const mod = proxyquire('../../src/utils/domain-inference', {
      '../llm/structured-cli': structuredCli,
      '@langchain/anthropic': { ChatAnthropic: anthropicCtor },
    });
    return { mod, calls, anthropicCtor };
  };

  it('routes through the CLI chain, resolving domain + components without constructing ChatAnthropic', async () => {
    const { mod, calls, anthropicCtor } = loadCliInference({ domain: 'messaging', components: ['api/sms'], reasoning: 'x' });
    const res = await mod.inferDomainAndComponents(makeIssue());
    expect(res).to.deep.equal({ domain: 'messaging', components: ['api/sms'] });
    expect(anthropicCtor.called).to.equal(false);
    expect(calls.length).to.equal(1);
  });

  it('forwards the built prompt (title, roster, adapter suffix, shape keys) to the provider', async () => {
    const title = 'Send SMS when a task is overdue';
    const { mod, calls } = loadCliInference({ domain: 'messaging', components: [] });
    await mod.inferDomainAndComponents(makeIssue({ title }));
    const prompt = calls[0].prompt;
    expect(prompt).to.include(title);
    expect(prompt).to.include('infrastructure -');
    expect(prompt).to.include('Return a single JSON object');
    expect(prompt).to.include('"domain"');
    expect(prompt).to.include('"components"');
    expect(prompt).to.include('"reasoning"');
  });

  it('invokes the provider one-shot: disableTools true, maxTurns 1', async () => {
    const { mod, calls } = loadCliInference({ domain: 'contacts', components: [] });
    await mod.inferDomainAndComponents(makeIssue());
    expect(calls[0].options?.disableTools).to.equal(true);
    expect(calls[0].options?.maxTurns).to.equal(1);
  });

  it('rejects when the provider returns a domain outside the taxonomy (zod enum)', async () => {
    const { mod, calls } = loadCliInference({ domain: 'nope', components: [] });
    await expectReject(mod.inferDomainAndComponents(makeIssue()), /nope|invalid/i);
    expect(calls.length).to.equal(1);
  });

  it('defaults components to [] when the provider omits the components key', async () => {
    const { mod, calls } = loadCliInference({ domain: 'configuration', reasoning: 'domain only' });
    const res = await mod.inferDomainAndComponents(makeIssue());
    expect(res.domain).to.equal('configuration');
    expect(res.components).to.deep.equal([]);
    expect(calls.length).to.equal(1);
  });

  it('rejects a non-array components value (deliberate strictness vs the API path coercion)', async () => {
    const { mod, calls } = loadCliInference({ domain: 'contacts', components: 'api/x' });
    await expectReject(mod.inferDomainAndComponents(makeIssue()), /array|expected/i);
    expect(calls.length).to.equal(1);
  });

  it('enrichIssueTemplate keeps ticket components when the CLI returns none, but takes the inferred domain', async () => {
    const { mod, calls } = loadCliInference({ domain: 'data-sync', components: [] });
    const issue = makeIssue({ technical_context: { domain: undefined as unknown as CHTDomain, components: ['keep/me'] } });
    const enriched = await mod.enrichIssueTemplate(issue);
    expect(enriched.issue.technical_context.domain).to.equal('data-sync');
    expect(enriched.issue.technical_context.components).to.deep.equal(['keep/me']);
    expect(calls.length).to.equal(1);
  });

  it('short-circuits to ticket values without calling the provider when both domain and components are present', async () => {
    const { mod, calls } = loadCliInference({ domain: 'messaging', components: ['ignored'] });
    const res = await mod.inferDomainAndComponents(
      makeIssue({ technical_context: { domain: 'contacts', components: ['api/x'] } }),
    );
    expect(res).to.deep.equal({ domain: 'contacts', components: ['api/x'] });
    expect(calls.length).to.equal(0);
  });
});

describe('domain-inference (explicit API selection, no regression)', () => {
  // Force the API branch (isUsingCLIProvider stubbed false) with a CLI-chain tripwire
  // stub, and record the ChatAnthropic constructor args to lock in default/override model.
  const loadApiInference = () => {
    const ctorArgs: Array<Record<string, unknown>> = [];
    const invoke = sinon.stub().resolves({ content: '{"domain":"contacts","components":["api/x"]}' });
    const FakeChatAnthropic = function FakeChatAnthropic(this: object, args: Record<string, unknown>) {
      ctorArgs.push(args);
      return Object.assign(this, { invoke });
    } as unknown as { new (args: Record<string, unknown>): { invoke: typeof invoke } };
    const createCliChainStub = sinon.stub();
    const mod = proxyquire('../../src/utils/domain-inference', {
      '../llm/structured-cli': { isUsingCLIProvider: () => false, createStructuredCliChain: createCliChainStub },
      '@langchain/anthropic': { ChatAnthropic: FakeChatAnthropic },
    });
    return { mod, ctorArgs, createCliChainStub };
  };

  it('uses ChatAnthropic with the default model + temperature, never the CLI chain', async () => {
    const { mod, ctorArgs, createCliChainStub } = loadApiInference();
    const res = await mod.inferDomainAndComponents(makeIssue());
    expect(res.domain).to.equal('contacts');
    expect(createCliChainStub.called).to.equal(false);
    expect(ctorArgs[0]).to.deep.equal({ model: 'claude-sonnet-4-20250514', temperature: 0.2 });
  });

  it('passes an explicit modelName override through to the ChatAnthropic constructor', async () => {
    const { mod, ctorArgs, createCliChainStub } = loadApiInference();
    await mod.inferDomainAndComponents(makeIssue(), 'my-model');
    expect(createCliChainStub.called).to.equal(false);
    expect(ctorArgs[0]).to.deep.equal({ model: 'my-model', temperature: 0.2 });
  });
});
