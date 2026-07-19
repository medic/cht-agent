import { expect } from 'chai';
import { deployedFormId, resolveFormRelPaths } from '../../src/utils/form-paths';

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

describe('deployedFormId (P3)', () => {
  it('maps `form` to the base name verbatim', () => {
    expect(deployedFormId('form', 'pregnancy_home_visit')).to.equal('pregnancy_home_visit');
  });

  it('maps `contact-form` to a `contact:`-prefixed, colon-joined id (every dash → colon)', () => {
    // Mirrors cht-conf upload-forms.js: e_household-create.xlsx → doc
    // _id = form:contact:e_household:create (the `form:` prefix is added by the
    // rev/doc layer; deployedFormId returns the served/rev-keyed id without it).
    expect(deployedFormId('contact-form', 'e_household-create')).to.equal('contact:e_household:create');
  });

  it('preserves underscores and turns EVERY dash into a colon', () => {
    // person-create → contact:person:create; a multi-dash base name colonizes
    // each dash while underscores in a segment survive.
    expect(deployedFormId('contact-form', 'person-create')).to.equal('contact:person:create');
    expect(deployedFormId('contact-form', 'e_health_facility-edit')).to.equal(
      'contact:e_health_facility:edit'
    );
    expect(deployedFormId('contact-form', 'a-b-c')).to.equal('contact:a:b:c');
  });

  it('throws a clear error naming both supported artifacts for anything else', () => {
    expect(() => deployedFormId('task', 'x')).to.throw(/unsupported configArtifact "task"/);
    let message = '';
    try {
      deployedFormId('app-settings', 'x');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).to.contain('"form"');
    expect(message).to.contain('"contact-form"');
  });
});
