# CHT-Agent

A hierarchical multi-agent system to assist with CHT development workflows. It uses layered architecture with human validation checkpoints to research, generate, and validate code for CHT issues.

For detailed system design, architecture, and implementation phases, see the [Technical POC Plan](designs/CHT%20Hierarchical%20Multi-Agent%20System%20PoC.md).

## Current Status: Research Supervisor POC

The Research Supervisor and its underlying agents have been implemented:

- **Documentation Access Layer**: Searches CHT documentation (currently mocked, will integrate with Kapa.AI MCP server)
- **Code Context Layer**: Analyzes past implementations and identifies reusable patterns
- **Research Supervisor**: Orchestrates the research phase using LangGraph workflow

## Project Structure

```
cht-agent/
├── src/
│   ├── agents/
│   │   ├── documentation-search-agent.ts    # Documentation Access Layer
│   │   └── context-analysis-agent.ts        # Code Context Layer
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
├── designs/                                 # System design documents
└── tickets/                                 # Issue tickets to process
```

For details on how to structure new issue tickets, see the [Ticket Format Guide](docs/ticket-format.md).

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

## Roadmap

Track progress and upcoming work on the [CHT-Agent Squad Dashboard](https://github.com/orgs/medic/projects/363).

## Development

```bash
# Watch mode for development
npm run dev

# Lint code
npm run lint

# Build
npm run build
```
