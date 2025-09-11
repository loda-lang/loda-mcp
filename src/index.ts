#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "node:crypto";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// LODA API Configuration
const LODA_API_BASE_URL = process.env.LODA_API_BASE_URL || "https://api.loda-lang.org/v2";

// Type definitions based on the OpenAPI specification
interface SequenceDetails {
  id: string;
  name: string;
  terms: string[];
  keywords?: string[];
  oeisRef?: string | null;
}

interface ProgramDetails {
  id: string;
  name: string;
  code: string;
  submitter?: string | null;
  keywords?: string[];
  operations?: string[];
}

interface EvalResult {
  terms: string[];
}

interface StatsSummary {
  numSequences: number;
  numPrograms: number;
  numFormulas: number;
}

interface Submitter {
  name: string;
  numPrograms: number;
}

/**
 * LODA API Client - handles all communication with the LODA API
 */
class LODAApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = LODA_API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const defaultOptions: RequestInit = {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'loda-mcp/1.0.0',
        ...options.headers,
      },
    };
    try {
      const response = await fetch(url, { ...defaultOptions, ...options });
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorBody = await response.text();
          if (errorBody) {
            errorMessage += ` - ${errorBody}`;
          }
        } catch (e) {}
        throw new McpError(
          ErrorCode.InternalError,
          `LODA API request failed: ${errorMessage}`
        );
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return await response.text();
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      if (error instanceof Error) {
        if (error.message.includes('fetch')) {
          throw new McpError(
            ErrorCode.InternalError,
            `Network error: Unable to connect to LODA API at ${this.baseUrl}`
          );
        }
        throw new McpError(ErrorCode.InternalError, `Request error: ${error.message}`);
      }
      throw new McpError(ErrorCode.InternalError, 'Unknown error occurred');
    }
  }

  async getSequence(id: string): Promise<SequenceDetails> {
    return this.makeRequest(`/sequences/${id}`);
  }

  async searchSequences(q: string, limit?: number, skip?: number): Promise<{ total: number; results: { id: string; name: string }[] }> {
    const params = new URLSearchParams({ q });
    if (limit !== undefined) params.append('limit', String(limit));
    if (skip !== undefined) params.append('skip', String(skip));
    // The API returns { total, results }
    return this.makeRequest(`/sequences/search?${params.toString()}`);
  }

  async getProgram(id: string): Promise<ProgramDetails> {
    return this.makeRequest(`/programs/${id}`);
  }

  async searchPrograms(q: string, limit?: number, skip?: number): Promise<{ total: number; results: { id: string; name: string }[] }> {
    const params = new URLSearchParams({ q });
    if (limit !== undefined) params.append('limit', String(limit));
    if (skip !== undefined) params.append('skip', String(skip));
    // The API returns { total, results }
    return this.makeRequest(`/programs/search?${params.toString()}`);
  }

  async evalProgram(code: string, t?: number, o?: number): Promise<EvalResult> {
    const params = new URLSearchParams();
    if (t !== undefined) params.append('t', String(t));
    if (o !== undefined) params.append('o', String(o));
    return this.makeRequest(`/programs/eval${params.size ? '?' + params.toString() : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
    });
  }

  async submitProgram(id: string, code: string): Promise<void> {
    await this.makeRequest(`/programs/${id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
    });
  }

  async getStatsSummary(): Promise<StatsSummary> {
    return this.makeRequest('/stats/summary');
  }

  async getSubmitters(): Promise<Submitter[]> {
    return this.makeRequest('/stats/submitters');
  }
}

/**
 * LODA MCP Server - provides MCP interface to LODA API
 */
class LODAMCPServer {
  private server: Server;
  private apiClient: LODAApiClient;

