# CHT-Agent Repository

## System Architecture Overview

```
CLI Interface
    ↓
Master Supervisor (Orchestrator)
├── Research Supervisor
│   ├── Documentation Search Agent
│   └── Context Analysis Agent
│   
├── [HUMAN VALIDATION CHECKPOINT #1]
│   • Validate research findings
│   • Approve orchestration plan
│   
├── Development Supervisor
│   ├── Code Generation Agent
│   └── Test Environment Agent
│   
├── QA Supervisor
│   ├── Code Validation Agent
│   └── Test Orchestration Agent
│   
└── [HUMAN VALIDATION CHECKPOINT #2]
    • Review generated code
    • Verify test results
    • Approve for completion
```

## Core Design Principles

1. **Run with any model**: Easily changeable to any model
2. **Tool Orchestration Over Reinvention**: Agents act as intelligent coordinators of existing CHT tools (cht-conf, cht-toolbox, cht-datasource, cht-docs, npm scripts) rather than implementing custom validation
3. **Context-Based Learning**: Lightweight file-based memory system that mirrors CHT repository structure
4. **Incremental Value Delivery**: Each agent provides immediate value while building knowledge over time
5. **Developer-Friendly Integration**: Seamless integration with existing npm scripts and development workflows

For WIP, you can find more design details [here](https://github.com/Hareet/cht-agent/blob/main/design/CHT%20Hierarchical%20Multi-Agent%20System%20PoC.md)

## Current Status: Research Supervisor POC

The Research Supervisor and its underlying agents have been implemented:

### ✅ Implemented Components

- **Documentation Search Agent**: Searches CHT documentation (currently mocked, will integrate with Kapa.AI MCP server)
- **Context Analysis Agent**: Analyzes past implementations and identifies reusable patterns
- **Research Supervisor**: Orchestrates the research phase using LangGraph workflow

### 📁 Project Structure

```
cht-agent/
├── src/
│   ├── agents/
│   │   ├── documentation-search-agent.ts    # Doc search with mocked MCP
│   │   └── context-analysis-agent.ts        # Context analysis
│   ├── supervisors/
│   │   └── research-supervisor.ts           # LangGraph orchestration
│   ├── types/
│   │   └── index.ts                         # TypeScript interfaces
│   ├── utils/
│   │   └── context-loader.ts                # Context file utilities
│   └── examples/
│       └── research-supervisor-example.ts   # Demo script
├── agent-memory/                            # Context storage (auto-created)
│   ├── domains/                             # Domain contexts
│   ├── workflows/                           # Workflow contexts
│   ├── knowledge-base/                      # Resolved issues
│   └── indices/                             # Lookup tables
└── tickets/                                 # Issue tickets to process
```

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- Anthropic API key

### Installation

```bash
# Install dependencies
npm install

# Create .env file with your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Build the project
npm run build
```

### Running the Example

```bash
# Run the Research Supervisor demo
npm run example:research
```

This will demonstrate the complete research workflow:
1. Documentation Search (using mocked Kapa.AI responses)
2. Context Analysis (analyzing past implementations)
3. Orchestration Plan Generation (creating implementation plan)

### Example Output

The example processes a sample issue and outputs:
- Documentation references found
- Similar past implementations
- Reusable patterns identified
- Implementation phases
- Risk factors
- Effort estimates

## Development

```bash
# Watch mode for development
npm run dev

# Lint code
npm run lint

# Build
npm run build
```

## Next Steps

1. **MCP Integration**: Connect Documentation Search Agent to Kapa.AI MCP server
2. **Context Population**: Populate agent-memory with actual CHT domain contexts
3. **Development Supervisor**: Implement code generation and test environment agents
4. **QA Supervisor**: Implement validation and test orchestration agents
5. **CLI Interface**: Build command-line interface for issue processing

