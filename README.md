# LODA MCP Server

A Model Context Protocol (MCP) server for the LODA Language API, providing seamless access to the LODA language and integer sequences from the On-Line Encyclopedia of Integer Sequences® (OEIS®).


## 🌟 Overview

**LODA** (_Lexicographical Order Descent Assembly_) is an assembly language and computational model for integer sequences. This MCP server enables you to:

- 🔍 **Explore integer sequences** with rich metadata and formatting
- 🔧 **Discover LODA programs** that compute specific sequences  
- ⚡ **Execute programs** in real-time and compute sequence terms
- 📊 **Monitor project statistics**

## ✨ Features


### Core Capabilities

- **OEIS-style Sequence Integration**: Access any sequence with A-number formatting
- **Program Discovery**: Find and search LODA programs for sequences
- **Real-time Execution**: Run LODA programs and see results instantly
- **Robust Error Handling**: Comprehensive validation and error messages

### Available Tools

| Tool | Description | Primary Use Case |
|------|-------------|------------------|
| `get_program` | Get details about a LODA program by ID | Analyze program implementations |
| `search_programs` | Search for LODA programs | Find programs by keyword or ID |
| `eval_program` | Evaluate a LODA program | Test and validate program correctness |
| `submit_program` | Submit a new LODA program | Contribute new implementations |
| `get_sequence` | Get details about an integer sequence by ID | Research mathematical sequences |
| `search_sequences` | Search for integer sequences | Find sequences by keyword or ID |
| `get_stats` | View LODA project summary statistics | Understand project scope and growth |
| `get_keywords` | List all keywords and their descriptions | Explore available keywords |
| `get_submitters` | List all submitters and their number of programs | See top contributors |

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** 8.0.0 or higher

### Installation

1. **Install dependencies**:

   ```bash
   npm install
   ```
2. **Build the server**:

   ```bash
   npm run build
   ```

3. **Test the installation**:

   ```bash
   npm run test-connection  # Test API connectivity
   npm start                # Start the server
   ```

### Development Workflow

```bash
# Development with auto-rebuild
npm run dev

# Type checking
npm run type-check

# Clean build
npm run clean && npm run build
```

## ⚙️ Configuration

