#!/usr/bin/env node
/**
 * Context File Validator
 *
 * Validates markdown context files in agent-memory/ against the schema.
 *
 * Usage:
 *   npm run validate-context
 *   npm run validate-context -- path/to/specific-file.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const AGENT_MEMORY_DIR = path.resolve(__dirname, '../../agent-memory');
const SCHEMA_PATH = path.join(AGENT_MEMORY_DIR, 'schema.json');

const REQUIRED_SECTIONS = [
  'Problem',
  'Root Cause',
  'Solution',
  'Code Patterns',
  'Design Choices',
  'Related Files',
  'Testing',
  'Related Issues',
];

export interface ValidationError {
  file: string;
  field?: string;
  message: string;
}

export interface ValidationResult {
  file: string;
  valid: boolean;
  errors: ValidationError[];
}

interface SchemaProperty {
  type?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  minItems?: number;
  items?: { type?: string; ref?: string };
  ref?: string;
}

const REF_KEY = '$ref';

const readSchemaProperties = (raw: Record<string, unknown>): Record<string, SchemaProperty> => {
  const result: Record<string, SchemaProperty> = {};
  for (const [key, value] of Object.entries(raw)) {
    const prop = value as Record<string, unknown>;
    const mapped: SchemaProperty = { ...prop } as SchemaProperty;
    if (prop[REF_KEY]) {
      mapped.ref = prop[REF_KEY] as string;
    }
    if (prop.items && typeof prop.items === 'object') {
      const items = prop.items as Record<string, unknown>;
      mapped.items = { ...items } as SchemaProperty['items'];
      if (items[REF_KEY]) {
        mapped.items!.ref = items[REF_KEY] as string;
      }
    }
    result[key] = mapped;
  }
  return result;
};

interface SchemaDefinitions {
  CHTDomain: { enum: string[] };
  CHTCategory: { enum: string[] };
  CHTService: { enum: string[] };
  frontmatter: {
    required: string[];
    properties: Record<string, SchemaProperty>;
  };
}

export const loadSchema = (): SchemaDefinitions => {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const schema = JSON.parse(raw);
  const definitions = schema.definitions;
  definitions.frontmatter.properties = readSchemaProperties(definitions.frontmatter.properties);
  return definitions;
};

export const parseFrontmatter = (content: string): { frontmatter: Record<string, unknown> | null; body: string } => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  const frontmatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
  return { frontmatter, body: match[2] };
};

const resolveRef = (ref: string, defs: SchemaDefinitions): { enum?: string[] } | null => {
  const name = ref.replace('#/definitions/', '') as keyof SchemaDefinitions;
  const def = defs[name];
  if (def && 'enum' in def) {
    return def;
  }
  return null;
};

const validateString = (
  value: string,
  prop: SchemaProperty,
  field: string,
  filePath: string,
): ValidationError[] => {
  const errors: ValidationError[] = [];

  if (prop.pattern && !new RegExp(prop.pattern).test(value)) {
    errors.push({ file: filePath, field, message: `Does not match expected pattern. Got: "${value}"` });
  }
  if (prop.minLength !== undefined && value.length < prop.minLength) {
    errors.push({ file: filePath, field, message: `Must be at least ${prop.minLength} character(s)` });
  }
  if (prop.maxLength !== undefined && value.length > prop.maxLength) {
    errors.push({ file: filePath, field, message: `Must be at most ${prop.maxLength} characters` });
  }

  return errors;
};

const validateArray = (
  value: unknown[],
  prop: SchemaProperty,
  field: string,
  filePath: string,
  defs: SchemaDefinitions,
): ValidationError[] => {
  const errors: ValidationError[] = [];

  if (prop.minItems !== undefined && value.length < prop.minItems) {
    errors.push({ file: filePath, field, message: `Must have at least ${prop.minItems} item(s)` });
  }

  if (prop.items?.ref) {
    const resolved = resolveRef(prop.items.ref, defs);
    if (resolved?.enum) {
      for (const item of value) {
        if (!resolved.enum.includes(item as string)) {
          errors.push({
            file: filePath,
            field,
            message: `Invalid value "${item}". Expected one of: ${resolved.enum.join(', ')}`,
          });
        }
      }
    }
  }

  return errors;
};

export const validateFrontmatter = (
  fm: Record<string, unknown>,
  defs: SchemaDefinitions,
  filePath: string,
): ValidationError[] => {
  const errors: ValidationError[] = [];
  const { required, properties } = defs.frontmatter;

  for (const field of required) {
    if (fm[field] === undefined || fm[field] === null || fm[field] === '') {
      errors.push({ file: filePath, field, message: `Missing required field` });
    }
  }

  for (const [field, value] of Object.entries(fm)) {
    const prop = properties[field];
    if (!prop) {
      continue;
    }

    if (prop.ref) {
      const resolved = resolveRef(prop.ref, defs);
      if (resolved?.enum && !resolved.enum.includes(value as string)) {
        errors.push({
          file: filePath,
          field,
          message: `Invalid value "${value}". Expected one of: ${resolved.enum.join(', ')}`,
        });
      }
      continue;
    }

    if (prop.type === 'string') {
      if (typeof value !== 'string') {
        errors.push({ file: filePath, field, message: `Must be a string, got ${typeof value}` });
        continue;
      }
      errors.push(...validateString(value, prop, field, filePath));
    }

    if (prop.type === 'integer') {
      if (typeof value !== 'number') {
        errors.push({ file: filePath, field, message: `Must be an integer, got ${typeof value}` });
        continue;
      }
      if (prop.minimum !== undefined && value < prop.minimum) {
        errors.push({ file: filePath, field, message: `Must be at least ${prop.minimum}` });
      }
    }

    if (prop.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push({ file: filePath, field, message: `Must be an array` });
        continue;
      }
      errors.push(...validateArray(value, prop, field, filePath, defs));
    }
  }

  return errors;
};

export const validateBody = (body: string, filePath: string): ValidationError[] => {
  const errors: ValidationError[] = [];

  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^## ${section}`, 'm').test(body)) {
      errors.push({ file: filePath, message: `Missing required section: ## ${section}` });
    }
  }

  return errors;
};

export const validateFile = (filePath: string, defs: SchemaDefinitions): ValidationResult => {
  const errors: ValidationError[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(content);

  if (!frontmatter) {
    errors.push({ file: filePath, message: 'Missing YAML frontmatter (expected --- delimiters)' });
    return { file: filePath, valid: false, errors };
  }

  errors.push(...validateFrontmatter(frontmatter, defs, filePath));
  errors.push(...validateBody(body, filePath));

  return { file: filePath, valid: errors.length === 0, errors };
};

export const findContextFiles = (baseDir: string): string[] => {
  const files: string[] = [];

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.name.endsWith('.md') &&
        entry.name !== 'README.md' &&
        entry.name !== 'TEMPLATE.md'
      ) {
        files.push(fullPath);
      }
    }
  };

  const domainsDir = path.join(baseDir, 'domains');
  if (fs.existsSync(domainsDir)) {
    walk(domainsDir);
  }

  return files;
};

const main = () => {
  const defs = loadSchema();
  const specificFile = process.argv[2];

  let files: string[];
  if (specificFile) {
    const resolved = path.resolve(specificFile);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }
    files = [resolved];
  } else {
    files = findContextFiles(AGENT_MEMORY_DIR);
  }

  if (files.length === 0) {
    console.log('No context files found to validate.');
    process.exit(0);
  }

  console.log(`Validating ${files.length} context file(s)...\n`);

  let totalErrors = 0;
  let validCount = 0;

  for (const file of files) {
    const result = validateFile(file, defs);
    const relative = path.relative(AGENT_MEMORY_DIR, file);

    if (result.valid) {
      console.log(`  PASS  ${relative}`);
      validCount++;
    } else {
      console.log(`  FAIL  ${relative}`);
      for (const error of result.errors) {
        const fieldStr = error.field ? ` [${error.field}]` : '';
        console.log(`        ${fieldStr} ${error.message}`);
      }
      totalErrors += result.errors.length;
    }
  }

  console.log(`\n${validCount}/${files.length} files valid, ${totalErrors} error(s) total.`);

  if (totalErrors > 0) {
    process.exit(1);
  }
};

main();
