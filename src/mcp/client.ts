/**
 * MCP Client for CHT Documentation Server
 *
 * Provides access to CHT documentation via the Kapa.AI MCP server.
 */

import {
  MCPClientConfig,
  MCPSearchDocsParams,
  MCPSearchDocsResponse,
  MCPParsedDocument,
} from '../types';
import { DEFAULT_MCP_SERVER_URL } from '../constants';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: MCPClientConfig = {
  serverUrl: DEFAULT_MCP_SERVER_URL,
  timeout: 30000, // 30 seconds
};

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
 * MCP Client for CHT documentation
 */
export class MCPClient {
  private readonly config: MCPClientConfig;
  private requestId: number = 0;

  constructor(config?: Partial<MCPClientConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Create MCPClient from environment variables
   */
  static fromEnv(): MCPClient {
    const serverUrl = process.env.MCP_SERVER_URL || DEFAULT_CONFIG.serverUrl;
    const timeout = process.env.MCP_TIMEOUT
      ? Number.parseInt(process.env.MCP_TIMEOUT, 10)
      : DEFAULT_CONFIG.timeout;

    return new MCPClient({ serverUrl, timeout });
  }

  /**
   * Get the server URL
   */
  getServerUrl(): string {
    return this.config.serverUrl;
  }

  /**
   * Search CHT documentation
   */
  async searchDocs(params: MCPSearchDocsParams): Promise<MCPSearchDocsResponse> {
    const response = await this.callTool('search_docs', {
      query: params.query,
      maxResults: params.maxResults,
    });

    return { content: response };
  }


  /**
   * Parse search_docs response into structured documents
   */
  parseSearchDocsResponse(response: MCPSearchDocsResponse): MCPParsedDocument[] {
    const documents: MCPParsedDocument[] = [];
    const content = response.content;

    // Split by document separator (---)
    const docSections = content.split(/\n---\n/).filter((s) => s.trim());

    for (const section of docSections) {
      const parsed = this.parseDocumentSection(section);
      if (parsed) {
        documents.push(parsed);
      }
    }

    return documents;
  }


  /**
   * Make a tool call to the MCP server
   */
  private async callTool(toolName: string, params: Record<string, unknown>): Promise<string> {
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
      const response = await fetch(this.config.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`MCP server returned ${response.status}: ${response.statusText}`);
      }

      const rpcResponse = (await response.json()) as MCPRPCResponse;

      if (rpcResponse.error) {
        throw new Error(`MCP error: ${rpcResponse.error.message} (code: ${rpcResponse.error.code})`);
      }

      if (rpcResponse.result?.isError) {
        const errorText = rpcResponse.result.content?.[0]?.text || 'Unknown error';
        throw new Error(`MCP tool error: ${errorText}`);
      }

      // Extract text content from response
      const textContent = rpcResponse.result?.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      return textContent || '';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse a single document section from search results
   */
  private parseDocumentSection(section: string): MCPParsedDocument | null {
    const extract = (regex: RegExp, index = 1) => {
      const match = regex.exec(section);
      return match ? match[index].trim() : '';
    };

  const title = extract(/\*\*([^|*]+)\|([^*]+)\*\*/);
  const sectionPath = extract(/^#\s*([^\n]+)/m);
  const sourceUrl = extract(/Source:\s*(https?:\/\/[^\s]+)/);

  if (!sourceUrl) return null;

  const contentStart = section.indexOf('##');
  const contentEnd = section.lastIndexOf('Source:');

  let content = section;
  if (contentStart !== -1 && contentEnd !== -1) {
    content = section.substring(contentStart, contentEnd).trim();
  }

    return {
      title,
      section: sectionPath,
      content,
      sourceUrl,
    };
  }
}

/**
 * Export default instance creation
 */
export const createMCPClient = MCPClient.fromEnv;
