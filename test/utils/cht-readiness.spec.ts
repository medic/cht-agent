import { expect } from 'chai';
import * as sinon from 'sinon';
import { waitForReady } from '../../src/utils/cht-readiness';

describe('cht-readiness', () => {
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    // `fetch` is a Node global; stub it the same way the MCP client spec does.
    fetchStub = sinon.stub(globalThis, 'fetch' as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  // Zero delays keep the backoff loop fast in tests.
  const fast = { initialDelayMs: 0, maxDelayMs: 0 };

  describe('waitForReady', () => {
    it('resolves once monitoring responds OK', async () => {
      fetchStub.resolves({ ok: true, status: 200 });

      await waitForReady('https://nginx', fast);

      expect(fetchStub.calledOnce).to.equal(true);
      expect(fetchStub.firstCall.args[0]).to.equal('https://nginx/api/v2/monitoring');
    });

    it('retries until healthy (503, 503, then 200)', async () => {
      fetchStub.onCall(0).resolves({ ok: false, status: 503 });
      fetchStub.onCall(1).resolves({ ok: false, status: 503 });
      fetchStub.onCall(2).resolves({ ok: true, status: 200 });

      const result = await waitForReady('https://nginx', fast);

      expect(result).to.be.undefined;
      expect(fetchStub.callCount).to.equal(3);
    });

    it('retries when fetch rejects (connection refused), then succeeds', async () => {
      fetchStub.onCall(0).rejects(new Error('ECONNREFUSED'));
      fetchStub.onCall(1).resolves({ ok: true, status: 200 });

      const result = await waitForReady('https://nginx', fast);

      expect(result).to.be.undefined;
      expect(fetchStub.callCount).to.equal(2);
    });

    it('rejects with a clear message if never ready before timeout', async () => {
      fetchStub.resolves({ ok: false, status: 503 });

      try {
        await waitForReady('https://nginx', { initialDelayMs: 0, maxDelayMs: 0, maxWaitMs: 30 });
        expect.fail('expected waitForReady to reject');
      } catch (error) {
        expect((error as Error).message).to.include('did not become ready');
        expect((error as Error).message).to.include('https://nginx');
      }
    });
  });
});
