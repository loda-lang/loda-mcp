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
  usages?: string[];
}

interface Result {
  status: "success" | "error";
  message: string;
  terms: string[];
}

interface ExportResult {
  status: "success" | "error";
  message: string;
  output: string;
}

interface Submission {
  id: string;
  mode: "add" | "update" | "remove";
  type: "program" | "sequence" | "bfile";
  content?: string;
  submitter?: string;
}

interface SubmissionsResult {
  session: number;
  total: number;
  results: Submission[];
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

  async searchSequences(q: string, limit?: number, skip?: number, shuffle?: boolean): Promise<{ total: number; results: { id: string; name: string; keywords?: string[] }[] }> {
    const params = new URLSearchParams({ q });
    if (limit !== undefined) params.append('limit', String(limit));
    if (skip !== undefined) params.append('skip', String(skip));
    if (shuffle !== undefined) params.append('shuffle', String(shuffle));
    // The API returns { total, results: [{id, name, keywords?}] }
    return this.makeRequest(`/sequences/search?${params.toString()}`);
  }

  async getProgram(id: string): Promise<ProgramDetails> {
    return this.makeRequest(`/programs/${id}`);
  }

  async searchPrograms(q: string, limit?: number, skip?: number, shuffle?: boolean): Promise<{ total: number; results: { id: string; name: string; keywords?: string[] }[] }> {
    const params = new URLSearchParams({ q });
    if (limit !== undefined) params.append('limit', String(limit));
    if (skip !== undefined) params.append('skip', String(skip));
    if (shuffle !== undefined) params.append('shuffle', String(shuffle));
    // The API returns { total, results: [{id, name, keywords?}] }
    return this.makeRequest(`/programs/search?${params.toString()}`);
  }

  async evalProgram(code: string, t?: number, o?: number): Promise<Result> {
    const params = new URLSearchParams();
    if (t !== undefined) params.append('t', String(t));
    if (o !== undefined) params.append('o', String(o));
    return this.makeRequest(`/programs/eval${params.size ? '?' + params.toString() : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
    });
  }

  async exportProgram(code: string, format?: string): Promise<ExportResult> {
    const params = new URLSearchParams();
    if (format !== undefined) params.append('format', format);
    return this.makeRequest(`/programs/export${params.size ? '?' + params.toString() : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
    });
  }

