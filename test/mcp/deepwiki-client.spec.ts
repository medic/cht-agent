import { expect } from 'chai';
import * as sinon from 'sinon';
import { OpenDeepWikiClient, DeepWikiRateLimitError } from '../../src/mcp';

describe('OpenDeepWikiClient', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('fromEnv()', () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env.DEEPWIKI_MCP_URL;
    });

    afterEach(() => {
      // Restore regardless of test outcome to avoid env pollution
      if (originalEnv === undefined) {
        delete process.env.DEEPWIKI_MCP_URL;
      } else {
        process.env.DEEPWIKI_MCP_URL = originalEnv;
      }
    });

    it('should use DEEPWIKI_MCP_URL from environment', () => {
      process.env.DEEPWIKI_MCP_URL = 'https://custom-deepwiki.example.com/api/mcp';

      const client = OpenDeepWikiClient.fromEnv();

      expect(client.getServerUrl()).to.equal('https://custom-deepwiki.example.com/api/mcp');
    });

    it('should use the default server URL when DEEPWIKI_MCP_URL is not set', () => {
      delete process.env.DEEPWIKI_MCP_URL;

      const client = OpenDeepWikiClient.fromEnv();

      expect(client.getServerUrl()).to.equal('https://opendeepwiki.dev.medicmobile.org/api/mcp');
    });
  });

  describe('tool calls — mocked fetch', () => {
    let client: OpenDeepWikiClient;
    let fetchStub: sinon.SinonStub;

    const catalogPayload = {
      repository: 'medic/cht-core',
      branch: 'master',
      language: 'en',
      documentCount: 2,
      documents: [
        { title: 'Project Overview', path: '1-getting-started.1-overview', order: 1, hasParent: true },
        { title: 'System Components', path: '2-architecture.1-components', order: 1, hasParent: true },
      ],
    };

    const makeJsonResponse = (text: string, isError = false) => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text }],
          isError,
        },
      }),
    });

    const makeSseResponse = (text: string) => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      text: async () =>
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text }], isError: false },
        })}\n\n`,
    });

    beforeEach(() => {
      client = new OpenDeepWikiClient({
        serverUrl: 'https://deepwiki-test.example.com/api/mcp',
        timeout: 5000,
      });
      // `fetch` is not on the sinon type stubs for globalThis; `as any` is
      // required to stub it without a custom type declaration.
      fetchStub = sinon.stub(globalThis, 'fetch' as any);
    });

    it('should append owner and repo name as query parameters', async () => {
      fetchStub.resolves(makeJsonResponse(JSON.stringify(catalogPayload)));

      await client.getDocumentCatalog('cht-core');

      const requestUrl = fetchStub.firstCall.args[0];
      expect(requestUrl).to.equal(
        'https://deepwiki-test.example.com/api/mcp?owner=medic&name=cht-core'
      );
    });

    it('should send correct JSON-RPC structure for get_document_catalog', async () => {
      fetchStub.resolves(makeJsonResponse(JSON.stringify(catalogPayload)));

      await client.getDocumentCatalog('cht-core');

      const body = JSON.parse(fetchStub.firstCall.args[1].body);
      expect(body.jsonrpc).to.equal('2.0');
      expect(body.method).to.equal('tools/call');
      expect(body.params.name).to.equal('get_document_catalog');
      expect(body.params.arguments.owner).to.equal('medic');
      expect(body.params.arguments.name).to.equal('cht-core');
      expect(body.params.arguments.language).to.equal('en');
    });

    it('should parse a plain JSON catalog response', async () => {
      fetchStub.resolves(makeJsonResponse(JSON.stringify(catalogPayload)));

      const catalog = await client.getDocumentCatalog('cht-core');

      expect(catalog.repository).to.equal('medic/cht-core');
      expect(catalog.documents).to.have.lengthOf(2);
      expect(catalog.documents[0].path).to.equal('1-getting-started.1-overview');
    });

    it('should parse an SSE-framed catalog response', async () => {
      fetchStub.resolves(makeSseResponse(JSON.stringify(catalogPayload)));

      const catalog = await client.getDocumentCatalog('cht-core');

      expect(catalog.repository).to.equal('medic/cht-core');
      expect(catalog.documents).to.have.lengthOf(2);
    });

    it('should read a document with default line range', async () => {
      const docPayload = {
        repository: 'medic/cht-core',
        path: '2-architecture.1-components',
        title: 'System Components',
        content: '# System Components\n\nSome content.',
      };
      fetchStub.resolves(makeJsonResponse(JSON.stringify(docPayload)));

      const doc = await client.readDocument('cht-core', '2-architecture.1-components');

      expect(doc.title).to.equal('System Components');
      expect(doc.content).to.include('Some content');

      const body = JSON.parse(fetchStub.firstCall.args[1].body);
      expect(body.params.name).to.equal('read_document');
      expect(body.params.arguments.path).to.equal('2-architecture.1-components');
      expect(body.params.arguments.startLine).to.equal(1);
      expect(body.params.arguments.endLine).to.equal(200);
    });

    const makePage = (startLine: number, endLine: number, totalLines: number, content: string) =>
      makeJsonResponse(
        JSON.stringify({
          repository: 'medic/cht-core',
          path: '2-architecture.1-components',
          title: 'System Components',
          startLine,
          endLine,
          totalLines,
          content,
        })
      );

    it('readFullDocument should return a single page when the doc fits in 200 lines', async () => {
      fetchStub.resolves(makePage(1, 200, 120, 'short doc'));

      const doc = await client.readFullDocument('cht-core', '2-architecture.1-components');

      expect(fetchStub.calledOnce).to.be.true;
      expect(doc.content).to.equal('short doc');
      expect(doc.endLine).to.equal(200);
    });

    it('readFullDocument should page through and concatenate a long doc', async () => {
      fetchStub.onCall(0).resolves(makePage(1, 200, 480, 'PAGE1'));
      fetchStub.onCall(1).resolves(makePage(201, 400, 480, 'PAGE2'));
      fetchStub.onCall(2).resolves(makePage(401, 480, 480, 'PAGE3'));

      const doc = await client.readFullDocument('cht-core', '2-architecture.1-components');

      expect(fetchStub.callCount).to.equal(3);
      expect(doc.content).to.equal('PAGE1\nPAGE2\nPAGE3');
      expect(doc.startLine).to.equal(1);
      expect(doc.endLine).to.equal(480);

      // Verify the requested line windows
      const ranges = fetchStub.getCalls().map(c => {
        const args = JSON.parse(c.args[1].body).params.arguments;
        return [args.startLine, args.endLine];
      });
      expect(ranges).to.deep.equal([
        [1, 200],
        [201, 400],
        [401, 480],
      ]);
    });

    it('readFullDocument should stop at the maxLines cap', async () => {
      fetchStub.onCall(0).resolves(makePage(1, 200, 2000, 'PAGE1'));
      fetchStub.onCall(1).resolves(makePage(201, 400, 2000, 'PAGE2'));
      fetchStub.onCall(2).resolves(makePage(401, 600, 2000, 'PAGE3'));

      const doc = await client.readFullDocument('cht-core', '2-architecture.1-components', {
        maxLines: 600,
      });

      expect(fetchStub.callCount).to.equal(3); // 600 / 200, not 2000
      expect(doc.endLine).to.equal(600);
      expect(doc.content).to.equal('PAGE1\nPAGE2\nPAGE3');
    });

    it('should throw DeepWikiRateLimitError on HTTP 429', async () => {
      fetchStub.resolves({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: () => 'application/json' },
      });

      try {
        await client.getDocumentCatalog('cht-core');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(DeepWikiRateLimitError);
        expect((err as Error).message).to.include('cht-core');
      }
    });

    it('should throw when the HTTP response is not ok', async () => {
      fetchStub.resolves({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => 'application/json' },
      });

      try {
        await client.getDocumentCatalog('cht-core');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('500');
      }
    });

    it('should throw when the JSON-RPC response contains an error', async () => {
      fetchStub.resolves({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }),
      });

      try {
        await client.getDocumentCatalog('cht-core');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('Method not found');
      }
    });

    it('should throw when the tool returns isError: true', async () => {
      fetchStub.resolves(makeJsonResponse("An error occurred invoking 'search_documents'.", true));

      try {
        await client.getDocumentCatalog('cht-core');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('An error occurred');
      }
    });

    it('should throw when the tool content is not valid JSON', async () => {
      fetchStub.resolves(makeJsonResponse('this is not json'));

      try {
        await client.getDocumentCatalog('cht-core');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('unparseable');
      }
    });

    it('should throw when an SSE response has no data frames', async () => {
      fetchStub.resolves({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        text: async () => 'event: message\n\n',
      });

      try {
        await client.getDocumentCatalog('cht-core');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('no data frames');
      }
    });

    it('should throw when fetch is aborted (timeout)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      fetchStub.rejects(abortError);

      try {
        await client.getDocumentCatalog('cht-core');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).name).to.equal('AbortError');
      }
    });
  });
});
