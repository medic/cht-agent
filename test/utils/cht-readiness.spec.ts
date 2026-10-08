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
  const healthy = () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: { app: '4.18.0', couchdb: '3.4.2' } }),
  });
  const unavailable = () => ({ ok: false, status: 503, json: async () => ({ error: 'Service unavailable' }) });
  const expectRejection = async (promise: Promise<void>): Promise<Error> => {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    expect.fail('expected waitForReady to reject');
  };

  describe('waitForReady', () => {
    it('resolves once monitoring reports both versions, asking for JSON', async () => {
      fetchStub.resolves(healthy());

      await waitForReady('https://nginx', fast);

      expect(fetchStub.calledOnce).to.equal(true);
      expect(fetchStub.firstCall.args[0]).to.equal('https://nginx/api/v2/monitoring');
      expect(fetchStub.firstCall.args[1].headers.Accept).to.equal('application/json');
    });

    it('keeps polling past the 200 startup page cht-api serves before it is up', async () => {
      fetchStub.onCall(0).resolves({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      });
      fetchStub.onCall(1).resolves(healthy());

      await waitForReady('https://nginx', fast);

      expect(fetchStub.callCount).to.equal(2);
    });

    it('treats an empty app or CouchDB version as not ready', async () => {
      const versions = (app: string, couchdb: string) => ({
        ok: true,
        status: 200,
        json: async () => ({ version: { app, couchdb } }),
      });
      fetchStub.onCall(0).resolves(versions('4.18.0', ''));
      fetchStub.onCall(1).resolves(versions('', '3.4.2'));
      fetchStub.onCall(2).resolves(healthy());

      await waitForReady('https://nginx', fast);

      expect(fetchStub.callCount).to.equal(3);
    });

    it('fails fast on a redirect instead of waiting out the budget', async () => {
      fetchStub.resolves({ ok: false, status: 301 });

      const error = await expectRejection(waitForReady('https://nginx', fast));

      expect(error.message).to.include('cannot become ready as configured');
      expect(fetchStub.firstCall.args[1].redirect).to.equal('manual');
      expect(fetchStub.callCount).to.equal(1);
    });

    it('fails fast on a 4xx, which no bring-up step answers (497: http sent to the https port)', async () => {
      fetchStub.resolves({ ok: false, status: 497 });

      const error = await expectRejection(waitForReady('https://nginx', fast));

      expect(error.message).to.include('cannot become ready as configured: HTTP 497');
      expect(fetchStub.callCount).to.equal(1);
    });

    it('keeps polling on 408 and 429, which can clear by themselves', async () => {
      fetchStub.onCall(0).resolves({ ok: false, status: 408 });
      fetchStub.onCall(1).resolves({ ok: false, status: 429 });
      fetchStub.onCall(2).resolves(healthy());

      await waitForReady('https://nginx', fast);

      expect(fetchStub.callCount).to.equal(3);
    });

    it('fails fast when the runtime does not trust the certificate', async () => {
      const cause = Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
      fetchStub.rejects(Object.assign(new TypeError('fetch failed'), { cause }));

      const error = await expectRejection(waitForReady('https://nginx', fast));

      expect(error.message).to.include('self-signed certificate');
      expect(error.message).to.include('NODE_EXTRA_CA_CERTS');
      expect(fetchStub.callCount).to.equal(1);
    });

    it('surfaces the underlying cause, which Node hides behind "fetch failed"', async () => {
      const failure = Object.assign(new TypeError('fetch failed'), {
        cause: new Error('connect ECONNREFUSED 172.18.0.3:443'),
      });
      fetchStub.rejects(failure);

      const error = await expectRejection(waitForReady('https://nginx', { ...fast, maxWaitMs: 5 }));

      expect(error.message).to.include('ECONNREFUSED');
    });

    it('names the cause code when its message is empty (an AggregateError for localhost)', async () => {
      const cause = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
      fetchStub.rejects(Object.assign(new TypeError('fetch failed'), { cause }));

      const error = await expectRejection(waitForReady('https://localhost', { ...fast, maxWaitMs: 5 }));

      expect(error.message).to.include('fetch failed (ECONNREFUSED)');
    });

    it('retries until healthy (503, 503, then 200)', async () => {
      fetchStub.onCall(0).resolves(unavailable());
      fetchStub.onCall(1).resolves(unavailable());
      fetchStub.onCall(2).resolves(healthy());

      const result = await waitForReady('https://nginx', fast);

      expect(result).to.be.undefined;
      expect(fetchStub.callCount).to.equal(3);
    });

    it('retries when fetch rejects (connection refused), then succeeds', async () => {
      fetchStub.onCall(0).rejects(new Error('ECONNREFUSED'));
      fetchStub.onCall(1).resolves(healthy());

      const result = await waitForReady('https://nginx', fast);

      expect(result).to.be.undefined;
      expect(fetchStub.callCount).to.equal(2);
    });

    it('rejects with a clear message if never ready before timeout', async () => {
      fetchStub.resolves(unavailable());

      const error = await expectRejection(waitForReady('https://nginx', { ...fast, maxWaitMs: 30 }));

      expect(error.message).to.include('did not become ready');
      expect(error.message).to.include('https://nginx');
    });

    it('gives the probe after the last sleep a real budget, not whatever was left over', async () => {
      // A slow instance that honours the abort signal: a ~1ms budget would abort it.
      const slowHealthy = (_url: string, init: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(healthy()), 50);
          init.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(init.signal.reason);
          });
        });
      fetchStub.onCall(0).resolves(unavailable());
      fetchStub.onCall(1).callsFake(slowHealthy);

      await waitForReady('https://nginx', { initialDelayMs: 5_000, maxDelayMs: 5_000, maxWaitMs: 1_200 });

      expect(fetchStub.callCount).to.equal(2);
    });

    it('logs each new failure reason once, so a long wait is not silent', async () => {
      const logSpy = sinon.spy(console, 'log');
      fetchStub.onCall(0).resolves(unavailable());
      fetchStub.onCall(1).resolves(unavailable());
      fetchStub.onCall(2).resolves(healthy());

      await waitForReady('https://nginx', fast);

      const notes = logSpy.getCalls().filter((call) => String(call.args[0]).startsWith('[cht-readiness]'));
      expect(notes).to.have.lengthOf(1);
      expect(String(notes[0].args[0])).to.include('HTTP 503');
    });

    it('rejects a budget that is not a finite number instead of polling forever', async () => {
      const error = await expectRejection(waitForReady('https://nginx', { maxWaitMs: Number.NaN }));

      expect(error.message).to.include('finite');
      expect(fetchStub.called).to.equal(false);
    });
  });
});
