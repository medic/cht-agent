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
    attrs: { relevant: "selected(../pregnancy_summary/visit_option, 'yes')" },
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

  // P2: attrs oracle (values + absence), set.clear, and legacy back-compat.
  describe('P2 — attrs oracle, set.clear, legacy relevant back-compat', () => {
    it('accepts expect.attrs with a value and a null (absence) assertion', () => {
      const d = clone();
      (d.expect as Record<string, unknown>).attrs = { relevant: "x = 'y'", calculate: null };
      const result = validateXlsformFixDescriptor(d);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.expect.attrs).to.deep.equal({ relevant: "x = 'y'", calculate: null });
    });

    it('BACK-COMPAT: a legacy expect.relevant is normalized to attrs: {relevant}', () => {
      const d = clone();
      delete (d.expect as Record<string, unknown>).attrs;
      (d.expect as Record<string, unknown>).relevant = "selected(../a, 'b')";
      const result = validateXlsformFixDescriptor(d);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      // relevant folded into attrs; the bare relevant key is stripped.
      expect(result.descriptor?.expect.attrs).to.deep.equal({ relevant: "selected(../a, 'b')" });
      expect((result.descriptor?.expect as unknown as Record<string, unknown>).relevant).to.equal(undefined);
    });

    it('BACK-COMPAT: legacy relevant normalizes via the text parser path too', () => {
      const d = clone();
      delete (d.expect as Record<string, unknown>).attrs;
      (d.expect as Record<string, unknown>).relevant = 'true()';
      const result = parseXlsformFixDescriptor(JSON.stringify(d));
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.expect.attrs).to.deep.equal({ relevant: 'true()' });
    });

    it('when both attrs and legacy relevant are present, the explicit attrs.relevant wins', () => {
      const d = clone();
      (d.expect as Record<string, unknown>).attrs = { relevant: 'KEEP()' };
      (d.expect as Record<string, unknown>).relevant = 'CLOBBER()';
      const result = validateXlsformFixDescriptor(d);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.expect.attrs.relevant).to.equal('KEEP()');
    });

    it('rejects expect with neither attrs nor relevant', () => {
      const d = clone();
      delete (d.expect as Record<string, unknown>).attrs;
      const result = validateXlsformFixDescriptor(d);
      expect(result.valid).to.equal(false);
    });

    it('accepts set.clear:true as an alternative to value', () => {
      const d = clone();
      (d.edits as Record<string, unknown>[])[0].set = { column: 'calculation', clear: true };
      const result = validateXlsformFixDescriptor(d);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect((result.descriptor?.edits[0].set as unknown as Record<string, unknown>).clear).to.equal(true);
    });

    it('rejects a set that carries BOTH value and clear', () => {
      const d = clone();
      (d.edits as Record<string, unknown>[])[0].set = { column: 'calculation', value: 'x', clear: true };
      expect(validateXlsformFixDescriptor(d).valid).to.equal(false);
    });

    it('rejects a set with neither value nor clear', () => {
      const d = clone();
      (d.edits as Record<string, unknown>[])[0].set = { column: 'calculation' };
      expect(validateXlsformFixDescriptor(d).valid).to.equal(false);
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

  // F8: tolerant extraction — salvage the first balanced top-level JSON object.
  describe('tolerant extraction (F8)', () => {
    it('salvages a descriptor wrapped in a ```json code fence', () => {
      const fenced = '```json\n' + JSON.stringify(VALID) + '\n```';
      const result = parseXlsformFixDescriptor(fenced);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.form).to.equal('pregnancy_home_visit');
    });

    it('salvages a descriptor with trailing prose after the closing brace', () => {
      const withProse = JSON.stringify(VALID) + '\n\nThat completes the fix descriptor.';
      const result = parseXlsformFixDescriptor(withProse);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.expect.nodeset).to.equal('/data/danger_signs');
    });

    it('salvages a descriptor with leading prose before the opening brace', () => {
      const withLead = 'Here is the descriptor:\n' + JSON.stringify(VALID);
      const result = parseXlsformFixDescriptor(withLead);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
    });

    it('is string-literal-aware: braces inside a string value do not confuse the scan', () => {
      const tricky = clone();
      (((tricky.edits as Record<string, unknown>[])[0]).set as Record<string, unknown>).value =
        "if(x, '{ not a real brace }', '')";
      const withProse = JSON.stringify(tricky) + '\ntrailing }}} noise';
      const result = parseXlsformFixDescriptor(withProse);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.edits[0].set.value).to.equal("if(x, '{ not a real brace }', '')");
    });

    it('still errors on genuine garbage with no parseable object', () => {
      const result = parseXlsformFixDescriptor('not json at all, no braces here');
      expect(result.valid).to.equal(false);
      expect(result.errors[0]).to.match(/invalid JSON/i);
    });

    it('still errors when the only brace-region is itself malformed', () => {
      const result = parseXlsformFixDescriptor('prefix { "version": 1, oops no colon } suffix');
      expect(result.valid).to.equal(false);
    });

    it('parses a BOM-prefixed but otherwise-clean descriptor', () => {
      // JSON.parse chokes on a leading U+FEFF; String.trim() strips it, which
      // previously defeated the salvage guard (extracted === content.trim()).
      const withBom = '﻿' + JSON.stringify(VALID);
      const result = parseXlsformFixDescriptor(withBom);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.form).to.equal('pregnancy_home_visit');
    });

    it('salvages a BOM-prefixed descriptor that also carries trailing prose', () => {
      const withBom = '﻿' + JSON.stringify(VALID) + '\n\nThat completes the descriptor.';
      const result = parseXlsformFixDescriptor(withBom);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.expect.nodeset).to.equal('/data/danger_signs');
    });
  });

  // F8: groupPath string→[string] normalization before ajv.
  describe('groupPath normalization (F8)', () => {
    it('coerces a string groupPath to a one-element array and validates', () => {
      const d = clone();
      (((d.edits as Record<string, unknown>[])[0]).match as Record<string, unknown>).groupPath = 'pnc_visit';
      const result = validateXlsformFixDescriptor(d);
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.edits[0].match.groupPath).to.deep.equal(['pnc_visit']);
    });

    it('coerces via the text parser path too', () => {
      const d = clone();
      (((d.edits as Record<string, unknown>[])[0]).match as Record<string, unknown>).groupPath = 'pnc_visit';
      const result = parseXlsformFixDescriptor(JSON.stringify(d));
      expect(result.valid, JSON.stringify(result.errors)).to.equal(true);
      expect(result.descriptor?.edits[0].match.groupPath).to.deep.equal(['pnc_visit']);
    });

    it('leaves an already-array groupPath untouched', () => {
      const d = clone();
      (((d.edits as Record<string, unknown>[])[0]).match as Record<string, unknown>).groupPath = ['a', 'b'];
      const result = validateXlsformFixDescriptor(d);
      expect(result.valid).to.equal(true);
      expect(result.descriptor?.edits[0].match.groupPath).to.deep.equal(['a', 'b']);
    });
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

  it('is true for a cht-conf FORM ticket', () => {
    expect(isXlsformFixTicket(ticket('cht-conf', 'form'))).to.equal(true);
  });

  it('is true for a cht-conf CONTACT-FORM ticket (P1)', () => {
    expect(isXlsformFixTicket(ticket('cht-conf', 'contact-form'))).to.equal(true);
  });

  it('is false for a cht-conf non-form artifact', () => {
    expect(isXlsformFixTicket(ticket('cht-conf', 'app-settings'))).to.equal(false);
  });

  it('is false for a cht-core CONTACT-FORM ticket (layer must be cht-conf)', () => {
    expect(isXlsformFixTicket(ticket('cht-core', 'contact-form'))).to.equal(false);
  });

  it('is false for a cht-core ticket (even with a form artifact)', () => {
    expect(isXlsformFixTicket(ticket('cht-core', 'form'))).to.equal(false);
  });

  it('is false when the layer is absent', () => {
    expect(isXlsformFixTicket(ticket(undefined, 'form'))).to.equal(false);
  });
});
