/**
 * MCP Client for OpenDeepWiki
 *
 * Provides access to CHT code architecture wikis via the deployed OpenDeepWiki
 * MCP server. The server exposes document-oriented tools (get_document_catalog,
 * read_document, search_documents, list_repositories) per repository, selected
 * with `?owner=<owner>&name=<repo>` query parameters.
 *
 * Responses are MCP streamable-HTTP: either plain JSON or a Server-Sent Events
 * frame (`event: message\ndata: {...}`), so both formats are handled here.
 */

import { DeepWikiCatalog, DeepWikiClientConfig, DeepWikiDocument } from '../types';
import { DEFAULT_DEEPWIKI_MCP_URL, DEFAULT_DEEPWIKI_REPO_OWNER } from '../constants';

const DEFAULT_CONFIG: DeepWikiClientConfig = {
  serverUrl: DEFAULT_DEEPWIKI_MCP_URL,
  owner: DEFAULT_DEEPWIKI_REPO_OWNER,
  timeout: 30000,
};

/** Cap document content before regex extraction so a huge response can't pin CPU/memory. */
const MAX_DOCUMENT_CONTENT_LENGTH = 100_000;

/** Server-enforced maximum line span per read_document request. */
const PAGE_SIZE = 200;

/**
 * Default ceiling on how many lines readFullDocument will page through, bounding
 * round-trips against the shared public server (3 pages). Override per call.
 */
const DEFAULT_MAX_DOCUMENT_LINES = 600;

