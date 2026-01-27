/**
 * MCP Client for CHT Documentation Server
 *
 * Provides access to CHT documentation via the Kapa.AI MCP server.
 * Supports search_docs, ask_question, and get_sources tools.
 */

import {
  MCPClientConfig,
  MCPSearchDocsParams,
  MCPAskQuestionParams,
  MCPSearchDocsResponse,
  MCPAskQuestionResponse,
  MCPGetSourcesResponse,
  MCPParsedDocument,
  MCPParsedAnswer,
  MCPParsedSource,
} from '../types';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: MCPClientConfig = {
  serverUrl: 'https://mcp-docs.dev.medicmobile.org/mcp',
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
  private config: MCPClientConfig;
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
      ? parseInt(process.env.MCP_TIMEOUT, 10)
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
   * Ask a question about CHT documentation
   */
  async askQuestion(params: MCPAskQuestionParams): Promise<MCPAskQuestionResponse> {
    const response = await this.callTool('ask_question', {
      question: params.question,
      threadId: params.threadId,
    });

    return { content: response };
  }

  /**
   * Get available documentation sources
   */
  async getSources(): Promise<MCPGetSourcesResponse> {
    const response = await this.callTool('get_sources', {});
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
   * Parse ask_question response into structured answer
   */
  parseAskQuestionResponse(response: MCPAskQuestionResponse): MCPParsedAnswer {
    const content = response.content;
    const result: MCPParsedAnswer = {
      answer: '',
      sources: [],
    };

    // Extract thread ID
    const threadIdMatch = content.match(/\*\*Thread ID:\*\*\s*([^\n]+)/);
    if (threadIdMatch) {
      result.threadId = threadIdMatch[1].trim();
    }

    // Extract question answer ID
    const qaIdMatch = content.match(/\*\*Question Answer ID:\*\*\s*([^\n]+)/);
    if (qaIdMatch) {
      result.questionAnswerId = qaIdMatch[1].trim();
    }

    // Extract sources
    const sourcesMatch = content.match(/\*\*Sources:\*\*\n([\s\S]*?)(?=\n\*\*Thread ID|\n\*\*Question Answer ID|$)/);
    if (sourcesMatch) {
      const sourcesText = sourcesMatch[1];
      const sourceLinks = sourcesText.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
      for (const match of sourceLinks) {
        result.sources.push({
          title: match[1],
          url: match[2],
        });
      }
    }

    // Extract answer (everything before Sources section)
    const answerMatch = content.match(/^([\s\S]*?)(?=\*\*Sources:\*\*|$)/);
    if (answerMatch) {
      result.answer = answerMatch[1].trim();
    }

    return result;
  }

  /**
   * Parse get_sources response into structured sources
   */
  parseGetSourcesResponse(response: MCPGetSourcesResponse): MCPParsedSource[] {
    const sources: MCPParsedSource[] = [];
    const content = response.content;

    // Parse lines like "- source_type: description"
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^-\s*([^:]+):\s*(.+)$/);
      if (match) {
        sources.push({
          type: match[1].trim(),
          description: match[2].trim(),
        });
      }
    }

    return sources;
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
    // Extract title (first bold line like **Title|Title**)
    const titleMatch = section.match(/\*\*([^|*]+)\|([^*]+)\*\*/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract section path (like # Section > Subsection)
    const sectionMatch = section.match(/^#\s*([^\n]+)/m);
    const sectionPath = sectionMatch ? sectionMatch[1].trim() : '';

    // Extract source URL
    const sourceMatch = section.match(/Source:\s*(https?:\/\/[^\s]+)/);
    const sourceUrl = sourceMatch ? sourceMatch[1].trim() : '';

    if (!sourceUrl) {
      return null;
    }

    // Content is everything between title/section and source
    const contentStart = section.indexOf('##');
    const contentEnd = section.lastIndexOf('Source:');
    const content =
      contentStart !== -1 && contentEnd !== -1
        ? section.substring(contentStart, contentEnd).trim()
        : section;

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
