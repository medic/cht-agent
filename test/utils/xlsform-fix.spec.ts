import { expect } from 'chai';
import {
  isXlsformFixTicket,
  parseXlsformFixDescriptor,
  validateXlsformFixDescriptor,
  XLSFORM_FIX_DESCRIPTOR_PATH,
  XlsformFixDescriptor,
} from '../../src/utils/xlsform-fix';
import { IssueTemplate } from '../../src/types';

const VALID: XlsformFixDescriptor = {
  version: 1,
  form: 'pregnancy_home_visit',
  edits: [
    {
      sheet: 'survey',
      match: { column: 'name', value: 'danger_signs' },
      set: { column: 'relevant', value: "selected(../pregnancy_summary/visit_option, 'yes')" },
    },
  ],
  expect: {
    nodeset: '/data/danger_signs',
    relevant: "selected(../pregnancy_summary/visit_option, 'yes')",
    siblingsUnchanged: true,
  },
  rationale: 'Restore the yes-only gate so danger signs are hidden after a miscarriage.',
};

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(VALID));

describe('xlsform-fix descriptor schema', () => {
  it('accepts a well-formed descriptor', () => {
    const result = validateXlsformFixDescriptor(VALID);
    expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
    expect(result.descriptor).to.deep.equal(VALID);
  });

  it('accepts an optional groupPath on the match', () => {
    const d = clone();
    (d.edits as Record<string, unknown>[])[0].match = { column: 'name', value: 'q', groupPath: ['pnc_visit'] };
    expect(validateXlsformFixDescriptor(d).valid).to.equal(true);
  });

  it('defaults are optional: siblingsUnchanged may be omitted', () => {
    const d = clone();
    delete (d.expect as Record<string, unknown>).siblingsUnchanged;
    expect(validateXlsformFixDescriptor(d).valid).to.equal(true);
  });

  const rejects: Array<[string, (d: Record<string, unknown>) => void]> = [
    ['missing version', (d) => delete d.version],
    ['wrong version', (d) => (d.version = 2)],
    ['form with a path separator', (d) => (d.form = '../../etc/passwd')],
    ['form with a slash', (d) => (d.form = 'app/foo')],
    ['empty edits array', (d) => (d.edits = [])],
    ['edit missing set', (d) => delete (d.edits as Record<string, unknown>[])[0].set],
    ['match missing value', (d) => delete ((d.edits as Record<string, unknown>[])[0].match as Record<string, unknown>).value],
    ['unknown top-level property', (d) => (d.extra = 'nope')],
    ['unknown property inside an edit', (d) => ((d.edits as Record<string, unknown>[])[0].note = 'nope')],
    ['expect missing nodeset', (d) => delete (d.expect as Record<string, unknown>).nodeset],
    ['nodeset not absolute', (d) => ((d.expect as Record<string, unknown>).nodeset = 'data/x')],
    ['empty rationale', (d) => (d.rationale = '')],
  ];

  rejects.forEach(([name, mutate]) => {
    it(`rejects: ${name}`, () => {
      const d = clone();
      mutate(d);
      const result = validateXlsformFixDescriptor(d);
      expect(result.valid).to.equal(false);
      expect(result.errors.length).to.be.greaterThan(0);
    });
  });
});

describe('parseXlsformFixDescriptor', () => {
  it('parses and validates well-formed JSON text', () => {
    const result = parseXlsformFixDescriptor(JSON.stringify(VALID));
    expect(result.valid).to.equal(true);
    expect(result.descriptor?.form).to.equal('pregnancy_home_visit');
  });

  it('reports invalid JSON as a validation failure (no throw)', () => {
    const result = parseXlsformFixDescriptor('{ not json ');
    expect(result.valid).to.equal(false);
    expect(result.errors[0]).to.match(/invalid JSON/i);
  });

  it('exposes the descriptor path constant', () => {
    expect(XLSFORM_FIX_DESCRIPTOR_PATH).to.equal('.cht-agent/xlsform-fix.json');
  });
});

describe('isXlsformFixTicket', () => {
  const ticket = (layer?: string, configArtifact?: string): IssueTemplate =>
    ({
      issue: {
        title: 't',
        type: 'bug',
        priority: 'medium',
        description: 'd',
        technical_context: {
          domain: 'forms-and-reports',
          components: [],
          ...(layer ? { layer } : {}),
          ...(configArtifact ? { configArtifact } : {}),
        },
        requirements: [],
        acceptance_criteria: [],
        constraints: [],
      },
    }) as unknown as IssueTemplate;

  it('is true only for a cht-conf FORM ticket', () => {
    expect(isXlsformFixTicket(ticket('cht-conf', 'form'))).to.equal(true);
  });

  it('is false for a cht-conf non-form artifact', () => {
    expect(isXlsformFixTicket(ticket('cht-conf', 'app-settings'))).to.equal(false);
  });

  it('is false for a cht-core ticket (even with a form artifact)', () => {
    expect(isXlsformFixTicket(ticket('cht-core', 'form'))).to.equal(false);
  });

  it('is false when the layer is absent', () => {
    expect(isXlsformFixTicket(ticket(undefined, 'form'))).to.equal(false);
  });
});
