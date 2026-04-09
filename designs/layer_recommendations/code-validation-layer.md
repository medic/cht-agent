# Code Validation Layer — Recommendation Document

**Issue:** [medic/cht-agent#17](https://github.com/medic/cht-agent/issues/17)
**Status:** Proposed
**Date:** 2026-03-17

---

## Summary

The Code Validation Layer runs static analysis and standards compliance checks on **generated code** (output from the Code Generation Layer) before presenting it to the user. This document evaluates the available tools, recommends a validation pipeline, categorizes errors, and proposes an implementation approach.

**Recommendation:** Thin wrapper over existing tools (ESLint, TypeScript compiler, Prettier). No custom agent needed. All validation runs against the **target project's** config (e.g. cht-core's ESLint/tsconfig), not cht-agent's own config.

---

## Tool Evaluation

### 1. ESLint + @medic/eslint-config

**The standard linter across all Medic repos.** Both cht-agent and cht-core use `@medic/eslint-config` as their base, which extends `eslint:recommended` and enforces 50+ rules covering style, correctness, and best practices.

**cht-agent setup (`.eslintrc`):**
- Extends `@medic/eslint-config`, `@typescript-eslint/recommended`, `prettier`
- Key rules: `indent: 2`, `no-explicit-any: warn`, `no-unused-vars: error`
- Test overrides: relaxed `no-unused-expressions`, `no-explicit-any`

**cht-core setup (`eslint.config.js`, flat config, ESLint v9+):**
- Same `@medic/eslint-config` base plus additional plugins per directory:
  - `@stylistic/eslint-plugin` for formatting (cht-core does NOT use Prettier)
  - `eslint-plugin-n` for Node.js (api/, sentinel/)
  - `eslint-plugin-compat` for browser compatibility (webapp/)
  - `@angular-eslint` for Angular code (webapp/)
  - `eslint-plugin-jsdoc` for cht-datasource public API docs
  - `eslint-plugin-jasmine`, `eslint-plugin-no-only-tests` for tests
- Per-directory overrides with different strictness levels

**Programmatic usage:** `eslint --format json <files>` returns structured results per file:
```json
{
  "filePath": "/path/to/file.ts",
  "errorCount": 2,
  "warningCount": 1,
  "messages": [
    { "ruleId": "no-undef", "severity": 2, "line": 10, "column": 5, "message": "..." }
  ]
}
```

