# Code Generation Layer Module Guide

This directory defines a plug-in interface for code generation modules. A module can use any implementation backend (CLI tool, API, SDK) as long as it implements the shared contract.

## Directory Layout

```text
src/layers/code-gen/
├── interface.ts
├── lib/                  (shared helpers: prompts, plan, file-manifest, etc.)
├── modules/
│   ├── claude-api/
│   │   └── index.ts      (Anthropic API path; per-file text prompts)
│   ├── claude-code-cli/
│   │   ├── index.ts      (real tool-using agent module)
│   │   ├── cli-driver.ts (spawn CLI with native tools enabled)
│   │   ├── workspace.ts  (git snapshot / diff-capture / rollback)
│   │   └── prompts.ts    (execute-phase prompt builder)
│   └── opencode/
│       └── index.ts      (stub: throws Not yet implemented)
└── registry.ts
```

## Module Contract

Implement the `CodeGenModule` interface from `interface.ts`:

- `name`: Provider key used by registry lookups.
- `version`: Module version for traceability.
- `generate(input)`: Produces generated files and a short explanation.
- `validate()`: Optional health check (API key, CLI availability, etc.).

## How To Add A Module

1. Create a module directory at `src/layers/code-gen/modules/<module-name>/`.
2. Implement and export a `CodeGenModule` from `index.ts`.
3. Register the module in `createDefaultCodeGenRegistry()` in `registry.ts`.
4. Add unit tests under `test/layers/code-gen/`.
5. If needed, document provider aliases in `PROVIDER_ALIAS_MAP`.

## Selecting a code-gen module

Two production modules:

- **`CODE_GEN_MODULE=claude-code-cli`** (default; alias: `claude-cli`). Uses the Claude Code CLI binary as a tool-using agent. Requires the `claude` binary on `$PATH` and a Claude MAX subscription. Strategy: spawns the CLI with native `Read/Write/Edit/Grep/Glob` tools enabled; the CLI plans and edits files in cht-core directly. The module snapshots the workspace via `git stash`, captures the CLI's diff, and routes the captured files through the existing staging path (HC2 preview, `writeToChtCore` on approval). Good fit for multi-file refactors with cross-file dependencies. Production default since v6.

- **`CODE_GEN_MODULE=claude-api`** (fallback). Uses the Anthropic API directly. Requires `ANTHROPIC_API_KEY`. Strategy: text-prompt + per-file LLM calls with diff/whole-file output. Good fit when no Claude Code CLI binary is available (CI environments, contributors without the CLI installed). The module is hard-pinned to the Anthropic SDK; it refuses to run when `LLM_PROVIDER=claude-cli` is set.

The registry resolves the module from:

1. Explicit provider passed to `getActiveModule(provider)`
2. `CODE_GEN_MODULE` environment variable
3. Default fallback: `claude-code-cli`

Aliases:

- `anthropic` -> `claude-api`
- `claude-cli` -> `claude-code-cli`

`LLM_PROVIDER` controls the LLM transport for **non-code-gen** consumers (research supervisor, validation node, test environment, domain inference). It does NOT affect code-gen module selection. Set `LLM_PROVIDER=claude-cli` to use the CLI as a text oracle for those other paths; set `CODE_GEN_MODULE=claude-code-cli` to use the CLI for code generation specifically. The two env vars are independent.

## Testing Guidance

- Use unit tests for deterministic logic (registry selection, file assembly, validation checks).
- Keep integration/e2e tests for real LLM calls in separate suites.
- Ensure generated outputs are deterministic where possible.
