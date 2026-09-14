import type { ImageContent, TextContent } from '@earendil-works/pi-ai';

import type { ITool } from './tokens';

const PROTOCOL_VERSION = '2025-06-18';

interface IJsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface IMcpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: ITool['parameters'];
}

interface IMcpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

interface IMcpCallResult {
  content: IMcpContent[];
  isError?: boolean;
}

/**
 * Parse the JSON-RPC response of a request from a server-sent events body.
 */
async function readEventStream(
  response: Response,
  id: number
): Promise<IJsonRpcResponse> {
  const text = await response.text();
  for (const event of text.split(/\n\n+/)) {
    const data = event
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n');
    if (!data) {
      continue;
    }
    try {
      const message = JSON.parse(data) as IJsonRpcResponse;
      if (message.id === id) {
        return message;
      }
    } catch {
      // Not a JSON message.
    }
  }
  throw new Error('No response in the MCP event stream');
}

/**
 * A minimal MCP client over the streamable HTTP transport: enough for tools.
 */
export class McpClient {
  constructor(url: string, headers: Record<string, string> = {}) {
    this._url = url;
    this._headers = headers;
  }

  async connect(): Promise<void> {
    await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'jupyternaut', version: '1.0' }
    });
    await this._send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async listTools(): Promise<IMcpToolInfo[]> {
    const result = (await this._request('tools/list', {})) as {
      tools: IMcpToolInfo[];
    };
    return result.tools ?? [];
  }

  async callTool(name: string, args: unknown): Promise<IMcpCallResult> {
    return (await this._request('tools/call', {
      name,
      arguments: args ?? {}
    })) as IMcpCallResult;
  }

  async close(): Promise<void> {
    if (!this._sessionId) {
      return;
    }
    try {
      await fetch(this._url, {
        method: 'DELETE',
        headers: this._requestHeaders()
      });
    } catch {
      // The server may not support explicit session termination.
    }
  }

  private async _request(method: string, params: unknown): Promise<unknown> {
    const id = ++this._nextId;
    const response = await this._send({ jsonrpc: '2.0', id, method, params });
    const type = response.headers.get('content-type') ?? '';
    const message = type.includes('text/event-stream')
      ? await readEventStream(response, id)
      : ((await response.json()) as IJsonRpcResponse);
    if (message.error) {
      throw new Error(message.error.message);
    }
    return message.result;
  }

  private async _send(body: unknown): Promise<Response> {
    const response = await fetch(this._url, {
      method: 'POST',
      headers: this._requestHeaders(),
      body: JSON.stringify(body)
    });
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) {
      this._sessionId = sessionId;
    }
    if (!response.ok) {
      throw new Error(`MCP request failed: HTTP ${response.status}`);
    }
    return response;
  }

  private _requestHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(this._sessionId && { 'Mcp-Session-Id': this._sessionId }),
      ...this._headers
    };
  }

  private _url: string;
  private _headers: Record<string, string>;
  private _sessionId?: string;
  private _nextId = 0;
}

function toContent(items: IMcpContent[]): (TextContent | ImageContent)[] {
  return items.map(item => {
    if (item.type === 'image' && item.data && item.mimeType) {
      return { type: 'image', data: item.data, mimeType: item.mimeType };
    }
    return {
      type: 'text',
      text: item.type === 'text' ? (item.text ?? '') : JSON.stringify(item)
    };
  });
}

/**
 * The tools of an MCP server as agent tools.
 */
export async function createMcpTools(client: McpClient): Promise<ITool[]> {
  const tools = await client.listTools();
  return tools.map(info => ({
    name: info.name,
    label: info.title ?? info.name,
    description: info.description ?? info.name,
    parameters: info.inputSchema,
    execute: async (toolCallId, params) => {
      const result = await client.callTool(info.name, params);
      const content = toContent(result.content ?? []);
      if (result.isError) {
        throw new Error(
          content
            .map(part => (part.type === 'text' ? part.text : ''))
            .join('\n') || `The tool ${info.name} failed`
        );
      }
      return { content, details: result };
    }
  }));
}