**Key consideration for generated code:** Generated code must be validated against cht-core's ESLint config, not cht-agent's. Since cht-core will always be cloned locally (it's a prerequisite for cht-agent to function), we run ESLint from within the cht-core directory using its flat config directly. This is the most accurate approach since cht-core's config references project-relative paths and plugins. Support for other target repos (cht-conf, etc.) can be revisited later if needed.

**Verdict:** Essential. First tool in the pipeline.

### 2. TypeScript Compiler (tsc)

**Standard type checker.** cht-agent uses `strict: true` with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. cht-core has multiple tsconfigs per subdirectory (webapp, shared-libs, etc.) with varying strictness.

**Programmatic usage:** `tsc --noEmit` validates types without producing output. Exit code 0 = pass. Errors go to stderr with file, line, column, and error code (e.g. `TS2345`).

**Key consideration for generated code:** Generated `.ts` files need to be type-checked against cht-core's type environment. A file generated for `webapp/src/ts/services/` needs webapp's tsconfig, Angular types, and the project's own type declarations to resolve correctly. Since cht-core is always available locally, we use its per-directory tsconfigs directly.

**`tsc` scope caveat:** cht-core's tsconfigs typically set `rootDir` and `include` to project-relative paths (e.g. `"include": ["src/**/*"]`). Files in a temp directory outside that scope are silently excluded, meaning `tsc` reports 0 errors without actually type-checking anything. To avoid this false negative, we **stage generated files inside the project tree** in a `.gitignored` directory within `rootDir` (e.g. `src/.validation-staging/`). This ensures the existing tsconfig picks them up naturally and that imports, type declarations, and per-directory tsconfig overrides all resolve correctly. The staging directory is cleaned up after validation.

**Verdict:** Essential for TypeScript files. Run after ESLint.

### 3. Prettier

**In cht-agent but NOT in cht-core.** cht-agent uses Prettier (single quotes, 2-space indent, trailing comma es5, 100 char width). cht-core uses `@stylistic/eslint-plugin` for formatting instead.

**Programmatic usage:** `prettier --check <files>` exits 1 if formatting differs. `prettier --write` auto-fixes.

**Key consideration for generated code:** Whether to run Prettier depends entirely on the target project. Generated code for cht-core should NOT be Prettier-formatted (it would conflict with `@stylistic` rules). Generated code for cht-agent or new standalone projects should be.

**Verdict:** Conditional. Run only when target project uses Prettier.

### 4. ShellCheck

**Used in cht-core** via `npm run lint-shell`. CHT deployment involves shell scripts (Docker setup, upgrade scripts, backup scripts).

**Programmatic usage:** `shellcheck --format=json <file>` returns structured output with `level` (error/warning/info/style), `code`, `message`, `line`, `column`.

**Verdict:** Include only when generated files contain `.sh` files. Low priority for initial implementation.

### 5. Custom CHT-Specific Checks

cht-core has custom validation scripts:
- **Blank link check:** `target="_blank"` must have `rel="noopener noreferrer"`
- **Translation linting:** `@medic/translation-checker` validates translation files
- **Version check:** Tag matches `package.json` version

These are relevant only when generating specific file types (HTML with links, translation files). They can be added as optional validators later.

---

## Tool Summary

| Tool | Target: cht-core | Target: cht-agent | Structured Output | Auto-fixable | Priority |
|------|:-:|:-:|:-:|:-:|---|
| ESLint | Yes (flat config) | Yes (.eslintrc) | JSON | Partial | Essential |
| tsc | Yes (per-dir tsconfig) | Yes (strict) | stderr | No | Essential |
| Prettier | No (uses @stylistic) | Yes | exit code | Yes | Conditional |
| ShellCheck | Yes (.sh files only) | N/A | JSON | No | Low |
| Translation checker | Yes (translations) | N/A | Text | No | Low |
| Blank link check | Yes (HTML) | N/A | Text | No | Low |

---

## Recommended Validation Pipeline

```
Generated Code (GeneratedFile[])
     │
     ▼
┌──────────────────┐
│  Stage files in  │  ← Generated files written to a .gitignored
│  project tree    │    staging directory within target's rootDir
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│     ESLint       │  ← Always runs. Uses target project's config.
│   (blocking)     │    Parses JSON output for errors/warnings.
└────────┬─────────┘
         │ pass
         ▼
┌──────────────────┐
│      tsc         │  ← Always runs for .ts files. --noEmit mode.
│   (blocking)     │    Uses target project's tsconfig.
└────────┬─────────┘
         │ pass
         ▼
┌──────────────────┐
│    Prettier      │  ← Conditional: only if target project uses Prettier.
│   (auto-fix)     │    Auto-fix applied, not blocking.
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   ShellCheck     │  ← Only for .sh files.
│   (warning)      │
└────────┬─────────┘
         │
         ▼
   ValidationResult
```

---

## Error Categorization

### Blocking (must fix before presenting to user)

| Source | Category | Examples |
|--------|----------|----------|
| ESLint | Error-level rules | `no-undef`, `no-unused-vars`, `eqeqeq`, `no-var`, `curly` |
| ESLint | TypeScript errors | `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-misused-promises` |
| tsc | Type errors | Missing properties, type mismatches, unresolved imports |
| tsc | Strict mode violations | `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` |

### Warning (report to user but do not block)

| Source | Category | Examples |
|--------|----------|----------|
| ESLint | Warning-level rules | `@typescript-eslint/no-explicit-any`, `max-len` |
| ShellCheck | Style/info | SC2086 (unquoted variables), SC2034 (unused variables) |

### Auto-fixable (apply fix automatically, do not report)

| Source | Fix method |
|--------|-----------|
| ESLint | `eslint --fix` (subset of rules: spacing, quotes, semicolons, etc.) |
| Prettier | `prettier --write` (all formatting issues) |

**Flow for auto-fix:** Run `eslint --fix` and `prettier --write` on generated files first, then run the blocking validation pass. This means the user only sees issues that cannot be automatically resolved.

---

## Implementation Approach

### Recommendation: Thin wrapper, not a custom agent

The validation layer should shell out to existing tools and parse their structured output. There is no LLM involvement in validation. This is deterministic, fast, and reliable.

### Proposed Interface

Follows the same plugin pattern established by the Code Generation Layer (issue #14):

```typescript
interface GeneratedFile {
  path: string;                 // relative path in target project (e.g. "webapp/src/ts/services/foo.ts")
  content: string;              // file content
  action: 'CREATE' | 'MODIFY';
}

interface ValidationIssue {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  ruleId: string;
  source: 'eslint' | 'tsc' | 'prettier' | 'shellcheck';
  fixable: boolean;
}

interface ValidationResult {
  passed: boolean;              // true if zero blocking errors
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  fixableCount: number;
  duration: number;             // ms
}

interface CodeValidator {
  validate(files: GeneratedFile[], targetProject: string): Promise<ValidationResult>;
  fix(files: GeneratedFile[], targetProject: string): Promise<GeneratedFile[]>;
}
```

- `validate()` runs the full pipeline and returns a structured result
- `fix()` applies all auto-fixable changes and returns updated files
- `targetProject` is a path to the target repo (e.g. a local clone of cht-core)

### Implementation Sketch

```typescript
async function validate(files: GeneratedFile[], targetProject: string): Promise<ValidationResult> {
  // Stage files inside the project tree so tsc's rootDir/include picks them up
  const stagingDir = await stageFiles(files, targetProject); // e.g. src/.validation-staging/

  // 1. Auto-fix pass (silent)
  await exec(`eslint --fix --config ${targetProject}/eslint.config.js ${stagingDir}/**`);
  if (usesPrettier(targetProject)) { // checks for .prettierrc or prettier key in package.json
    await exec(`prettier --write ${stagingDir}/**`);
  }

  // 2. Blocking validation pass
  const eslintJson = await exec(`eslint --format json --config ... ${stagingDir}/**`);
  const eslintIssues = parseEslintOutput(eslintJson);

  const tsFiles = files.filter(f => f.path.endsWith('.ts'));
  let tscIssues: ValidationIssue[] = [];
  if (tsFiles.length > 0) {
    const tscOutput = await exec(`tsc --noEmit --project ${targetProject}/tsconfig.json`);
    tscIssues = parseTscOutput(tscOutput);
  }

  // 3. Warning-only checks
  const shFiles = files.filter(f => f.path.endsWith('.sh'));
  let shellIssues: ValidationIssue[] = [];
  if (shFiles.length > 0) {
    const shellOutput = await exec(`shellcheck --format=json ${stagingDir}/*.sh`);
    shellIssues = parseShellCheckOutput(shellOutput);
  }

  // 4. Aggregate
  const allIssues = [...eslintIssues, ...tscIssues, ...shellIssues];
  const errorCount = allIssues.filter(i => i.severity === 'error').length;

  return {
    passed: errorCount === 0,
    issues: allIssues,
    errorCount,
    warningCount: allIssues.filter(i => i.severity === 'warning').length,
    fixableCount: allIssues.filter(i => i.fixable).length,
    duration: elapsed,
  };
}
```

### Key Design Decisions

1. **Validate against cht-core's config.** Generated code targets cht-core, so we use its ESLint config and tsconfigs directly from the local clone. Support for other repos can be added later.

2. **Auto-fix first, then validate.** Formatting and trivially fixable issues are resolved automatically. Only real problems surface to the user (or back to the LLM for retry).

3. **Stage inside the project tree.** Generated files are written to a `.gitignored` staging directory within the target project's `rootDir` (e.g. `src/.validation-staging/`). This ensures `tsc` includes them via the existing tsconfig and that imports, type declarations, and per-directory overrides resolve correctly. The staging directory is cleaned up after validation.

4. **No LLM in the validation loop.** Validation is deterministic. If it fails, the structured error output is passed back to the Code Generation Layer as additional context for a retry.

---

## Integration with Other Layers

```
Code Generation Layer (issue #62)
     │
     │ GeneratedFile[]
     ▼
Code Validation Layer (issue #65)
     │
     ├── passed: true ──► QA Supervisor (issue #64) ──► Test Generation Layer
     │
     └── passed: false ─► Back to Code Generation Layer
                           (retry with ValidationResult as context)
                           Max 2 retries before escalating to user
```

The QA Supervisor only receives code that has passed validation. If validation fails, the `ValidationResult` (with specific errors, line numbers, and rule IDs) is fed back to the Code Generation Layer so the LLM can fix the issues in a targeted retry.

---

## Complexity and Effort

| Component | Complexity | Notes |
|-----------|-----------|-------|
| ESLint wrapper + JSON parser | Low | Structured JSON output, straightforward parsing |
| tsc wrapper + error parser | Low | Parse stderr lines with regex for file:line:col format |
| Prettier wrapper | Low | Binary pass/fail, auto-fix only |
| ShellCheck wrapper | Low | JSON output similar to ESLint |
| Staging directory management | Low | Stage files in project tree, run tools, clean up |
| Target project config detection | Low | Use cht-core's configs directly |
| Auto-fix pipeline | Low | Run --fix/--write before validation |
| Retry integration with Code Gen | Medium | Part of Code Generation Layer / Code Validation Layer, not this layer alone |

**Total estimated implementation effort:** Low to Medium. All tools already exist and produce structured output. The work is integration and output parsing, not invention.

---

## Decisions

1. **No retries at the validation layer.** Validation must pass for CI to pass. If generated code has errors, they must be fixed. Retry logic (if any) belongs in the Code Generation Layer, not here.

2. **Warnings follow ESLint config.** What counts as a warning vs error is determined by the ESLint rule severity in cht-core's config. The validation layer respects those settings as-is.

3. **Validate generated files only.** Same scope as CI: lint and type-check the generated files, not the entire project. This matches how cht-core's CI operates.

> **Note:** cht-agent currently uses ESLint v8 legacy config while cht-core uses v9 flat config. Since cht-agent is a new repo, we should update to v9 flat config to stay consistent. This is not blocking for the validation layer but should be done as a separate chore.
