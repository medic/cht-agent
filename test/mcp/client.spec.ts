import { expect } from 'chai';
import * as sinon from 'sinon';
import { MCPClient } from '../../src/mcp';

describe('MCPClient', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('fromEnv()', () => {
    it('should use MCP_SERVER_URL from environment', () => {
      const originalEnv = process.env.MCP_SERVER_URL;
      process.env.MCP_SERVER_URL = 'https://custom-mcp.example.com/mcp';

      const client = MCPClient.fromEnv();

      expect(client.getServerUrl()).to.equal('https://custom-mcp.example.com/mcp');
      process.env.MCP_SERVER_URL = originalEnv;
    });

    it('should use the default server URL when MCP_SERVER_URL is not set', () => {
      const originalEnv = process.env.MCP_SERVER_URL;
      delete process.env.MCP_SERVER_URL;

      const client = MCPClient.fromEnv();

      expect(client.getServerUrl()).to.equal('https://mcp-docs.dev.medicmobile.org/mcp');
      process.env.MCP_SERVER_URL = originalEnv;
    });
  });

  describe('parseSearchDocsResponse()', () => {
    let client: MCPClient;

    beforeEach(() => {
      client = new MCPClient();
    });

    it('should return empty array for empty content', () => {
      const result = client.parseSearchDocsResponse({ content: '' });
      expect(result).to.deep.equal([]);
    });

    it('should return empty array when no source URL is found', () => {
      const content = [
        '**My Title|My Title**',
        '# Section',
        '## Content',
        'Some documentation text.',
        // Missing "Source:" line
      ].join('\n');

      const result = client.parseSearchDocsResponse({ content });
      expect(result).to.deep.equal([]);
    });

    it('should parse a well-formed document section', () => {
      const content = [
        '**Contacts Overview|Contacts Overview**',
        '# Contact Types',
        '## Overview',
        'Contact types define the hierarchy in CHT.',
        'Source: https://docs.communityhealthtoolkit.org/apps/reference/contact-page/',
      ].join('\n');

      const result = client.parseSearchDocsResponse({ content });

      expect(result).to.have.length(1);
      expect(result[0].title).to.equal('Contacts Overview');
      expect(result[0].sourceUrl).to.equal(
        'https://docs.communityhealthtoolkit.org/apps/reference/contact-page/'
      );
    });

    it('should parse multiple document sections separated by ---', () => {
      const section = (title: string, url: string) =>
        [
          `**${title}|${title}**`,
          '# Section',
          '## Content',
          'Some text.',
          `Source: ${url}`,
        ].join('\n');

      const content = [
        section('Doc One', 'https://docs.cht.org/one'),
        '---',
        section('Doc Two', 'https://docs.cht.org/two'),
      ].join('\n');

      const result = client.parseSearchDocsResponse({ content });

      expect(result).to.have.length(2);
      expect(result[0].title).to.equal('Doc One');
      expect(result[1].title).to.equal('Doc Two');
    });
  });

  describe('callTool (via searchDocs) — mocked fetch', () => {
    let client: MCPClient;
    let fetchStub: sinon.SinonStub;

    const makeJsonRpcSuccess = (text: string) => ({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text }],
          isError: false,
        },
      }),
    });

    beforeEach(() => {
      client = new MCPClient({ serverUrl: 'https://mcp-test.example.com/mcp', timeout: 5000 });
      fetchStub = sinon.stub(globalThis, 'fetch' as any);
    });

    it('should return text content on a successful JSON-RPC response', async () => {
      fetchStub.resolves(makeJsonRpcSuccess('Hello from MCP'));

      const response = await client.searchDocs({ query: 'test query' });

      expect(response.content).to.equal('Hello from MCP');
      expect(fetchStub.calledOnce).to.be.true;
    });

    it('should throw when the HTTP response is not ok', async () => {
      fetchStub.resolves({ ok: false, status: 500, statusText: 'Internal Server Error' });

      try {
        await client.searchDocs({ query: 'test' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('500');
      }
    });

    it('should throw when the JSON-RPC response contains an error', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }),
      });

      try {
        await client.searchDocs({ query: 'test' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('Method not found');
      }
    });

    it('should throw when the tool returns isError: true', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'Tool execution failed' }],
            isError: true,
          },
        }),
      });

      try {
        await client.searchDocs({ query: 'test' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('Tool execution failed');
      }
    });

    it('should throw when fetch is aborted (timeout)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      fetchStub.rejects(abortError);

      try {
        await client.searchDocs({ query: 'slow query' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).name).to.equal('AbortError');
      }
    });

    it('should send correct JSON-RPC structure in request body', async () => {
      fetchStub.resolves(makeJsonRpcSuccess(''));

      await client.searchDocs({ query: 'my search', maxResults: 3 });

      const callArgs = fetchStub.firstCall.args;
      const body = JSON.parse(callArgs[1].body);

      expect(body.jsonrpc).to.equal('2.0');
      expect(body.method).to.equal('tools/call');
      expect(body.params.name).to.equal('search_docs');
      expect(body.params.arguments.query).to.equal('my search');
      expect(body.params.arguments.maxResults).to.equal(3);
    });
  });
});
