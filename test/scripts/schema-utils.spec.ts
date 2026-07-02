import { expect } from 'chai';
import { buildValidator } from '../../src/scripts/schema-utils';

/**
 * Locks the #135 relink additions to the frontmatter schema (Part A.4):
 * issueNumber is nullable for drafts whose source PR closes no issue, and
 * resolvedIssue marks whether the linkage has been verified. Everything else
 * about the frontmatter contract (required fields, additionalProperties,
 * the integer minimum) must stay as strict as before.
 */
describe('frontmatter schema — #135 relink fields', () => {
  /** Minimal frontmatter satisfying every required field. */
  function makeFrontmatter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'cht-core-9467',
      category: 'bug',
      domain: 'messaging',
      issueNumber: 9467,
      issueUrl: 'https://github.com/medic/cht-core/issues/9467',
      title: 'A draft',
      lastUpdated: '2026-06-22',
      summary: 'Summary of the issue and resolution.',
      services: ['api'],
      techStack: ['couchdb'],
      ...overrides,
    };
  }

  it('accepts a baseline draft with an integer issueNumber', () => {
    const validate = buildValidator();
    const valid = validate(makeFrontmatter());
    expect(valid, JSON.stringify(validate.errors)).to.equal(true);
  });

  it('accepts issueNumber: null (source PR closes no issue, pending manual relink)', () => {
    const validate = buildValidator();
    const valid = validate(makeFrontmatter({ issueNumber: null }));
    expect(valid, JSON.stringify(validate.errors)).to.equal(true);
  });

  it('accepts resolvedIssue as a boolean', () => {
    const validate = buildValidator();
    expect(validate(makeFrontmatter({ resolvedIssue: true }))).to.equal(true);
    expect(validate(makeFrontmatter({ issueNumber: null, resolvedIssue: false }))).to.equal(true);
  });

  it('rejects a non-boolean resolvedIssue', () => {
    const validate = buildValidator();
    expect(validate(makeFrontmatter({ resolvedIssue: 'yes' }))).to.equal(false);
  });

  it('still enforces the integer minimum on issueNumber', () => {
    const validate = buildValidator();
    expect(validate(makeFrontmatter({ issueNumber: 0 }))).to.equal(false);
  });

  it('still rejects non-integer, non-null issueNumber', () => {
    const validate = buildValidator();
    expect(validate(makeFrontmatter({ issueNumber: '9467' }))).to.equal(false);
  });

  it('still rejects unknown properties', () => {
    const validate = buildValidator();
    expect(validate(makeFrontmatter({ unknownField: 1 }))).to.equal(false);
  });
});
