import { expect } from 'chai';
import { crossFieldErrors } from '../../src/scripts/schema-utils';

describe('schema-utils crossFieldErrors', () => {
  it('rejects a secondaryDomains entry equal to the primary domain', () => {
    const errors = crossFieldErrors({ domain: 'data-access', secondaryDomains: ['data-access'] });
    expect(errors).to.have.lengthOf(1);
    expect(errors[0]).to.match(/secondaryDomains.*must not include the primary domain/);
    expect(errors[0]).to.include('"data-access"');
  });

  it('accepts distinct secondaries, absent field, and absent primary', () => {
    expect(crossFieldErrors({ domain: 'data-access', secondaryDomains: ['contacts'] })).to.deep.equal([]);
    expect(crossFieldErrors({ domain: 'contacts' })).to.deep.equal([]);
    expect(crossFieldErrors({ secondaryDomains: ['contacts'] })).to.deep.equal([]);
  });
});