  constructor() {
    this.server = new Server(
      {
        name: "loda-api-server",
        version: "2.0.0",
        description: "MCP server for LODA Language API v2 (OpenAPI 3.0.3)"
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    this.apiClient = new LODAApiClient();
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_program",
            description: "Get details about a LODA program by ID (e.g. A000045)",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Program ID (e.g. A000045)" }
              },
              required: ["id"],
              additionalProperties: false
            }
          },
          {
            name: "search_programs",
            description: "Search for LODA programs by keywords, ID, or name.",
            inputSchema: {
              type: "object",
              properties: {
                q: { type: "string", description: "Search query" },
                limit: { type: "number", description: "Max results", minimum: 1, maximum: 100 },
                skip: { type: "number", description: "Offset for pagination", minimum: 0 }
              },
              required: ["q"],
              additionalProperties: false
            }
          },
          {
            name: "eval_program",
            description: "Evaluate a LODA program and return sequence terms.",
            inputSchema: {
              type: "object",
              properties: {
                code: { type: "string", description: "LODA program code" },
                t: { type: "number", description: "Number of terms", minimum: 1, maximum: 10000 },
                o: { type: "number", description: "Offset (optional)" }
              },
              required: ["code"],
              additionalProperties: false
            }
          },
          {
            name: "submit_program",
            description: "Submit a new LODA program for a sequence.",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Sequence/program ID (e.g. A000045)" },
                code: { type: "string", description: "LODA program code" }
              },
              required: ["id", "code"],
              additionalProperties: false
            }
          },
          {
            name: "get_sequence",
            description: "Get details about an integer sequence by ID (e.g. A000045)",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Sequence ID (e.g. A000045)" }
              },
              required: ["id"],
              additionalProperties: false
            }
          },
          {
            name: "search_sequences",
            description: "Search for integer sequences by keywords, ID, or name.",
            inputSchema: {
              type: "object",
              properties: {
                q: { type: "string", description: "Search query" },
                limit: { type: "number", description: "Max results", minimum: 1, maximum: 100 },
                skip: { type: "number", description: "Offset for pagination", minimum: 0 }
              },
              required: ["q"],
              additionalProperties: false
            }
          },
          {
            name: "get_stats_summary",
            description: "Get statistics summary for the LODA project.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false }
          },
          {
            name: "get_submitters",
            description: "List all submitters and their number of programs.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false }
          }
        ] as Tool[]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      // Always ensure args is an object
      const safeArgs = (args && typeof args === 'object') ? args : {};
      try {
        switch (name) {
          case "get_program":
            return this.handleGetProgram(safeArgs as { id: string });
          case "search_programs":
            return this.handleSearchPrograms(safeArgs as { q: string; limit?: number; skip?: number });
          case "eval_program":
            return this.handleEvalProgram(safeArgs as { code: string; t?: number; o?: number });
          case "submit_program":
            return this.handleSubmitProgram(safeArgs as { id: string; code: string });
          case "get_sequence":
            return this.handleGetSequence(safeArgs as { id: string });
          case "search_sequences":
            return this.handleSearchSequences(safeArgs as { q: string; limit?: number; skip?: number });
          case "get_stats_summary":
            return this.handleGetStatsSummary();
          case "get_submitters":
            return this.handleGetSubmitters();
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        let errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(ErrorCode.InternalError, `Error executing tool ${name}: ${errorMessage}`);
      }
    });
  }

  private async handleGetSequence(args: { id: string }) {
    const { id } = args;
    if (!/^A\d{6,}$/.test(id)) {
      throw new McpError(ErrorCode.InvalidParams, "id must be a string like A000045");
    }
    const seq = await this.apiClient.getSequence(id);
    return {
      content: [
        {
          type: "text",
          text: `🔢 Sequence ${seq.id}: ${seq.name}\n` +
            `First terms: ${seq.terms.slice(0, 20).join(', ')}${seq.terms.length > 20 ? '...' : ''}\n` +
            (seq.keywords ? `Keywords: ${seq.keywords.join(', ')}\n` : '') +
            (seq.oeisRef ? `OEIS: ${seq.oeisRef}\n` : '')
        }
      ]
    };
  }

  private async handleSearchSequences(args: { q: string; limit?: number; skip?: number }) {
    const { q, limit, skip } = args;
    if (!q || typeof q !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "q is required");
    }
    const result = await this.apiClient.searchSequences(q, limit, skip);
    return {
      content: [
        {
          type: "text",
          text: result.results.length === 0 ?
            'No sequences found.' :
            result.results.map((r: {id: string, name: string}) => `${r.id}: ${r.name}`).join('\n') +
            `\nTotal: ${result.total}`
        }
      ],
      ...result
    };
  }

  private async handleGetProgram(args: { id: string }) {
    const { id } = args;
    if (!/^A\d{6,}$/.test(id)) {
      throw new McpError(ErrorCode.InvalidParams, "id must be a string like A000045");
    }
    const prog = await this.apiClient.getProgram(id);
    return {
      content: [
        {
          type: "text",
          text: `🔧 Program ${prog.id}: ${prog.name}\n` +
            `Submitter: ${prog.submitter || 'unknown'}\n` +
            `Code:\n${prog.code}`
        }
      ]
    };
  }

  private async handleSearchPrograms(args: { q: string; limit?: number; skip?: number }) {
    const { q, limit, skip } = args;
    if (!q || typeof q !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "q is required");
    }
    const result = await this.apiClient.searchPrograms(q, limit, skip);
    return {
      content: [
        {
          type: "text",
          text: result.results.length === 0 ?
            'No programs found.' :
            result.results.map((r: {id: string, name: string}) => `${r.id}: ${r.name}`).join('\n') +
            `\nTotal: ${result.total}`
        }
      ],
      ...result
    };
  }

  private async handleEvalProgram(args: { code: string; t?: number; o?: number }) {
    const { code, t, o } = args;
    if (!code || typeof code !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "code is required");
    }
    const result = await this.apiClient.evalProgram(code, t, o);
    return {
      content: [
        {
          type: "text",
          text: `Result: ${result.terms.join(', ')}`
        }
      ]
    };
  }

  private async handleSubmitProgram(args: { id: string; code: string }) {
    const { id, code } = args;
    if (!/^A\d{6,}$/.test(id)) {
      throw new McpError(ErrorCode.InvalidParams, "id must be a string like A000045");
    }
    if (!code || typeof code !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "code is required");
    }
    await this.apiClient.submitProgram(id, code);
    return {
      content: [
        { type: "text", text: `Program submitted for ${id}.` }
      ]
    };
  }

  private async handleGetStatsSummary() {
    const stats = await this.apiClient.getStatsSummary();
    return {
      content: [
        {
          type: "text",
          text: `Stats: Sequences=${stats.numSequences}, Programs=${stats.numPrograms}, Formulas=${stats.numFormulas}`
        }
      ]
    };
  }

  private async handleGetSubmitters() {
    const submitters = await this.apiClient.getSubmitters();
    return {
      content: [
        {
          type: "text",
          text: submitters.map(s => `${s.name}: ${s.numPrograms} programs`).join('\n')
        }
      ]
    };
  }

  async runStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("LODA MCP server v2.0.0 running on stdio");
  }

  // HTTP/Express/Streamable MCP
  static async runHttp(serverInstance: LODAMCPServer, port: number): Promise<void> {
    const app = express();
    app.use(express.json());

    // Session management for MCP
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport;
          },
        });
        // Connect only once per transport
        await serverInstance.server.connect(transport);
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };
      }
      await transport.handleRequest(req, res, req.body);
    });

    // GET and DELETE for notifications/session termination
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    };
    app.get('/mcp', handleSessionRequest);
    app.delete('/mcp', handleSessionRequest);

    app.listen(port, () => {
      console.error(`LODA MCP server v2.0.0 running on http://localhost:${port}/mcp`);
    });
  }
}

// Error handling for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Create and start the server
// Parse port from command line args: --port=PORT or -p PORT
function getPortArg(): number | undefined {
  const argv = process.argv.slice(2);
  let port: number | undefined;
  for (let i = 0; i < argv.length; ++i) {
    if (argv[i] === '--port' && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10);
      break;
    } else if (argv[i].startsWith('--port=')) {
      port = parseInt(argv[i].split('=')[1], 10);
      break;
    } else if ((argv[i] === '-p' || argv[i] === '--p') && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10);
      break;
    }
  }
  return port;
}

const port = getPortArg();
const server = new LODAMCPServer();
if (port !== undefined) {
  LODAMCPServer.runHttp(server, port).catch((error) => {
    console.error("Failed to run LODA MCP HTTP server:", error);
    process.exit(1);
  });
} else {
  server.runStdio().catch((error) => {
    console.error("Failed to run LODA MCP server:", error);
    process.exit(1);
  });
}