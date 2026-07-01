# CHT Hierarchical Multi-Agent System: Technical POC Plan

## Summary

This document outlines a proof-of-concept for a multi-agent system to assist with CHT development workflows. The approach focuses on packaging configurations for agentic use, leveraging existing tools and managed services where possible.

**Current Phase (POC/Demo)**
- Interface: Command-line tool accepting templated issues
- Processing: Layered architecture with human validation checkpoints
- Output: Validated code solutions with test coverage
- Memory: Markdown-based context files for model portability

**Future Vision**
- Integration with GitHub issues (automated triggering via keywords/tags)
- Non-technical partner support through structured templates
- Full CI/CD pipeline integration
- Potential RAG/Vector DB once context is validated

**Target Audience**: Non-technical community members who can template requests, receive research/code/cost analysis, and engage technical partners for implementation.

---

## Goals & Vision

### Primary Goal
Build a **portable context database** of CHT issues, patterns, and resolutions. This knowledge base:
- Survives model upgrades (Claude 5, 6, etc.)
- Works across different agentic frameworks
- Enables faster, more accurate code generation with CHT-specific patterns

### Design Principles

1. **Any Model**: Easily swap between Claude, GPT, Gemini, local models
2. **Plug-and-Play Layers**: Each layer can use off-the-shelf tools (Kapa AI, Claude Code, GitHub CLI, etc.)
3. **Tool Orchestration Over Reinvention**: Coordinate existing CHT tools (cht-conf, cht-toolbox, npm scripts) rather than building custom validation
4. **Minimal Maintenance**: Prefer managed services where possible
5. **Human-in-the-Loop**: Validation checkpoints ensure quality before code generation and commit

---

## System Architecture

```mermaid
flowchart TB
    CLI[CLI Interface]
    Master[Master Supervisor - Orchestrator]
    Research[Research Supervisor]
    DocLayer[Documentation Access Layer<br/>Kapa AI MCP]
    ContextLayer[Code Context Layer<br/>Local context files]
    HC1{{"HUMAN CHECKPOINT #1<br/>Validate research findings<br/>Approve orchestration plan"}}
    Dev[Development Supervisor]
    CodeGen[Code Generation Layer<br/>Claude Code CLI / Claude API<br/>self-check lint/tsc]
    TestGen[Test Generation Layer<br/>Unit, Integration, E2E tests<br/>self-check lint/tsc]
    Validation[Code Validation Layer<br/>ESLint, tsc, Prettier<br/>deterministic gate + retry]
    Review[LLM Review<br/>score vs requirements / acceptance criteria]
    QA[QA Supervisor]
    TestEnv[Test Environment Layer<br/>build/start/seed CHT instance]
    TestOrch[Test Orchestration Layer<br/>run tests, verify, coverage]
    HC2{{"HUMAN CHECKPOINT #2<br/>Review generated code<br/>Verify test results<br/>Approve for completion"}}

    CLI --> Master
    Master --> Research
    Research --> DocLayer
    Research --> ContextLayer
    DocLayer --> HC1
    ContextLayer --> HC1
    HC1 --> Dev
    Dev --> CodeGen
    Dev --> TestGen
    CodeGen --> Validation
    TestGen --> Validation
    Validation -->|fail| CodeGen
    Validation -->|pass| Review
    Review --> QA
    QA --> TestEnv
    TestEnv --> TestOrch
    TestOrch --> HC2
```

**Key Insight**: The "layers" are not custom agents we build from scratch. They are **configuration points** where we plug in the best available tools and services.

---

## Layer Specifications

### Research Supervisor Layers

#### Documentation Access Layer
**Purpose**: Search and retrieve CHT documentation contextually

| Pluggable Options | Notes |
|-------------------|-------|
| **Kapa AI MCP** (default) | Managed service, auto-updated index, free for CHT |
| Custom RAG | Self-hosted alternative if needed |

#### Code Context Layer
**Purpose**: Provide source code understanding and existing patterns to inform development

| Pluggable Options | Notes |
|-------------------|-------|
| **Local context files** (default) | Markdown-based pattern library (our primary deliverable) |
| CHT Specialist Skills | Pre-configured Claude Code skills for CHT |

> **Note**: Tools like DeepWiki can be used separately to auto-generate code documentation (architecture docs, component diagrams) which can then feed into the context layer.