### Claude Desktop Integration

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "loda-api": {
      "command": "node",
      "args": ["/absolute/path/to/your/loda-mcp/build/index.js"],
      "env": {
        "LODA_API_BASE_URL": "https://api.loda-lang.org/v2"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LODA_API_BASE_URL` | LODA API endpoint override | `https://api.loda-lang.org/v2` |

## 📖 Usage Examples

### 🔢 Exploring OEIS Sequences

```
"Show me details about OEIS sequence 45"
→ Gets Fibonacci sequence (A000045) with full metadata

"What is OEIS sequence 1?"  
→ Gets A000001 (groups of order n) with terms and description
```

### 🔧 Working with LODA Programs

```
"Find all LODA programs for sequence 45"
→ Shows all programs that compute Fibonacci numbers, sorted by length

"Get LODA program 12345"
→ Retrieves specific program with code and metadata
```

### ⚡ Running Programs

```
"Run this LODA program and compute 10 terms:
mov $0,1
lpb $1
  add $0,$1
  sub $1,1
lpe"
→ Executes program and shows computed sequence values
```

### ⛏️ Mining New Programs

```
"Start mining programs for OEIS sequence 142857 with max length 50"
→ Begins mining operation and returns operation ID

"Check status of mining operation 987"  
→ Shows current status and any discovered programs
```

### 📊 Project Statistics

```
"What are the current LODA project statistics?"
→ Shows number of sequences, programs, and contributors
```

## 🔧 API Reference


### Tool Schemas

All tools use strict JSON schemas with proper validation. Example schemas:

#### `get_sequence`
```json
{
  "id": "A000045"
}
```

#### `search_sequences`
```json
{
  "q": "Fibonacci",
  "limit": 5
}
```

#### `get_program`
```json
{
  "id": "A000045"
}
```

#### `search_programs`
```json
{
  "q": "Fibonacci",
  "limit": 5
}
```

#### `eval_program`
```json
{
  "code": "mov $1,10\npow $1,$0\nmov $0,$1\ndiv $0,9",
  "t": 10
}
```

#### `submit_program`
```json
{
  "id": "A000045",
  "code": "mov $2,1\nlpb $0\n  sub $0,2\n  add $2,$1\n  add $1,$2\nlpe\nmul $0,$2\nadd $0,$1"
}
```


#### `get_stats`
```json
{}
```

#### `get_keywords`
```json
{}
```

#### `get_submitters`
```json
{}
```

### Response Format

All responses include:

- **Rich formatting** with emojis and visual structure
- **Clear status indicators**
- **Contextual information** and helpful tips
- **Proper error messages** with actionable guidance

## 🏗️ Architecture

### Core Components

```
LODAMCPServer
├── LODAApiClient       # HTTP client for LODA API
├── Tool Handlers       # Individual tool implementations  
├── Validation Layer    # Input validation and sanitization
└── Error Management    # Comprehensive error handling
```

### Error Handling Strategy

- **Input Validation**: Strict parameter checking with clear error messages
- **Network Resilience**: Retry logic and connection error handling
- **API Error Translation**: Convert HTTP errors to meaningful user messages
- **Graceful Degradation**: Partial results when possible

## 🔍 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **Server won't start** | Check Node.js version (18+), verify build completed |
| **API connection failed** | Test with `npm run test-connection`, check firewall |
| **Tool not found** | Verify tool name spelling, check MCP client connection |
| **Invalid parameters** | Check parameter types match schema exactly |
| **Mining timeout** | Use shorter max_runtime, check sequence exists |

### Debug Mode

```bash
# Enable verbose logging
DEBUG=* npm start

# Test specific tool
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_stats_summary","arguments":{}},"id":1}' | npm start
```

### Health Checks

```bash
# Test API connectivity
npm run test-connection

# Verify tool listing  
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | npm start
```

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make changes with proper TypeScript types
4. Test thoroughly: `npm run type-check`
5. Submit a pull request

### Code Standards

- **TypeScript**: Strict mode with full type coverage
- **Error Handling**: Always use McpError for user-facing errors
- **Validation**: Validate all inputs before API calls  
- **Documentation**: Clear JSDoc comments for public methods
- **Formatting**: Consistent emoji usage and output structure

## 🔗 Resources

- [LODA Language Website](https://loda-lang.org/) - Official LODA project
- [OEIS Website](https://oeis.org/) - The On-Line Encyclopedia of Integer Sequences
- [MCP Specification](https://modelcontextprotocol.io/) - Model Context Protocol docs
- [LODA API Documentation](https://api.loda-lang.org/v2/openapi.yaml) - OpenAPI specification


## 📄 API Endpoints

Based on the official OpenAPI v2 specification:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sequences/{id}` | GET | Get integer sequence details |
| `/sequences/search` | GET | Search integer sequences |
| `/programs/{id}` | GET | Get LODA program details |
| `/programs/search` | GET | Search LODA programs |
| `/programs/eval` | POST | Evaluate a LODA program |
| `/programs/{id}/submit` | POST | Submit a new LODA program |
| `/stats/summary` | GET | Get statistics summary |
| `/stats/submitters` | GET | List all submitters |

## 📝 License

Apache 2.0

## 🙏 Acknowledgments

- **LODA Project Team** - For creating this amazing mathematical tool
- **OEIS Contributors** - For maintaining the world's most important sequence database  
- **MCP Community** - For the excellent protocol and SDK
- **Mathematical Community** - For continuous sequence discoveries and research

---

**Made with ❤️ for mathematical discovery and algorithmic research**
