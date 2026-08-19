/**
 * Acceptance tests against REAL cht-core history.
 *
 * Every other probe spec drives a git double, which is the right default: the
 * suite has to run on a host with no 300MB checkout. But the two defects these
 * probes exist for were both "nobody ran the one-line git command", and a double
 * can only ever replay what its author believed the command returns. So the same
 * cases run once more against the actual clone whenever one is available.
 *
 * Opt-in by construction: export `CHT_CORE_PATH` and have the evidence fetched
 * (`refs/verify/pr10083`, `origin/master`). Anything missing skips the block
 * rather than failing it — a laptop without the clone is not a defect.
 */

import { expect } from 'chai';
import { execFileSync } from 'node:child_process';
import { checkClaim, defaultExec, Anchor, Claim, ProbeCtx } from '../../src/scripts/claim-probes';

const CORE = process.env.CHT_CORE_PATH;

/** True when `rev` resolves in the clone — the evidence this file needs. */
function hasRef(rev: string): boolean {
  try {
    execFileSync('git', ['-C', CORE as string, 'rev-parse', '--verify', '--quiet', rev], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ctx = (): ProbeCtx => ({
  chtCorePath: CORE as string,
  exec: defaultExec,
  apiResolve: false,
  prFiles: new Map(),
  treeCache: new Map(),
  apiCache: new Map(),
});

/** Any anchor will do: neither probe below reads it. */
const ANCHOR: Anchor = { sha: 'origin/master', subject: 'n/a', isRevert: false };

describe('probes against real cht-core history', function () {
  this.timeout(60000);

  describe('sha-unreachable', () => {
    // cht-agent#122 round 4: a repair commit claimed this sha was gone because
    // the ui-extensions epic squashed it. It is in the clone, reachable from the
    // durable pull ref.
    const SHA = '70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87';
    const QUOTE = 'The commit is absent from a clone because the epic squashed it away.';

    beforeEach(function () {
      if (!CORE || !hasRef('refs/verify/pr10083')) this.skip();
    });

    it('refutes the claim: the commit is reachable from refs/verify/pr10083', () => {
      const v = checkClaim(ctx(), ANCHOR, { kind: 'sha-unreachable', sha: SHA, quote: QUOTE });
      expect(v.outcome).to.equal('ungrounded');
      expect(v.evidence).to.contain('refs/verify/pr10083');
    });

    it('does not call a sha nobody has "unreachable"', () => {
      // Well-formed, absent from every clone on earth. Absence here is a fact
      // about this checkout's refs, so the only honest verdict is unverifiable.
      const claim: Claim = {
        kind: 'sha-unreachable', sha: '0123456789abcdef0123456789abcdef01234567', quote: QUOTE,
      };
      expect(checkClaim(ctx(), ANCHOR, claim).outcome).to.equal('unverifiable');
    });
  });
});
