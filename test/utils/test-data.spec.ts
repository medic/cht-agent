import { expect } from 'chai';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SeededDoc,
  classifySeededDocs,
  cleanSeededDocs,
  countCreatedUsers,
  hasUsersCsv,
  parseUploadDocsSummary,
  readSeededDocs,
} from '../../src/utils/test-data';
import { DiscoveredConfig } from '../../src/types';

// Literal cht-conf log lines (src/lib/log.js prefixes every line with an ANSI
// color + level and appends a reset code) — the parsers must see through them.
const ansiInfo = (message: string): string => `\x1b[32mINFO ${message} \x1b[0m`;

describe('test-data', () => {
  describe('parseUploadDocsSummary', () => {
    it('parses the real upload-docs summary line through its ANSI wrapping', () => {
      const line = ansiInfo('Summary: 12 of 12 docs uploaded OK.  Full report written to: upload-docs.1.log.json');

      expect(parseUploadDocsSummary(line)).to.deep.equal({ uploaded: 12, total: 12 });
    });

    it('reports a partial upload', () => {
      const output = ['some earlier line', ansiInfo('Summary: 10 of 12 docs uploaded OK.')].join('\n');

      expect(parseUploadDocsSummary(output)).to.deep.equal({ uploaded: 10, total: 12 });
    });

    it('returns undefined when no summary was printed (nothing to upload)', () => {
      expect(parseUploadDocsSummary(ansiInfo('No docs directory found at /data/json_docs.'))).to.equal(undefined);
    });
  });

  describe('countCreatedUsers', () => {
    it('counts the real "Creating user" progress lines through their ANSI wrapping', () => {
      const output = [ansiInfo('Creating user alice'), ansiInfo('Creating user bob')].join('\n');

      expect(countCreatedUsers(output)).to.equal(2);
    });

    it('returns 0 when no user was created', () => {
      expect(countCreatedUsers(ansiInfo('All actions completed.'))).to.equal(0);
    });

    it('does not count the user-info preflight lines', () => {
      const output = [ansiInfo('Requesting user-info for "alice"'), ansiInfo('Creating user alice')].join('\n');

      expect(countCreatedUsers(output)).to.equal(1);
    });
  });

  describe('json_docs fixtures', () => {
    let dataPath: string;

    const writeDoc = (id: string, doc: Record<string, unknown>): void => {
      writeFileSync(join(dataPath, 'json_docs', `${id}.doc.json`), JSON.stringify({ _id: id, ...doc }));
    };

    beforeEach(() => {
      dataPath = mkdtempSync(join(tmpdir(), 'cht-test-data-'));
      mkdirSync(join(dataPath, 'json_docs'));
    });

    afterEach(() => {
      rmSync(dataPath, { recursive: true, force: true });
    });

    describe('hasUsersCsv', () => {
      it('is true when the data project has a users.csv', () => {
        writeFileSync(join(dataPath, 'users.csv'), 'username,password,roles\n');

        expect(hasUsersCsv(dataPath)).to.equal(true);
      });

      it('is false when there is no users.csv', () => {
        expect(hasUsersCsv(dataPath)).to.equal(false);
      });
    });

    describe('readSeededDocs', () => {
      it('reads id, type, and contact_type from every .doc.json, sorted by filename', () => {
        writeDoc('b-person', { type: 'person' });
        writeDoc('a-contact', { type: 'contact', contact_type: 'chw' });

        const docs = readSeededDocs(dataPath);

        expect(docs).to.deep.equal([
          { id: 'a-contact', type: 'contact', contactType: 'chw' },
          { id: 'b-person', type: 'person' },
        ]);
      });

      it('ignores files that are not .doc.json', () => {
        writeDoc('real-doc', { type: 'clinic' });
        writeFileSync(join(dataPath, 'json_docs', 'upload-docs.1.log.json'), '{}');

        const docs = readSeededDocs(dataPath);

        expect(docs.map((doc) => doc.id)).to.deep.equal(['real-doc']);
      });

      it('returns [] when json_docs does not exist (csv-to-docs had no input)', () => {
        rmSync(join(dataPath, 'json_docs'), { recursive: true });

        expect(readSeededDocs(dataPath)).to.deep.equal([]);
      });

      it('throws on a malformed doc file rather than guessing the worklist', () => {
        writeFileSync(join(dataPath, 'json_docs', 'broken.doc.json'), '{not json');

        expect(() => readSeededDocs(dataPath)).to.throw();
      });
    });

    describe('cleanSeededDocs', () => {
      it('removes only the .doc.json files, keeping report logs and other project files', () => {
        writeDoc('stale-1', { type: 'clinic' });
        writeDoc('stale-2', { type: 'person' });
        writeFileSync(join(dataPath, 'json_docs', 'upload-docs.1.log.json'), '{}');
        writeFileSync(join(dataPath, 'users.csv'), 'username,password,roles\n');

        const removed = cleanSeededDocs(dataPath);

        expect(removed).to.equal(2);
        expect(readSeededDocs(dataPath)).to.deep.equal([]);
        expect(hasUsersCsv(dataPath)).to.equal(true); // files outside json_docs untouched
        expect(readdirSync(join(dataPath, 'json_docs'))).to.deep.equal(['upload-docs.1.log.json']);
      });

      it('returns 0 when json_docs does not exist', () => {
        rmSync(join(dataPath, 'json_docs'), { recursive: true });

        expect(cleanSeededDocs(dataPath)).to.equal(0);
      });
    });
  });

  describe('classifySeededDocs', () => {
    const config: DiscoveredConfig = {
      contactTypes: [
        { id: 'district_hospital' },
        { id: 'clinic', parents: ['district_hospital'] },
        { id: 'person', parents: ['clinic'], person: true },
        { id: 'chw_agent', parents: ['clinic'], person: true },
      ],
      roles: {},
      permissions: {},
      transitions: {},
      forms: [],
    };

    const doc = (id: string, type: string, contactType?: string): SeededDoc => ({
      id,
      type,
      ...(contactType !== undefined ? { contactType } : {}),
    });

    it('splits docs into places, people, and reports against the discovered config', () => {
      const docs = [
        doc('p1', 'district_hospital'),
        doc('p2', 'clinic'),
        doc('h1', 'person'),
        doc('r1', 'data_record'),
      ];

      const counts = classifySeededDocs(docs, config);

      expect(counts.places).to.equal(2);
      expect(counts.people).to.equal(1);
      expect(counts.reports).to.equal(1);
      expect(counts.warnings).to.deep.equal([]);
    });

    it('counts a custom person contact type (configurable hierarchy) as a person', () => {
      const counts = classifySeededDocs([doc('c1', 'contact', 'chw_agent')], config);

      expect(counts.people).to.equal(1);
      expect(counts.places).to.equal(0);
    });

    it('counts a custom place contact type via contact_type as a place', () => {
      const counts = classifySeededDocs([doc('c1', 'contact', 'clinic')], config);

      expect(counts.places).to.equal(1);
      expect(counts.people).to.equal(0);
    });

    it('does not count user docs (accounts are create-users territory)', () => {
      const counts = classifySeededDocs([doc('u1', 'user'), doc('r1', 'data_record')], config);

      expect(counts).to.deep.equal({ places: 0, people: 0, reports: 1, warnings: [] });
    });

    it('warns once per unknown contact type and counts it as a place', () => {
      const docs = [doc('x1', 'warehouse'), doc('x2', 'warehouse')];

      const counts = classifySeededDocs(docs, config);

      expect(counts.places).to.equal(2);
      expect(counts.warnings).to.have.lengthOf(1);
      expect(counts.warnings[0]).to.include('warehouse');
    });
  });
});
