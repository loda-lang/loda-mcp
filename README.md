# LODA MCP Server

A Model Context Protocol (MCP) server for the LODA Language API, providing seamless access to the LODA language and integer sequences from the On-Line Encyclopedia of Integer Sequences® (OEIS®).

<a href="https://glama.ai/mcp/servers/@loda-lang/loda-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@loda-lang/loda-mcp/badge" alt="LODA API Server MCP server" />
</a>

## Available Tools

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

## Quick Start

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
   npm start                # Start the server locally
   ```

4. **Run in HTTP server mode**:

   ```bash
   npm start -- -p 8080
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

## Configuration

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