import { expect } from 'chai';
import {
  __resetStashPolicyForTests,
  acceptSpareStash,
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

  it('keeps no key for a resolver or a spare hook that is not set', () => {
    setStashPolicy({ acceptedLeftoverShas: [], resolveStashFailure: undefined, onSpareStash: undefined });
    expect(Object.keys(getStashPolicy())).to.deep.equal(['acceptedLeftoverShas']);
  });

  it('adds a proven spare copy to the accepted SHAs once, and keeps the other keys', () => {
    const resolveStashFailure = async () => 'abort' as const;
    setStashPolicy({ acceptedLeftoverShas: ['a'.repeat(40)], resolveStashFailure, onSpareStash: acceptSpareStash });
    acceptSpareStash('b'.repeat(40));
    acceptSpareStash('b'.repeat(40));
    const policy = getStashPolicy();
    expect(policy.acceptedLeftoverShas).to.deep.equal(['a'.repeat(40), 'b'.repeat(40)]);
    expect(policy.resolveStashFailure).to.equal(resolveStashFailure);
    expect(policy.onSpareStash).to.equal(acceptSpareStash);
    expect(Object.isFrozen(policy)).to.equal(true);
  });

  it('keeps allowOldGit when it is true, also after acceptSpareStash', () => {
    setStashPolicy({ acceptedLeftoverShas: [], onSpareStash: acceptSpareStash, allowOldGit: true });
    expect(getStashPolicy().allowOldGit).to.equal(true);
    acceptSpareStash('b'.repeat(40));
    const policy = getStashPolicy();
    expect(policy).to.deep.equal({ acceptedLeftoverShas: ['b'.repeat(40)], onSpareStash: acceptSpareStash, allowOldGit: true });
    expect(Object.isFrozen(policy)).to.equal(true);
  });

  it('keeps an allowOldGit key only for true, never for false or absent', () => {
    setStashPolicy({ acceptedLeftoverShas: [], allowOldGit: true });
    expect(Object.keys(getStashPolicy())).to.deep.equal(['acceptedLeftoverShas', 'allowOldGit']);
    for (const allowOldGit of [false, undefined]) {
      setStashPolicy({ acceptedLeftoverShas: [], allowOldGit });
      expect(Object.keys(getStashPolicy()), String(allowOldGit)).to.deep.equal(['acceptedLeftoverShas']);
    }
  });

  it('goes back to the default on the test reset', () => {
    setStashPolicy({ acceptedLeftoverShas: ['a'.repeat(40)] });
    __resetStashPolicyForTests();
    expect(getStashPolicy()).to.deep.equal({ acceptedLeftoverShas: [] });
  });
});
