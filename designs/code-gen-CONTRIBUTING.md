# Code Generation Layer Module Guide

This directory defines a plug-in interface for code generation modules. A module can use any implementation backend (CLI tool, API, SDK) as long as it implements the shared contract.

## Directory Layout

```text
src/layers/code-gen/
├── interface.ts
├── modules/
│   ├── claude-api/
│   │   └── index.ts
│   ├── claude-code-cli/
│   └── opencode/
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

## Provider Selection

The registry currently resolves provider from:

1. Explicit provider passed to `getActiveModule(provider)`
2. `LLM_PROVIDER` environment variable
3. Default fallback: `claude-api`

Aliases are supported for backward compatibility:

- `anthropic` -> `claude-api`
- `claude-cli` -> `claude-code-cli`

## Testing Guidance

- Use unit tests for deterministic logic (registry selection, file assembly, validation checks).
- Keep integration/e2e tests for real LLM calls in separate suites.
- Ensure generated outputs are deterministic where possible.
