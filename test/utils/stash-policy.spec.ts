import { expect } from 'chai';
import {
  __resetStashPolicyForTests,
  getStashPolicy,
  setStashPolicy,
} from '../../src/utils/stash-policy';

describe('stash-policy', () => {
  afterEach(() => __resetStashPolicyForTests());

  it('accepts no leftover stash until the CLI edge sets a policy', () => {
    expect(getStashPolicy()).to.deep.equal({ acceptedLeftoverShas: [] });
  });

  it('keeps a frozen copy, so a later change to the input does not reach it', () => {
    const accepted = ['a'.repeat(40)];
    setStashPolicy({ acceptedLeftoverShas: accepted });
    accepted.push('b'.repeat(40));
    const policy = getStashPolicy();
    expect(policy).to.deep.equal({ acceptedLeftoverShas: ['a'.repeat(40)] });
    expect(Object.isFrozen(policy)).to.equal(true);
    expect(Object.isFrozen(policy.acceptedLeftoverShas)).to.equal(true);
  });

  it('goes back to the default on the test reset', () => {
    setStashPolicy({ acceptedLeftoverShas: ['a'.repeat(40)] });
    __resetStashPolicyForTests();
    expect(getStashPolicy()).to.deep.equal({ acceptedLeftoverShas: [] });
  });
});
