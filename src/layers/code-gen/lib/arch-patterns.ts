/**
 * Domain-conditional architectural patterns injected into the plan prompt.
 *
 * The plan prompt builder selects the relevant patterns based on the ticket's
 * `technical_context.domain`. For domains not in the map, no section is added
 * (the prompt stays unchanged).
 *
 * The intent is to encode cht-core conventions the LLM cannot infer from the
 * codebase alone (e.g., NgRx contract completeness, translation parity).
 */

export const NGRX_PATTERN = `
- **State management (NgRx):** When adding or modifying derived state, you MUST touch ALL of:
  1. Action creator (webapp/src/ts/actions/<domain>.ts) — \`Actions.foo\` declaration AND the corresponding method on the \`*Actions\` class.
  2. Reducer handler (webapp/src/ts/reducers/<domain>.ts) — handle the action; mutate the right slice of state.
  3. Selector (webapp/src/ts/selectors/index.ts) — expose for components.
  4. Effect (webapp/src/ts/effects/<domain>.effects.ts) — required when the derived state has an async source (service call, store query, async permission check). If a Selector reads a value computed asynchronously, an Effect MUST exist to compute and dispatch it.
  5. Component (webapp/src/ts/modules/<domain>/*.component.ts) — \`this.store.select(Selectors.X)\`.
  6. Template (webapp/src/ts/modules/<domain>/*.component.html) — bind the component field.
  If you add a Selector that reads \`state.X\`, you MUST also add an Action method that writes \`X\` AND a Reducer handler that responds to that action. Omitting any one yields a partial flow that compiles but breaks at runtime.
`.trim();

export const TRANSLATION_PARITY_NOTE = `
- **Translation parity:** When adding a user-facing string or permission description, the key MUST be present in all 10 \`api/resources/translations/messages-*.properties\` files. The English value can be duplicated to the other locales as a placeholder; a translation pipeline updates them later. (Note: the code-gen layer has a locale-propagation hook that auto-fills the 9 non-en files for you; you only need to touch \`messages-en.properties\`.)
`.trim();

export const LINEAGE_MUTED_NOTE = `
- **Muted check (lineage-aware):** A contact is "effectively muted" if \`doc.muted === true\` OR any \`lineage[*].muted === true\`. Always use \`ContactMutedService.getMuted(doc, lineage)\`. Never compare \`doc.muted\` directly; you will miss contacts whose ancestor is muted but the contact itself isn't flagged.
- **Strict calling convention:** if you call \`getMuted\`, you MUST pass BOTH arguments. \`getMuted(doc, lineage)\` is CORRECT; \`getMuted(doc)\` is WRONG (misses ancestor-muted contacts). The \`lineage\` argument is optional in the type signature but MANDATORY for correctness.
`.trim();

export const PERMISSION_ROLES_NOTE = `
- **Permission roles:** New entries in \`config/default/app_settings.json\` "permissions" object MUST have a non-empty roles array. Mirror the role list of the closest existing permission (e.g., \`can_create_people\` for a new \`can_create_*\` permission). An empty array disables the permission for every user, which is a backward-incompatible default.
`.trim();

const PATTERNS_BY_DOMAIN: Record<string, string[]> = {
  contacts: [NGRX_PATTERN, TRANSLATION_PARITY_NOTE, LINEAGE_MUTED_NOTE, PERMISSION_ROLES_NOTE],
  'forms-and-reports': [NGRX_PATTERN, TRANSLATION_PARITY_NOTE],
  'tasks-and-targets': [NGRX_PATTERN, TRANSLATION_PARITY_NOTE],
  messaging: [NGRX_PATTERN, TRANSLATION_PARITY_NOTE],
  authentication: [PERMISSION_ROLES_NOTE, TRANSLATION_PARITY_NOTE],
  configuration: [PERMISSION_ROLES_NOTE, TRANSLATION_PARITY_NOTE],
  'data-sync': [],
  interoperability: [TRANSLATION_PARITY_NOTE],
};

export function getArchPatternsSection(domain: string): string {
  const patterns = PATTERNS_BY_DOMAIN[domain] ?? [];
  if (patterns.length === 0) return '';
  return `## Architectural Patterns (this codebase)\n${patterns.join('\n\n')}\n`;
}
