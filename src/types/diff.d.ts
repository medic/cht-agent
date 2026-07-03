/**
 * TEMPORARY INTEGRATION SHIM — remove in C5.
 *
 * `src/supervisors/development-supervisor.ts` (landed in C3) imports the `diff`
 * npm package. Upstream branch `63-implement-test-generation-layer` declares
 * `diff` (dependency) + `@types/diff` (devDependency) in package.json, but the
 * package.json changes for this hand-integration are scheduled for the C5 commit
 * and MUST NOT be made here. The `diff` runtime package is already present in
 * node_modules (transitively), but `@types/diff` is not, so `tsc`/`ts-node`
 * cannot type the two functions the supervisor uses.
 *
 * This is a global-script declaration file (no top-level import/export) so that
 * `declare module 'diff'` is a fresh ambient module declaration rather than an
 * augmentation of the untyped runtime module. It is pulled into the `ts-node`
 * program (which runs with `files: false` and otherwise ignores stray .d.ts
 * files) via a triple-slash `/// <reference>` at the top of ./index.ts.
 *
 * DELETE this file AND that reference when C5 adds `@types/diff` to
 * package.json — a real @types/diff and this ambient declaration both
 * `declare module 'diff'` and would collide with duplicate-identifier errors.
 */
declare module 'diff' {
  export interface StructuredPatchHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }

  export interface StructuredPatch {
    oldFileName: string;
    newFileName: string;
    oldHeader: string;
    newHeader: string;
    hunks: StructuredPatchHunk[];
  }

  export interface PatchOptions {
    context?: number;
  }

  export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: PatchOptions,
  ): StructuredPatch;

  export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: PatchOptions,
  ): string;
}