> **Layer placement update (2026-06-05):** Per the [Test Environment Layer discovery findings](https://github.com/medic/cht-agent/issues/16#issuecomment-4238272374), two layers moved between supervisors and one was added:
> - **Test Environment Layer** moved from Development → **QA Supervisor** (the QA Supervisor needs a running CHT instance to do its work; the Development Supervisor only produces code and tests).
> - **Code Validation Layer** moved from QA → **Development Supervisor** as a deterministic gate that runs *before* an LLM Review step, looping failures back to Code Generation without spending LLM tokens.
> - **LLM Review** added under the Development Supervisor (score generated code against requirements / acceptance criteria).
> - Code Generation and Test Generation agents now **self-check lint/tsc** (like a developer running `npm run lint` before pushing) to catch trivial issues before the gate.

### Development Supervisor Layers

#### Code Generation Layer
**Purpose**: Generate code following CHT patterns and standards. Self-checks lint/tsc before handing off.

| Pluggable Options | Notes |
|-------------------|-------|
| **Claude Code CLI** | Default option, supports MCP and skills |
| **Claude API** | Default option, direct API access for programmatic control |
| OpenCode | Open-source alternative |
| GitHub CLI (Copilot) | Built-in coding agent |
| Cursor / Windsurf | IDE-based alternatives |

#### Test Generation Layer
**Purpose**: Write tests following CHT testing patterns. Self-checks lint/tsc before handing off.

| Test Type | Description | Tools |
|-----------|-------------|-------|
| **Unit Tests** | Test individual functions and modules in isolation | Mocha, Jest, cht-conf-test-harness |
| **Integration Tests** | Test component interactions, API endpoints, database operations | Mocha, backend integration suite |
| **E2E Tests** | Simulate real user workflows, validate complete system | WebdriverIO, headless browser |

Based on [CHT Automated Tests documentation](https://docs.communityhealthtoolkit.org/community/contributing/code/core/automated-tests/).

#### Code Validation Layer
**Purpose**: Static analysis and standards compliance — a deterministic gate run against the generated code before LLM Review. On failure, the structured errors loop back to Code Generation (max retries) without spending LLM tokens. See [Code Validation Layer recommendation](../layer_recommendations/code-validation-layer.md).

| Pluggable Options | Notes |
|-------------------|-------|
| **ESLint** | JavaScript/TypeScript linting (against target project's config) |
| **TypeScript (tsc)** | Type checking against target's per-directory tsconfig |
| **Prettier** | Conditional — only when target project uses it |
| **Shellcheck** | Shell script validation (`.sh` files only) |
| CHT coding standards | Pattern matching against existing code |

#### LLM Review
**Purpose**: Score the generated code against the ticket's requirements and acceptance criteria once it has passed the deterministic Code Validation gate. Only validated code reaches this step.

### QA Supervisor Layers

#### Test Environment Layer
**Purpose**: Provide a live, configured, data-populated CHT instance the QA Supervisor can test against. Deterministic orchestration of existing tools — no LLM. See [Test Environment Layer recommendation](../layer_recommendations/test-environment-layer.md).

| Pluggable Options | Notes |
|-------------------|-------|
| **cht-core `scripts/docker-helper/cht-docker-compose.sh`** | Target repo's own helper — published-version bring-up, network/env/stop/destroy |
| **`npm run local-images`** | Build images from local code changes (hybrid hot-reload for api/sentinel) |
| **cht-conf** | Config compilation/upload, user creation, doc seeding |
| **cht-conf-test-harness** | Config-level tests (tasks/targets/forms) without a full instance |
| **cht-datasource** | Typed read/verify of seeded data |
| CHT API / CouchDB API | Config discovery, data seeding, verification |

#### Test Orchestration Layer
**Purpose**: Run tests and analyze coverage against the environment the Test Environment Layer provides.

| Pluggable Options | Notes |
|-------------------|-------|
| **npm scripts** | All test commands via package.json |
| Mocha/Jest/Karma | Test frameworks |
| **nyc** | Coverage analysis |
| WebdriverIO | E2E testing |

---

## Context Database (Primary Deliverable)

The context database is the core asset that makes the system valuable. It's **markdown-based** for portability across models and tools.

> - Directory structure: [Issue #1](https://github.com/medic/cht-agent/issues/1)
> - Schema definition: [Issue #3](https://github.com/medic/cht-agent/issues/3)

---

## Human-in-the-Loop Checkpoints

### Checkpoint #1: Post-Research

**Purpose**: Validate research accuracy before code generation

**What the user sees**:
- Research summary and key findings
- Proposed approach and estimated complexity
- Risk factors identified
- Similar past implementations found

**User actions**: Approve / Request clarification / Modify plan / Reject

### Checkpoint #2: Post-Implementation

**Purpose**: Review code quality before finalizing

**What the user sees**:
- Files generated
- Test results and coverage
- Requirements checklist
- Performance impact analysis

**User actions**: Approve / Request changes / Run additional tests / Reject

**Note**: An "auto-accept" mode (similar to Claude Code) may be offered for experienced users, with appropriate disclaimers.

---

## Stewardship & AI

This system aligns with CHT's broader AI strategy:

- **CHT-Conf Squad**: A related initiative focusing on configuration assistance for non-technical partners. The context database built here will benefit that effort.
- **Flexible Architecture**: The layered, plug-and-play design means individual components can be upgraded or replaced as the AI ecosystem evolves.
- **Community-First**: The goal is enabling non-technical community members to research, request, and understand features without deep technical knowledge.

**Example User Journey**: A program director (like Loukman from West Africa) templates a feature request → receives research findings and cost estimate → engages a technical partner with full context already prepared.

---

## Implementation Phases

### Phase 1: Foundation
- Set up workflow structure (LangGraph)
- Implement Master Supervisor routing
- Integrate basic npm script runner
- Establish context file structure

### Phase 2: Core Layers
- Integrate Kapa AI MCP (Documentation Access)
- Build Code Context Layer (local context files)
- Build Code Validation Layer (ESLint)
- Create Test Generation and Orchestration Layers

### Phase 3: Intelligence
- Context recall and pattern matching
- Intelligent test selection
- Recommendation engine
- Learning feedback loops

### Phase 4: Integration & Polish
- End-to-end workflow testing
- Performance optimization
- Developer experience refinement
- Documentation

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Code validation accuracy | >95% alignment with manual review |
| Context retrieval relevance | >80% precision for similar issues |
| Response time | <60 seconds for standard validations |
| False positive rate | <5% for recommendations |
| Context reuse rate | >60% for similar issues |

---

## Technical Stack

- **Orchestration**: LangChain JS / LangGraph
- **Models**: Claude (Opus for planning, Sonnet for implementation) - swappable
- **Runtime**: Node.js (>=20.11.0)
- **Language**: TypeScript
- **CHT Integration**: npm scripts, ESLint, Mocha/Jest/Karma, nyc, cht-conf, WebdriverIO
