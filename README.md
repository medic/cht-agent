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