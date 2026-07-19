import { expect } from 'chai';
import { resolveFormRelPaths } from '../../src/utils/form-paths';

describe('resolveFormRelPaths (P1)', () => {
  it('maps `form` to the forms/app layout', () => {
    const paths = resolveFormRelPaths('form', 'pregnancy_home_visit');
    expect(paths).to.deep.equal({
      formsDir: 'forms/app',
      xlsxRelPath: 'forms/app/pregnancy_home_visit.xlsx',
      xmlRelPath: 'forms/app/pregnancy_home_visit.xml',
    });
  });

  it('maps `contact-form` to the forms/contact layout', () => {
    const paths = resolveFormRelPaths('contact-form', 'e_household-create');
    expect(paths).to.deep.equal({
      formsDir: 'forms/contact',
      xlsxRelPath: 'forms/contact/e_household-create.xlsx',
      xmlRelPath: 'forms/contact/e_household-create.xml',
    });
  });

  it('preserves the form base name verbatim (dashes and all)', () => {
    // Contact-form doc ids derive from the dashed base name; the resolver must
    // never rewrite it (`-`→`:` derivation is a separate, later concern).
    const paths = resolveFormRelPaths('contact-form', 'person-create');
    expect(paths.xlsxRelPath).to.equal('forms/contact/person-create.xlsx');
    expect(paths.xmlRelPath).to.equal('forms/contact/person-create.xml');
  });

  it('throws a clear error for an unsupported artifact', () => {
    expect(() => resolveFormRelPaths('task', 'x')).to.throw(/unsupported configArtifact "task"/);
  });

  it('names the supported artifacts in the error message', () => {
    let message = '';
    try {
      resolveFormRelPaths('app-settings', 'x');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).to.contain('"form"');
    expect(message).to.contain('"contact-form"');
  });
});