  async getSubmissions(limit?: number, skip?: number, mode?: string, type?: string, submitter?: string): Promise<SubmissionsResult> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.append('limit', String(limit));
    if (skip !== undefined) params.append('skip', String(skip));
    if (mode !== undefined) params.append('mode', mode);
    if (type !== undefined) params.append('type', type);
    if (submitter !== undefined) params.append('submitter', submitter);
    return this.makeRequest(`/submissions${params.size ? '?' + params.toString() : ''}`);
  }

  async createSubmission(submission: Submission): Promise<{ status: string; message: string }> {
    return this.makeRequest('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    });
  }

  async getStats(): Promise<StatsSummary> {
    return this.makeRequest('/stats/summary');
  }

  async getKeywords(): Promise<{ name: string; description: string; numPrograms: number; numSequences: number }[]> {
    return this.makeRequest('/stats/keywords');
  }

  async getSubmitters(): Promise<Submitter[]> {
    return this.makeRequest('/stats/submitters');
  }

  async getUsageStats(): Promise<{ id: string; numUsages: number }[]> {
    return this.makeRequest('/stats/programs/numUsages');
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
            name: "get_program_details",
            description:
              "Retrieve detailed information about a LODA program for an integer sequence. The response includes: id, name, code (plain text), submitter, keywords, operations, formula (if available), and usages (IDs of programs that use this one via seq). The ID must match the sequence (e.g., A000045).",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "ID of the LODA program (e.g. A000045)" }
              },
              required: ["id"],
              additionalProperties: false
            }
          },
          {
            name: "search_programs",
            description:
              "Search for LODA programs using flexible criteria. Supports pagination.\n" +
              "\nSupported search criteria:\n" +
              "- Name: Matches tokens in the program name (case-insensitive).\n" +
              "- ID: Matches tokens in the program ID (e.g., A000045).\n" +
              "- Keywords: Include keywords by specifying them in the query (e.g., 'core easy'). Exclude keywords by prefixing with a minus sign (e.g., '-hard').\n" +
              "- Operation Types: Include operation types (opcodes) to match in the LODA program (e.g., `mov add`). Exclude operation types by prefixing with a minus sign (e.g., `-mul`).\n" +
              "- Submitter: Matches tokens in the submitter's name (case-insensitive).\n" +
              "- Advanced: All tokens in the query must be present in either the program name or submitter name. Keywords and operation types are handled as described above.\n" +
              "\nExample queries:\n" +
              "- 'Fibonacci core' (programs with 'Fibonacci' in the name and the 'core' keyword)\n" +
              "- 'A000045' (program with ID A000045)" +
              "- 'Alice' (programs submitted by Alice)\n" +
              "- '-hard' (exclude programs with the 'hard' keyword)\n" +
              "- 'bin' (include programs with 'bin' operations)\n",
            inputSchema: {
              type: "object",
              properties: {
                q: { type: "string", description: "Search query supporting keywords, properties, submitters, and advanced criteria. To require a keyword, include it; to exclude, prefix with '-' (e.g., -core)." },
                limit: { type: "number", description: "Maximum number of results to return (pagination limit)", minimum: 1, maximum: 100 },
                skip: { type: "number", description: "Number of items to skip before starting to collect the result set (pagination offset)", minimum: 0 },
                shuffle: { type: "boolean", description: "If set to true, the search results will be shuffled randomly" }
              },
              required: ["q"],
              additionalProperties: false
            }
          },
          {
            name: "eval_program",
            description: "Evaluate a LODA program to generate the corresponding integer sequence. The request body should contain the program code in plain text format. Optionally specify the number of terms and offset.",
            inputSchema: {
              type: "object",
              properties: {
                code: { type: "string", description: "LODA program code in plain text format." },
                t: { type: "number", description: "Number of terms to compute" , minimum: 1, maximum: 10000 },
                o: { type: "number", description: "The starting index (offset) for evaluating the sequence program. Overrides #offset directive or defaults to 0." }
              },
              required: ["code"],
              additionalProperties: false
            }
          },
          {
            name: "export_program",
            description: "Export a LODA program to different formats (formula, pari, lean, loda, range). The default format is 'formula'.",
            inputSchema: {
              type: "object",
              properties: {
                code: { type: "string", description: "LODA program code in plain text format." },
                format: { type: "string", description: "Export format: formula, pari, lean, loda, or range. Default is 'formula'.", enum: ["formula", "pari", "lean", "loda", "range"] }
              },
              required: ["code"],
              additionalProperties: false
            }
          },
          {
            name: "get_submissions",
            description: "Retrieve a paginated list of submissions. Returns all submissions including programs, sequences, and b-file removal requests with support for pagination and filtering by mode (add/update/remove), type (program/sequence/bfile), and submitter.",
            inputSchema: {
              type: "object",
              properties: {
                limit: { type: "number", description: "Maximum number of results to return (pagination limit)", minimum: 1, maximum: 100 },
                skip: { type: "number", description: "Number of items to skip before starting to collect the result set (pagination offset)", minimum: 0 },
                mode: { type: "string", description: "Filter submissions by mode", enum: ["add", "update", "remove"] },
                type: { type: "string", description: "Filter submissions by object type", enum: ["program", "sequence", "bfile"] },
                submitter: { type: "string", description: "Filter submissions by submitter name" }
              },
              additionalProperties: false
            }
          },
          {
            name: "submit",
            description: "Submit a new program, sequence, or b-file removal request. Currently program submissions and b-file removal requests are supported. Submission modes: add (new program/sequence), update (modify existing), remove (delete program/sequence/b-file). Object types: program (LODA program), sequence (integer sequence - not yet supported), bfile (OEIS b-file removal request - only 'remove' mode allowed). Note: content is not required when mode is 'remove' or type is 'bfile'.",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "ID of the program, sequence, or b-file (e.g. A000045)" },
                submitter: { type: "string", description: "(Optional) Name of the person submitting" },
                content: { type: "string", description: "Content of the submission (program code or sequence data). Not required when mode is 'remove' or type is 'bfile'." },
                mode: { type: "string", description: "Type of submission operation", enum: ["add", "update", "remove"] },
                type: { type: "string", description: "Type of object being submitted. B-files only support 'remove' mode.", enum: ["program", "sequence", "bfile"] }
              },
              required: ["id", "mode", "type"],
              additionalProperties: false
            }
          },
          {
            name: "get_sequence",
            description: "Retrieve detailed information about an integer sequence, including its terms, references, links, and keywords. The ID must match the sequence (e.g. A000045).",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "ID of the integer sequence (e.g. A000045)" }
              },
              required: ["id"],
              additionalProperties: false
            }
          },
          {
            name: "search_sequences",
            description:
              "Search for integer sequences using flexible criteria. Supports pagination.\n" +
              "\nSupported search criteria:\n" +
              "- Name: Matches tokens in the sequence name (case-insensitive).\n" +
              "- ID: Matches tokens in the sequence ID (e.g., A000045).\n" +
              "- Keywords: Include keywords by specifying them in the query (e.g., 'core easy'). Exclude keywords by prefixing with a minus sign (e.g., '-hard').\n" +
              "- Operation Types: Include operation types (opcodes) of the corresponding LODA program (e.g., `mov add`). Exclude operation types by prefixing with a minus sign (e.g., `-mul`).\n" +
              "- Author: Matches tokens in the author names (case-insensitive).\n" +
              "- Submitter: Matches tokens in the submitter names of the corresponding LODA programs (case-insensitive).\n" +
              "- Advanced: All tokens in the query must be present in either the sequence name, author name, or submitter name. Keywords are handled as described above.\n" +
              "\nExample queries:\n" +
              "- 'Fibonacci core' (sequences with 'Fibonacci' in the name and the 'core' keyword)\n" +
              "- 'A000045' (sequence with ID A000045)" +
              "- 'Alice' (sequences authored by Alice or with programs submitted by Alice)\n" +
              "- '-hard' (exclude sequences with the 'hard' keyword)\n",
            inputSchema: {
              type: "object",
              properties: {
                q: { type: "string", description: "Search query supporting keywords, properties, submitters, and advanced criteria. To require a keyword, include it; to exclude, prefix with '-' (e.g., -core)." },
                limit: { type: "number", description: "Maximum number of results to return (pagination limit)", minimum: 1, maximum: 100 },
                skip: { type: "number", description: "Number of items to skip before starting to collect the result set (pagination offset)", minimum: 0 },
                shuffle: { type: "boolean", description: "If set to true, the search results will be shuffled randomly" }
              },
              required: ["q"],
              additionalProperties: false
            }
          },
          {
            name: "get_stats",
            description: "Returns stats of the LODA project. This includes the number of sequences, programs, and formulas in the database.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false }
          },
          {
            name: "get_keywords",
            description: "Returns a list of all keywords with their descriptions.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false }
          },
          {
            name: "get_submitters",
            description: "Returns a list of all submitters with their number of submitted programs.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false }
          },
          {
            name: "get_usage_stats",
            description: "Returns a list of all programs and the number of other programs that use them (calls via seq).",
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
          case "get_program_details":
            return this.handleGetProgramDetails(safeArgs as { id: string });
          case "search_programs":
            return this.handleSearchPrograms(safeArgs as { q: string; limit?: number; skip?: number; shuffle?: boolean });
          case "eval_program":
            return this.handleEvalProgram(safeArgs as { code: string; t?: number; o?: number });
          case "export_program":
            return this.handleExportProgram(safeArgs as { code: string; format?: string });
          case "get_submissions":
            return this.handleGetSubmissions(safeArgs as { limit?: number; skip?: number; mode?: string; type?: string; submitter?: string });
          case "submit":
            return this.handleSubmit(safeArgs as { id: string; submitter: string; content: string; mode: string; type: string });
          case "get_sequence":
            return this.handleGetSequence(safeArgs as { id: string });
          case "search_sequences":
            return this.handleSearchSequences(safeArgs as { q: string; limit?: number; skip?: number; shuffle?: boolean });
          case "get_stats":
            return this.handleGetStats();
          case "get_keywords":
            return this.handleGetKeywords();
          case "get_submitters":
            return this.handleGetSubmitters();
          case "get_usage_stats":
            return this.handleGetUsageStats();
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
          text: `Sequence ${seq.id}: ${seq.name}\n` +
            `First terms: ${seq.terms.slice(0, 20).join(', ')}${seq.terms.length > 20 ? '...' : ''}\n` +
            (seq.keywords ? `Keywords: ${seq.keywords.join(', ')}\n` : '') +
            (Array.isArray((seq as any).authors) && (seq as any).authors.length ? `Authors: ${(seq as any).authors.join(', ')}\n` : '') +
            (seq.oeisRef ? `OEIS: ${seq.oeisRef}\n` : '')
        }
      ]
    };
  }

  private async handleSearchSequences(args: { q: string; limit?: number; skip?: number; shuffle?: boolean }) {
    const { q, limit, skip, shuffle } = args;
    if (!q || typeof q !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "q is required");
    }
    const result = await this.apiClient.searchSequences(q, limit, skip, shuffle);
    return {
      content: [
        {
          type: "text",
          text: result.results.length === 0 ?
            'No sequences found.' :
            result.results.map((r: {id: string, name: string, keywords?: string[]}) =>
              `${r.id}: ${r.name}` + (r.keywords && r.keywords.length ? ` [${r.keywords.join(', ')}]` : '')
            ).join('\n') +
            `\nTotal: ${result.total}`
        }
      ],
      ...result
    };
  }

  private async handleGetProgramDetails(args: { id: string }) {
    const { id } = args;
    if (!/^A\d{6,}$/.test(id)) {
      throw new McpError(ErrorCode.InvalidParams, "id must be a string like A000045");
    }
    const prog = await this.apiClient.getProgram(id);
    let text = `LODA Program ${prog.id}: ${prog.name}\n` +
      `Submitter: ${prog.submitter || 'unknown'}\n` +
      `Code:\n${prog.code}`;
    if (Array.isArray(prog.usages) && prog.usages.length > 0) {
      text += `\nUsages: ${prog.usages.join(', ')}`;
    }
    return {
      content: [
        {
          type: "text",
          text
        }
      ],
      usages: prog.usages
    };
  }

  private async handleSearchPrograms(args: { q: string; limit?: number; skip?: number; shuffle?: boolean }) {
    const { q, limit, skip, shuffle } = args;
    if (!q || typeof q !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "q is required");
    }
    const result = await this.apiClient.searchPrograms(q, limit, skip, shuffle);
    return {
      content: [
        {
          type: "text",
          text: result.results.length === 0 ?
            'No programs found.' :
            result.results.map((r: {id: string, name: string, keywords?: string[]}) =>
              `${r.id}: ${r.name}` + (r.keywords && r.keywords.length ? ` [${r.keywords.join(', ')}]` : '')
            ).join('\n') +
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
          text:
            result.status === "success"
              ? `Result: ${result.terms.join(', ')}`
              : `Error: ${result.message}${result.terms && result.terms.length ? `\nPartial result: ${result.terms.join(', ')}` : ''}`
        }
      ],
      ...result
    };
  }

  private async handleExportProgram(args: { code: string; format?: string }) {
    const { code, format } = args;
    if (!code || typeof code !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "code is required");
    }
    const result = await this.apiClient.exportProgram(code, format);
    return {
      content: [
        {
          type: "text",
          text:
            result.status === "success"
              ? `Export result (${format || 'formula'}):\n${result.output}`
              : `Error: ${result.message}`
        }
      ],
      ...result
    };
  }

  private async handleGetSubmissions(args: { limit?: number; skip?: number; mode?: string; type?: string; submitter?: string }) {
    const { limit, skip, mode, type, submitter } = args;
    const result = await this.apiClient.getSubmissions(limit, skip, mode, type, submitter);
    return {
      content: [
        {
          type: "text",
          text: result.results.length === 0
            ? 'No submissions found.'
            : result.results.map((s: Submission) => {
                const submitterText = s.submitter ? ` by ${s.submitter}` : '';
                const contentPreview = s.content ? `:\n${s.content.slice(0, 100)}${s.content.length > 100 ? '...' : ''}` : '';
                return `${s.id} (${s.mode}/${s.type})${submitterText}${contentPreview}`;
              }).join('\n\n') +
              `\n\nTotal: ${result.total}, Session: ${new Date(result.session * 1000).toISOString()}`
        }
      ],
      ...result
    };
  }

  private async handleSubmit(args: { id: string; submitter?: string; content?: string; mode: string; type: string }) {
    const { id, submitter, content, mode, type } = args;
    if (!/^[A-Z]\d{1,10}$/.test(id)) {
      throw new McpError(ErrorCode.InvalidParams, "id must be a string like A000045");
    }
    if (!['add', 'update', 'remove'].includes(mode)) {
      throw new McpError(ErrorCode.InvalidParams, "mode must be 'add', 'update', or 'remove'");
    }
    if (!['program', 'sequence', 'bfile'].includes(type)) {
      throw new McpError(ErrorCode.InvalidParams, "type must be 'program', 'sequence', or 'bfile'");
    }
    // B-files only support remove mode
    if (type === 'bfile' && mode !== 'remove') {
      throw new McpError(ErrorCode.InvalidParams, "bfile type only supports 'remove' mode");
    }
    // Content is required for add and update, but not for remove or bfile
    if (mode !== 'remove' && type !== 'bfile' && (!content || typeof content !== 'string')) {
      throw new McpError(ErrorCode.InvalidParams, "content is required for add and update operations");
    }
    const submission: Submission = {
      id,
      mode: mode as "add" | "update" | "remove",
      type: type as "program" | "sequence" | "bfile"
    };
    if (submitter !== undefined) submission.submitter = submitter;
    if (content !== undefined) submission.content = content;
    const result = await this.apiClient.createSubmission(submission);
    return {
      content: [
        {
          type: "text",
          text:
            result.status === "success"
              ? `Submission successful for ${id} (${mode}/${type})`
              : `Error: ${result.message}`
        }
      ],
      ...result
    };
  }

  private async handleGetStats() {
    const stats = await this.apiClient.getStats();
    return {
      content: [
        {
          type: "text",
          text: `Stats: Sequences=${stats.numSequences}, Programs=${stats.numPrograms}, Formulas=${stats.numFormulas}`
        }
      ]
    };
  }

  private async handleGetKeywords() {
    const keywords = await this.apiClient.getKeywords();
    return {
      content: [
        {
          type: "text",
          text: keywords.length === 0
            ? 'No keywords found.'
            : keywords.map(k =>
                `${k.name}: ${k.description}\n  Programs: ${k.numPrograms}, Sequences: ${k.numSequences}`
              ).join('\n')
        }
      ],
      keywords
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

  private async handleGetUsageStats() {
    // API returns array of { id: string, numUsages: number }
    const usages = await this.apiClient.getUsageStats();
    return {
      content: [
        {
          type: "text",
          text: usages.length === 0
            ? 'No program usages found.'
            : usages.map((u: {id: string, numUsages: number}) => `${u.id}: ${u.numUsages} usages`).join('\n')
        }
      ],
      usages
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

    app.post('/v2/mcp', async (req, res) => {
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
    app.get('/v2/mcp', handleSessionRequest);
    app.delete('/v2/mcp', handleSessionRequest);
      app.listen(port, () => {
        console.error(`LODA MCP server v2.0.0 running on http://localhost:${port}/v2/mcp`);
      }).on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Error: Port ${port} is already in use or the server is already running.`);
          process.exit(1);
        } else {
          console.error('Server error:', err);
          process.exit(1);
        }
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