import { expect } from 'chai';
import * as path from 'node:path';
import { parseTicketFile, findTicketFiles } from '../../src/utils/ticket-parser';

describe('ticket-parser', () => {
  const fixturesPath = path.join(__dirname, '../fixtures');

  describe('parseTicketFile', () => {
    describe('valid tickets', () => {
      let validTicketResult: ReturnType<typeof parseTicketFile>;
      let asteriskTicketResult: ReturnType<typeof parseTicketFile>;

      before(() => {
        validTicketResult = parseTicketFile(path.join(fixturesPath, 'valid-ticket.md'));
        asteriskTicketResult = parseTicketFile(path.join(fixturesPath, 'valid-ticket-asterisk.md'));
      });

      it('should parse a fully populated ticket', () => {
        expect(validTicketResult.issue.title).to.equal('Test feature implementation');
        expect(validTicketResult.issue.type).to.equal('feature');
        expect(validTicketResult.issue.priority).to.equal('high');
        expect(validTicketResult.issue.technical_context.domain).to.equal('contacts');
      });

      it('should extract components from technical context', () => {
        expect(validTicketResult.issue.technical_context.components).to.deep.equal([
          'webapp/modules/contacts',
          'api/controllers/contacts',
        ]);
      });

      it('should extract requirements as array', () => {
        expect(validTicketResult.issue.requirements).to.have.lengthOf(3);
        expect(validTicketResult.issue.requirements[0]).to.equal('First requirement');
        expect(validTicketResult.issue.requirements[1]).to.equal('Second requirement');
        expect(validTicketResult.issue.requirements[2]).to.equal('Third requirement');
      });

      it('should extract acceptance criteria from numbered list', () => {
        expect(validTicketResult.issue.acceptance_criteria).to.have.lengthOf(2);
        expect(validTicketResult.issue.acceptance_criteria[0]).to.equal('First acceptance criterion');
        expect(validTicketResult.issue.acceptance_criteria[1]).to.equal('Second acceptance criterion');
      });

      it('should extract constraints', () => {
        expect(validTicketResult.issue.constraints).to.have.lengthOf(2);
        expect(validTicketResult.issue.constraints).to.include('Must work offline');
        expect(validTicketResult.issue.constraints).to.include('Compatible with CHT 4.x');
      });

      it('should extract reference URLs', () => {
        expect(validTicketResult.issue.reference_data?.similar_implementations).to.include(
          'https://github.com/medic/cht-core/pull/1234'
        );
        expect(validTicketResult.issue.reference_data?.documentation).to.include(
          'https://docs.communityhealthtoolkit.org/apps/reference/contact-page/'
        );
      });

      it('should extract description from Description section', () => {
        expect(validTicketResult.issue.description).to.include('test feature for unit testing');
      });

      it('should parse a minimal ticket with only required fields', () => {
        const minimalResult = parseTicketFile(path.join(fixturesPath, 'minimal-ticket.md'));

        expect(minimalResult.issue.title).to.equal('Minimal ticket');
        expect(minimalResult.issue.type).to.equal('bug');
        expect(minimalResult.issue.priority).to.equal('low');
        expect(minimalResult.issue.technical_context.domain).to.equal('configuration');
        expect(minimalResult.issue.technical_context.components).to.deep.equal([]);
        expect(minimalResult.issue.requirements).to.deep.equal([]);
        expect(minimalResult.issue.acceptance_criteria).to.deep.equal([]);
        expect(minimalResult.issue.constraints).to.deep.equal([]);
      });

      it('should parse asterisk bullet lists', () => {
        expect(asteriskTicketResult.issue.requirements).to.include('First requirement with asterisk');
        expect(asteriskTicketResult.issue.requirements).to.include('Second requirement with asterisk');
        expect(asteriskTicketResult.issue.constraints).to.include('Constraint using asterisk');
      });

      it('should extract URLs from markdown links [text](url)', () => {
        expect(asteriskTicketResult.issue.reference_data?.similar_implementations).to.include(
          'https://github.com/medic/cht-core/pull/5678'
        );
        expect(asteriskTicketResult.issue.reference_data?.documentation).to.include(
          'https://docs.communityhealthtoolkit.org/apps/guides/messaging/'
        );
      });

      it('should extract both markdown link URLs and plain URLs', () => {
        // Should have both the markdown link URL and the plain URL
        expect(asteriskTicketResult.issue.reference_data?.similar_implementations).to.have.lengthOf(2);
      });

      it('should extract non-backtick components from technical context', () => {
        // Should include both backtick-wrapped and non-backtick items
        expect(asteriskTicketResult.issue.technical_context.components).to.include('api/messaging');
        expect(asteriskTicketResult.issue.technical_context.components).to.include('webapp/sms-gateway');
      });

      it('should extract existing references from technical context', () => {
        expect(asteriskTicketResult.issue.technical_context.existing_references).to.include('existing-ref-1');
        expect(asteriskTicketResult.issue.technical_context.existing_references).to.include('existing-ref-2');
      });
    });

    describe('invalid tickets', () => {
      const invalidCases = [
        { file: 'non-existent.md', error: 'Ticket file not found' },
        { file: 'invalid-missing-title.md', error: 'Ticket must have a "title"' },
        { file: 'invalid-domain.md', error: 'Invalid domain' },
        { file: 'invalid-type.md', error: 'Invalid type' },
        { file: 'invalid-priority.md', error: 'Invalid priority' },
        { file: 'invalid-missing-domain.md', error: 'Ticket must have a "domain"' },
      ];

      invalidCases.forEach(({ file, error }) => {
        it(`should throw error when ${file.replace('.md', '').replaceAll('-', ' ').replace('invalid ', '')}`, () => {
          const ticketPath = path.join(fixturesPath, file);
          expect(() => parseTicketFile(ticketPath)).to.throw(error);
        });
      });
    });
  });

  describe('findTicketFiles', () => {
    it('should find markdown files in directory', () => {
      const files = findTicketFiles(fixturesPath);

      expect(files).to.be.an('array');
      expect(files.length).to.be.greaterThan(0);
      expect(files.every((f) => f.endsWith('.md'))).to.be.true;
    });

    it('should return empty array for non-existent directory', () => {
      const files = findTicketFiles('/non/existent/path');

      expect(files).to.deep.equal([]);
    });

    it('should exclude README files', () => {
      const files = findTicketFiles(fixturesPath);

      expect(files.every((f) => !f.toLowerCase().includes('readme'))).to.be.true;
    });
  });
});
