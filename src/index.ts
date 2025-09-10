#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
interface OEISSequence {
  id: number;
  name: string;
  data: number[];
  offset: number;
  author?: string;
  keyword?: string;
  comment?: string;
  reference?: string;
  link?: string;
  formula?: string;
  example?: string;
  maple?: string;
  mathematica?: string;
  program?: string;
  crossrefs?: string;
  ext?: string;
  created?: string;
  changed?: string;
}

interface Program {
  id: number;
  oeis_id: number;
  code: string;
  length: number;
  status: "ok" | "timeout" | "error" | "unknown";
  created?: string;
  changed?: string;
}

interface ProgramRunRequest {
  program: string;
  num_terms: number;
}

interface ProgramRunResponse {
  values: number[];
  status: "ok" | "timeout" | "error";
  message?: string;
}

interface MineRequest {
  oeis_id: number;
  max_length?: number;
  max_runtime?: number;
}

interface MineResponse {
  id: number;
  status: "pending" | "running" | "completed" | "failed";
  program?: string;
  length?: number;
  message?: string;
}

interface StatsSummary {
  numSequences: number;
  numPrograms: number;
  numFormulas: number;
}

/**
 * LODA API Client - handles all communication with the LODA API
 */
class LODAApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = LODA_API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make HTTP request to LODA API with proper error handling
   */
  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const defaultOptions: RequestInit = {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
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
        } catch (e) {
          // Ignore error body parsing issues
        }
        
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
      if (error instanceof McpError) {
        throw error;
      }
      
      // Network or parsing errors
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

  /**
   * Get OEIS sequence information by ID
   */
  async getOEISSequence(oeisId: number): Promise<OEISSequence> {
    return this.makeRequest(`/oeis/${oeisId}`);
  }

  /**
   * Get LODA program by ID
   */
  async getProgram(programId: number): Promise<Program> {
    return this.makeRequest(`/programs/${programId}`);
  }

  /**
   * Get all programs that compute a specific OEIS sequence
   */
  async getProgramsForSequence(oeisId: number): Promise<Program[]> {
    return this.makeRequest(`/oeis/${oeisId}/programs`);
  }

  /**
   * Run a LODA program and compute sequence terms
   */
  async runProgram(program: string, numTerms: number = 20): Promise<ProgramRunResponse> {
    const requestBody: ProgramRunRequest = {
      program: program.trim(),
      num_terms: numTerms
    };

    return this.makeRequest('/programs/run', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  }

  /**
   * Start a mining operation to find programs for a sequence
   */
  async startMining(oeisId: number, maxLength?: number, maxRuntime?: number): Promise<MineResponse> {
    const requestBody: MineRequest = { oeis_id: oeisId };
    if (maxLength !== undefined) requestBody.max_length = maxLength;
    if (maxRuntime !== undefined) requestBody.max_runtime = maxRuntime;

    return this.makeRequest('/mine', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  }

  /**
   * Get the status of a mining operation
   */
  async getMiningStatus(mineId: number): Promise<MineResponse> {
    return this.makeRequest(`/mine/${mineId}`);
  }

  /**
   * Get LODA project statistics
   */
  async getStatsSummary(): Promise<StatsSummary> {
    return this.makeRequest('/stats/summary');
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
        version: "1.0.0",
        description: "MCP server for LODA Language API - mine and compute integer sequences from OEIS"
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

  /**
   * Set up MCP tool handlers
   */
  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_oeis_sequence",
            description: "Get detailed information about a specific OEIS sequence by numeric ID",
            inputSchema: {
              type: "object",
              properties: {
                oeis_id: {
                  type: "number",
                  description: "OEIS sequence ID as a number (e.g., 1 for A000001, 45 for A000045 Fibonacci)",
                  minimum: 0
                }
              },
              required: ["oeis_id"],
              additionalProperties: false
            }
          },
          {
            name: "get_program",
            description: "Retrieve a specific LODA program by its numeric ID",
            inputSchema: {
              type: "object",
              properties: {
                program_id: {
                  type: "number",
                  description: "LODA program ID as a number",
                  minimum: 1
                }
              },
              required: ["program_id"],
              additionalProperties: false
            }
          },
          {
            name: "get_programs_for_sequence",
            description: "Find all LODA programs that compute a specific OEIS sequence",
            inputSchema: {
              type: "object",
              properties: {
                oeis_id: {
                  type: "number",
                  description: "OEIS sequence ID to find programs for",
                  minimum: 0
                }
              },
              required: ["oeis_id"],
              additionalProperties: false
            }
          },
          {
            name: "run_program",
            description: "Execute a LODA program and compute sequence terms",
            inputSchema: {
              type: "object",
              properties: {
                program: {
                  type: "string",
                  description: "LODA program source code to execute",
                  minLength: 1
                },
                num_terms: {
                  type: "number",
                  description: "Number of sequence terms to compute (default: 20)",
                  default: 20,
                  minimum: 1,
                  maximum: 1000
                }
              },
              required: ["program"],
              additionalProperties: false
            }
          },
          {
            name: "start_mining",
            description: "Start a mining operation to find LODA programs for a given OEIS sequence",
            inputSchema: {
              type: "object",
              properties: {
                oeis_id: {
                  type: "number",
                  description: "OEIS sequence ID to mine programs for",
                  minimum: 0
                },
                max_length: {
                  type: "number",
                  description: "Maximum program length to search for (optional)",
                  minimum: 1,
                  maximum: 1000
                },
                max_runtime: {
                  type: "number",
                  description: "Maximum runtime in seconds for the mining operation (optional)",
                  minimum: 1,
                  maximum: 3600
                }
              },
              required: ["oeis_id"],
              additionalProperties: false
            }
          },
          {
            name: "get_mining_status",
            description: "Check the status and results of a mining operation",
            inputSchema: {
              type: "object",
              properties: {
                mine_id: {
                  type: "number",
                  description: "Mining operation ID returned from start_mining",
                  minimum: 1
                }
              },
              required: ["mine_id"],
              additionalProperties: false
            }
          },
          {
            name: "get_stats",
            description: "Get current statistics about the LODA project",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false
            }
          }
        ] as Tool[]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        return await this.handleToolCall(name, args);
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        // Enhanced error handling
        let errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMessage.includes('404')) {
          errorMessage = `Resource not found. The requested ${name.replace('get_', '').replace('_', ' ')} may not exist in the LODA database.`;
        } else if (errorMessage.includes('429')) {
          errorMessage = `Rate limit exceeded. Please wait before making another request.`;
        } else if (errorMessage.includes('500')) {
          errorMessage = `LODA API server error. The service may be temporarily unavailable.`;
        } else if (errorMessage.includes('timeout')) {
          errorMessage = `Request timeout. The LODA API may be experiencing high load.`;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${errorMessage}`
        );
      }
    });
  }

  /**
   * Handle individual tool calls
   */
  private async handleToolCall(name: string, args: any): Promise<any> {
    switch (name) {
      case "get_oeis_sequence":
        return this.handleGetOEISSequence(args);
      case "get_program":
        return this.handleGetProgram(args);
      case "get_programs_for_sequence":
        return this.handleGetProgramsForSequence(args);
      case "run_program":
        return this.handleRunProgram(args);
      case "start_mining":
        return this.handleStartMining(args);
      case "get_mining_status":
        return this.handleGetMiningStatus(args);
      case "get_stats":
        return this.handleGetStatsSummary();
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  }

  /**
   * Handle get_oeis_sequence tool
   */
  private async handleGetOEISSequence(args: { oeis_id: number }) {
    const { oeis_id } = args;
    
    if (!Number.isInteger(oeis_id) || oeis_id < 0) {
      throw new McpError(ErrorCode.InvalidParams, "oeis_id must be a non-negative integer");
    }

    const sequence = await this.apiClient.getOEISSequence(oeis_id);
    const oeisFormat = `A${oeis_id.toString().padStart(6, '0')}`;
    
    const formatField = (label: string, value?: string) => value ? `\n${label}: ${value}` : '';
    
    return {
      content: [
        {
          type: "text",
          text: `🔢 OEIS Sequence ${oeisFormat}: ${sequence.name}\n` +
                `${'='.repeat(60)}\n` +
                `📊 First ${Math.min(sequence.data.length, 20)} terms: ${sequence.data.slice(0, 20).join(', ')}${sequence.data.length > 20 ? '...' : ''}\n` +
                `📍 Offset: ${sequence.offset}` +
                formatField('💬 Comment', sequence.comment) +
                formatField('🧮 Formula', sequence.formula) +
                formatField('📚 References', sequence.reference) +
                formatField('🔗 Links', sequence.link) +
                formatField('💡 Examples', sequence.example) +
                formatField('🍁 Maple', sequence.maple) +
                formatField('🔣 Mathematica', sequence.mathematica) +
                formatField('💻 Programs', sequence.program) +
                formatField('🏷️ Keywords', sequence.keyword) +
                formatField('👤 Author', sequence.author) +
                formatField('🔄 Cross-references', sequence.crossrefs) +
                formatField('📅 Created', sequence.created) +
                formatField('📝 Last changed', sequence.changed)
        }
      ]
    };
  }

  /**
   * Handle get_program tool
   */
  private async handleGetProgram(args: { program_id: number }) {
    const { program_id } = args;
    
    if (!Number.isInteger(program_id) || program_id < 1) {
      throw new McpError(ErrorCode.InvalidParams, "program_id must be a positive integer");
    }

    const program = await this.apiClient.getProgram(program_id);
    const oeisFormat = `A${program.oeis_id.toString().padStart(6, '0')}`;
    const statusEmoji = program.status === 'ok' ? '✅' : program.status === 'timeout' ? '⏱️' : program.status === 'error' ? '❌' : '❓';
    
    return {
      content: [
        {
          type: "text",
          text: `🔧 LODA Program ${program_id}\n` +
                `${'='.repeat(50)}\n` +
                `🎯 Target Sequence: ${oeisFormat}\n` +
                `📏 Program Length: ${program.length}\n` +
                `${statusEmoji} Status: ${program.status}\n` +
                (program.created ? `📅 Created: ${program.created}\n` : '') +
                (program.changed ? `📝 Last Changed: ${program.changed}\n` : '') +
                `\n💻 Program Code:\n` +
                `${'─'.repeat(30)}\n` +
                `${program.code}\n` +
                `${'─'.repeat(30)}`
        }
      ]
    };
  }

  /**
   * Handle get_programs_for_sequence tool
   */
  private async handleGetProgramsForSequence(args: { oeis_id: number }) {
    const { oeis_id } = args;
    
    if (!Number.isInteger(oeis_id) || oeis_id < 0) {
      throw new McpError(ErrorCode.InvalidParams, "oeis_id must be a non-negative integer");
    }

    const programs = await this.apiClient.getProgramsForSequence(oeis_id);
    const oeisFormat = `A${oeis_id.toString().padStart(6, '0')}`;
    
    if (programs.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `🔍 No LODA programs found for sequence ${oeisFormat}\n\n` +
                  `This could mean:\n` +
                  `• The sequence hasn't been mined yet\n` +
                  `• No programs have been discovered\n` +
                  `• The sequence ID doesn't exist\n\n` +
                  `💡 Try using start_mining to search for new programs!`
          }
        ]
      };
    }

    // Sort programs by length (shorter is generally better)
    const sortedPrograms = programs.sort((a, b) => a.length - b.length);
    
    let output = `🔧 Found ${programs.length} LODA program(s) for ${oeisFormat}\n` +
                 `${'='.repeat(60)}\n\n`;
    
    sortedPrograms.forEach((program, index) => {
      const statusEmoji = program.status === 'ok' ? '✅' : program.status === 'timeout' ? '⏱️' : program.status === 'error' ? '❌' : '❓';
      output += `${index + 1}. 🆔 Program ${program.id} | 📏 Length: ${program.length} | ${statusEmoji} ${program.status}\n`;
      
      // Show program code for shorter programs
      if (program.code.length < 200) {
        const compactCode = program.code.replace(/\n/g, '; ').substring(0, 150);
        output += `   💻 Code: ${compactCode}${program.code.length > 150 ? '...' : ''}\n`;
      } else {
        output += `   💻 Code: ${program.code.substring(0, 100).replace(/\n/g, '; ')}...\n`;
      }
      output += '\n';
    });

    output += `💡 Use get_program with a specific program_id for full details`;

    return {
      content: [
        {
          type: "text",
          text: output
        }
      ]
    };
  }

  /**
   * Handle run_program tool
   */
  private async handleRunProgram(args: { program: string; num_terms?: number }) {
    const { program, num_terms = 20 } = args;
    
    if (!program || typeof program !== 'string' || program.trim().length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "program must be a non-empty string");
    }
    
    if (!Number.isInteger(num_terms) || num_terms < 1 || num_terms > 1000) {
      throw new McpError(ErrorCode.InvalidParams, "num_terms must be an integer between 1 and 1000");
    }

    const result = await this.apiClient.runProgram(program, num_terms);
    const statusEmoji = result.status === 'ok' ? '✅' : result.status === 'timeout' ? '⏱️' : '❌';
    
    return {
      content: [
        {
          type: "text",
          text: `⚡ LODA Program Execution\n` +
                `${'='.repeat(50)}\n` +
                `${statusEmoji} Status: ${result.status}\n` +
                `📊 Computed ${result.values.length} term(s): ${result.values.join(', ')}\n` +
                (result.message ? `💬 Message: ${result.message}\n` : '') +
                `\n💻 Program executed:\n` +
                `${'─'.repeat(30)}\n` +
                `${program.trim()}\n` +
                `${'─'.repeat(30)}\n\n` +
                (result.status === 'timeout' ? '⚠️ Program execution timed out' : '') +
                (result.status === 'error' ? '❌ Program execution failed' : '') +
                (result.status === 'ok' ? '🎉 Program executed successfully!' : '')
        }
      ]
    };
  }

  /**
   * Handle start_mining tool
   */
  private async handleStartMining(args: { oeis_id: number; max_length?: number; max_runtime?: number }) {
    const { oeis_id, max_length, max_runtime } = args;
    
    if (!Number.isInteger(oeis_id) || oeis_id < 0) {
      throw new McpError(ErrorCode.InvalidParams, "oeis_id must be a non-negative integer");
    }
    
    if (max_length !== undefined && (!Number.isInteger(max_length) || max_length < 1 || max_length > 1000)) {
      throw new McpError(ErrorCode.InvalidParams, "max_length must be an integer between 1 and 1000");
    }
    
    if (max_runtime !== undefined && (!Number.isInteger(max_runtime) || max_runtime < 1 || max_runtime > 3600)) {
      throw new McpError(ErrorCode.InvalidParams, "max_runtime must be an integer between 1 and 3600 seconds");
    }

    const result = await this.apiClient.startMining(oeis_id, max_length, max_runtime);
    const oeisFormat = `A${oeis_id.toString().padStart(6, '0')}`;
    const statusEmoji = result.status === 'pending' ? '⏳' : result.status === 'running' ? '🔄' : result.status === 'completed' ? '✅' : '❌';
    
    return {
      content: [
        {
          type: "text",
          text: `⛏️ Mining Operation Started\n` +
                `${'='.repeat(50)}\n` +
                `🆔 Mine ID: ${result.id}\n` +
                `🎯 Target Sequence: ${oeisFormat}\n` +
                `${statusEmoji} Status: ${result.status}\n` +
                (max_length ? `📏 Max Program Length: ${max_length}\n` : '') +
                (max_runtime ? `⏱️ Max Runtime: ${max_runtime} seconds\n` : '') +
                (result.message ? `💬 Message: ${result.message}\n` : '') +
                (result.program ? `\n🎉 Program Found:\n${'─'.repeat(20)}\n${result.program}\n${'─'.repeat(20)}\n` : '') +
                (result.length ? `📏 Program Length: ${result.length}\n` : '') +
                `\n💡 Use get_mining_status with mine_id ${result.id} to check progress`
        }
      ]
    };
  }

  /**
   * Handle get_mining_status tool
   */
  private async handleGetMiningStatus(args: { mine_id: number }) {
    const { mine_id } = args;
    
    if (!Number.isInteger(mine_id) || mine_id < 1) {
      throw new McpError(ErrorCode.InvalidParams, "mine_id must be a positive integer");
    }

    const result = await this.apiClient.getMiningStatus(mine_id);
    const statusEmoji = result.status === 'pending' ? '⏳' : result.status === 'running' ? '🔄' : result.status === 'completed' ? '✅' : '❌';
    
    return {
      content: [
        {
          type: "text",
          text: `⛏️ Mining Operation ${mine_id} Status\n` +
                `${'='.repeat(50)}\n` +
                `${statusEmoji} Status: ${result.status}\n` +
                (result.message ? `💬 Message: ${result.message}\n` : '') +
                (result.program ? `\n🎉 Program Found:\n${'─'.repeat(30)}\n${result.program}\n${'─'.repeat(30)}\n` : '') +
                (result.length ? `📏 Program Length: ${result.length}\n` : '') +
                '\n' +
                (result.status === 'completed' && result.program ? '🎉 Mining completed successfully!' : '') +
                (result.status === 'running' ? '⏳ Mining operation still running...' : '') +
                (result.status === 'pending' ? '⏳ Mining operation is queued...' : '') +
                (result.status === 'failed' ? '❌ Mining operation failed' : '')
        }
      ]
    };
  }

  /**
   * Handle get_stats tool
   */
  private async handleGetStatsSummary() {
    const stats = await this.apiClient.getStatsSummary();
    
    return {
      content: [
        {
          type: "text",
          text: `📊 LODA Project Statistics\n` +
                `${'='.repeat(50)}\n` +
                `🔢 OEIS Sequences: ${stats.numSequences.toLocaleString()}\n` +
                `🔧 LODA Programs: ${stats.numPrograms.toLocaleString()}\n` +
                `👥 Contributors: ${stats.numFormulas.toLocaleString()}\n` +
                `\n🌟 The LODA project is a distributed effort to mine programs that\n` +
                `compute integer sequences from the OEIS database, contributing to\n` +
                `mathematical research and algorithmic discovery.`
        }
      ]
    };
  }

  /**
   * Start the MCP server
   */
  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("LODA API MCP server v1.0.0 running on stdio");
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
const server = new LODAMCPServer();
server.run().catch((error) => {
  console.error("Failed to run LODA MCP server:", error);
  process.exit(1);
});