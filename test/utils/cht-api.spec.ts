import { expect } from 'chai';
import * as sinon from 'sinon';
import { bulkDocs, fetchDocRevs, fetchFormRevs, fetchSettings } from '../../src/utils/cht-api';

describe('cht-api', () => {
  let fetchStub: sinon.SinonStub;

  const auth = { user: 'medic', password: 'password' };
  const URL_BASE = 'https://nginx';
  const EXPECTED_AUTH = `Basic ${Buffer.from('medic:password').toString('base64')}`;

  const jsonResponse = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch' as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('fetchSettings', () => {
    it('GETs /api/v1/settings with basic auth and returns the settings object', async () => {
      fetchStub.resolves(jsonResponse({ roles: { chw: {} } }));

      const settings = await fetchSettings(URL_BASE, auth);

      expect(settings).to.deep.equal({ roles: { chw: {} } });
      expect(fetchStub.firstCall.args[0]).to.equal('https://nginx/api/v1/settings');
      const init = fetchStub.firstCall.args[1];
      expect(init.method).to.equal('GET');
      expect(init.headers.Authorization).to.equal(EXPECTED_AUTH);
    });

    it('bounds every request with an abort signal', async () => {
      fetchStub.resolves(jsonResponse({}));

      await fetchSettings(URL_BASE, auth);

      expect(fetchStub.firstCall.args[1].signal).to.be.instanceOf(AbortSignal);
    });

    it('throws with the path and status (never the password) on an HTTP error', async () => {
      fetchStub.resolves(jsonResponse({ error: 'unauthorized' }, 401));

      try {
        await fetchSettings(URL_BASE, auth);
        expect.fail('expected fetchSettings to reject');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).to.include('/api/v1/settings');
        expect(message).to.include('401');
        expect(message).to.not.include('password');
      }
    });

    it('throws when the body is not a JSON object', async () => {
      fetchStub.resolves(jsonResponse(['not', 'an', 'object']));

      try {
        await fetchSettings(URL_BASE, auth);
        expect.fail('expected fetchSettings to reject');
      } catch (error) {
        expect((error as Error).message).to.include('non-object body');
      }
    });
  });

  describe('fetchFormRevs', () => {
    it('queries the medic _all_docs form: key range and maps id + rev', async () => {
      fetchStub.resolves(
        jsonResponse({
          rows: [
            { id: 'form:delivery', key: 'form:delivery', value: { rev: '1-def' } },
            { id: 'form:pregnancy', key: 'form:pregnancy', value: { rev: '3-abc' } },
          ],
        })
      );

      const revs = await fetchFormRevs(URL_BASE, auth);

      expect(revs).to.deep.equal([
        { id: 'form:delivery', rev: '1-def' },
        { id: 'form:pregnancy', rev: '3-abc' },
      ]);
      const requested = fetchStub.firstCall.args[0] as string;
      expect(requested).to.include('https://nginx/medic/_all_docs?');
      const query = new URL(requested).searchParams;
      expect(query.get('startkey')).to.equal('"form:"');
      expect(query.get('endkey')).to.equal(JSON.stringify('form:\ufff0'));
    });

    it('drops deleted form docs and rows without an id', async () => {
      fetchStub.resolves(
        jsonResponse({
          rows: [
            { id: 'form:old', key: 'form:old', value: { rev: '2-dead', deleted: true } },
            { key: 'form:ghost', error: 'not_found' },
            { id: 'form:live', key: 'form:live', value: { rev: '1-live' } },
          ],
        })
      );

      const revs = await fetchFormRevs(URL_BASE, auth);

      expect(revs).to.deep.equal([{ id: 'form:live', rev: '1-live' }]);
    });
  });

  describe('fetchDocRevs', () => {
    it('returns [] without a request when no ids are given', async () => {
      const rows = await fetchDocRevs(URL_BASE, auth, []);

      expect(rows).to.deep.equal([]);
      expect(fetchStub.called).to.equal(false);
    });

    it('POSTs the ids as _all_docs keys and maps the current revs', async () => {
      fetchStub.resolves(
        jsonResponse({
          rows: [{ id: 'doc-1', key: 'doc-1', value: { rev: '5-cur' } }],
        })
      );

      const rows = await fetchDocRevs(URL_BASE, auth, ['doc-1']);

      expect(rows).to.deep.equal([{ id: 'doc-1', rev: '5-cur' }]);
      expect(fetchStub.firstCall.args[0]).to.equal('https://nginx/medic/_all_docs');
      const init = fetchStub.firstCall.args[1];
      expect(init.method).to.equal('POST');
      expect(JSON.parse(init.body)).to.deep.equal({ keys: ['doc-1'] });
      expect(init.headers['Content-Type']).to.equal('application/json');
    });

    it('marks never-existed docs as missing and tombstones as deleted', async () => {
      fetchStub.resolves(
        jsonResponse({
          rows: [
            { key: 'doc-gone', error: 'not_found' },
            { id: 'doc-tomb', key: 'doc-tomb', value: { rev: '2-tomb', deleted: true } },
          ],
        })
      );

      const rows = await fetchDocRevs(URL_BASE, auth, ['doc-gone', 'doc-tomb']);

      expect(rows).to.deep.equal([
        { id: 'doc-gone', missing: true },
        { id: 'doc-tomb', rev: '2-tomb', deleted: true },
      ]);
    });
  });

  describe('bulkDocs', () => {
    it('returns [] without a request when no docs are given', async () => {
      const outcome = await bulkDocs(URL_BASE, auth, []);

      expect(outcome).to.deep.equal([]);
      expect(fetchStub.called).to.equal(false);
    });

    it('POSTs the docs to _bulk_docs and returns the per-doc outcomes', async () => {
      fetchStub.resolves(jsonResponse([{ id: 'doc-1', ok: true, rev: '6-new' }]));
      const tombstone = { _id: 'doc-1', _rev: '5-cur', _deleted: true };

      const outcome = await bulkDocs(URL_BASE, auth, [tombstone]);

      expect(outcome).to.deep.equal([{ id: 'doc-1', ok: true, rev: '6-new' }]);
      expect(fetchStub.firstCall.args[0]).to.equal('https://nginx/medic/_bulk_docs');
      const init = fetchStub.firstCall.args[1];
      expect(init.method).to.equal('POST');
      expect(JSON.parse(init.body)).to.deep.equal({ docs: [tombstone] });
      expect(init.headers.Authorization).to.equal(EXPECTED_AUTH);
    });

    it('throws on an HTTP error status', async () => {
      fetchStub.resolves(jsonResponse({ error: 'server' }, 500));

      try {
        await bulkDocs(URL_BASE, auth, [{ _id: 'doc-1' }]);
        expect.fail('expected bulkDocs to reject');
      } catch (error) {
        expect((error as Error).message).to.include('500');
      }
    });

    it('normalizes a non-array response body to []', async () => {
      fetchStub.resolves(jsonResponse({ unexpected: true }));

      const outcome = await bulkDocs(URL_BASE, auth, [{ _id: 'doc-1' }]);

      expect(outcome).to.deep.equal([]);
    });
  });
});