const parseTimeout = (raw: string | undefined, fallback: number): number => {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const assertHttps = (serverUrl: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error(`Invalid OpenDeepWiki server URL: ${serverUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`OpenDeepWiki server URL must use https (got ${parsed.protocol})`);
  }
};

/**
 * Error thrown when the OpenDeepWiki server responds with HTTP 429
 */
export class DeepWikiRateLimitError extends Error {
  constructor(repo: string) {
    super(`OpenDeepWiki rate limit exceeded for ${repo}`);
    this.name = 'DeepWikiRateLimitError';
  }
}

/**
 * MCP JSON-RPC request structure
 */
interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP JSON-RPC response structure
 */
interface MCPRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content: Array<{
      type: string;
      text: string;
    }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * MCP Client for OpenDeepWiki code architecture wikis
 */
export class OpenDeepWikiClient {
  private readonly config: DeepWikiClientConfig;
  private requestId: number = 0;

  constructor(config?: Partial<DeepWikiClientConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Create OpenDeepWikiClient from environment variables
   */
  static fromEnv(overrides: Partial<DeepWikiClientConfig> = {}): OpenDeepWikiClient {
    const serverUrl = overrides.serverUrl ?? process.env.DEEPWIKI_MCP_URL ?? DEFAULT_CONFIG.serverUrl;
    assertHttps(serverUrl);
    const timeout =
      overrides.timeout ?? parseTimeout(process.env.DEEPWIKI_MCP_TIMEOUT, DEFAULT_CONFIG.timeout);

    return new OpenDeepWikiClient({ ...overrides, serverUrl, timeout });
  }

  /**
   * Get the configured base server URL
   */
  getServerUrl(): string {
    return this.config.serverUrl;
  }

  /**
   * Get the document catalog (table of contents) for a repository
   */
  async getDocumentCatalog(repo: string, language = 'en'): Promise<DeepWikiCatalog> {
    const text = await this.callTool(repo, 'get_document_catalog', {
      owner: this.config.owner,
      name: repo,
      language,
    });

    const catalog = this.parseJsonContent<DeepWikiCatalog>(text, repo, 'get_document_catalog');
    if (!Array.isArray(catalog.documents)) {
      throw new TypeError(`OpenDeepWiki get_document_catalog returned an unexpected shape for ${repo}`);
    }
    return catalog;
  }

  /**
   * Read a single page of a document. Defaults to the first page (lines 1-200);
   * the server caps each request at a 200-line span. Pass startLine/endLine to
   * fetch a specific window.
   */
  async readDocument(
    repo: string,
    path: string,
    options: { startLine?: number; endLine?: number; language?: string } = {}
  ): Promise<DeepWikiDocument> {
    const text = await this.callTool(repo, 'read_document', {
      owner: this.config.owner,
      name: repo,
      path,
      startLine: options.startLine ?? 1,
      endLine: options.endLine ?? PAGE_SIZE,
      language: options.language ?? 'en',
    });

    const document = this.parseJsonContent<DeepWikiDocument>(text, repo, 'read_document');
    if (typeof document.content !== 'string') {
      throw new TypeError(`OpenDeepWiki read_document returned no content for ${repo}`);
    }
    if (document.content.length > MAX_DOCUMENT_CONTENT_LENGTH) {
      document.content = document.content.slice(0, MAX_DOCUMENT_CONTENT_LENGTH);
    }
    return document;
  }

  /**
   * Read a document in full by paging through it, concatenating up to `maxLines`
   * (default 600 = 3 pages). The server reports `totalLines` on each page, so we
   * stop at the real end; the cap bounds round-trips against the shared server.
   */
  async readFullDocument(
    repo: string,
    path: string,
    options: { maxLines?: number; language?: string } = {}
  ): Promise<DeepWikiDocument> {
    const maxLines = options.maxLines ?? DEFAULT_MAX_DOCUMENT_LINES;
    const language = options.language;

    const firstPage = await this.readDocument(repo, path, { startLine: 1, endLine: PAGE_SIZE, language });

    const totalLines = firstPage.totalLines ?? PAGE_SIZE;
    const lastLine = Math.min(totalLines, maxLines);
    if (lastLine <= PAGE_SIZE) {
      return firstPage;
    }

    const contentParts = [firstPage.content];
    for (let startLine = PAGE_SIZE + 1; startLine <= lastLine; startLine += PAGE_SIZE) {
      const endLine = Math.min(startLine + PAGE_SIZE - 1, lastLine);
      const page = await this.readDocument(repo, path, { startLine, endLine, language });
      contentParts.push(page.content);
    }

    let content = contentParts.join('\n');
    if (content.length > MAX_DOCUMENT_CONTENT_LENGTH) {
      content = content.slice(0, MAX_DOCUMENT_CONTENT_LENGTH);
    }

    return { ...firstPage, content, startLine: 1, endLine: lastLine };
  }

  private buildRepoUrl(repo: string): string {
    const url = new URL(this.config.serverUrl);
    url.searchParams.set('owner', this.config.owner);
    url.searchParams.set('name', repo);
    return url.toString();
  }

  private async callTool(
    repo: string,
    toolName: string,
    params: Record<string, unknown>
  ): Promise<string> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(this.buildRepoUrl(repo), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new DeepWikiRateLimitError(repo);
      }

      if (!response.ok) {
        throw new Error(`OpenDeepWiki server returned ${response.status}: ${response.statusText}`);
      }

      const rpcResponse = await this.parseRpcResponse(response);

      if (rpcResponse.error) {
        throw new Error(
          `OpenDeepWiki error: ${rpcResponse.error.message} (code: ${rpcResponse.error.code})`
        );
      }

      if (rpcResponse.result?.isError) {
        const errorText = rpcResponse.result.content?.[0]?.text || 'Unknown error';
        throw new Error(`OpenDeepWiki tool error: ${errorText}`);
      }

      const textContent = rpcResponse.result?.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      return textContent || '';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async parseRpcResponse(response: Response): Promise<MCPRPCResponse> {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('text/event-stream')) {
      return (await response.json()) as MCPRPCResponse;
    }

    const body = await response.text();
    const dataLines = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim());

    if (dataLines.length === 0) {
      throw new Error('OpenDeepWiki returned an SSE response with no data frames');
    }

    return JSON.parse(dataLines.join('')) as MCPRPCResponse;
  }

  private parseJsonContent<T>(text: string, repo: string, toolName: string): T {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`OpenDeepWiki ${toolName} returned unparseable content for ${repo}`);
    }
  }
}

export const createOpenDeepWikiClient = OpenDeepWikiClient.fromEnv;
