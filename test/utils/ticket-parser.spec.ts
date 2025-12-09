import { expect } from 'chai';
import * as path from 'path';
import { parseTicketFile, findTicketFiles } from '../../src/utils/ticket-parser';

describe('ticket-parser', () => {
  const fixturesPath = path.join(__dirname, '../fixtures');

  describe('parseTicketFile', () => {
    describe('valid tickets', () => {
      it('should parse a fully populated ticket', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.title).to.equal('Test feature implementation');
        expect(result.issue.type).to.equal('feature');
        expect(result.issue.priority).to.equal('high');
        expect(result.issue.technical_context.domain).to.equal('contacts');
      });

      it('should extract components from technical context', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.technical_context.components).to.deep.equal([
          'webapp/modules/contacts',
          'api/controllers/contacts',
        ]);
      });

      it('should extract requirements as array', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.requirements).to.have.lengthOf(3);
        expect(result.issue.requirements[0]).to.equal('First requirement');
        expect(result.issue.requirements[1]).to.equal('Second requirement');
        expect(result.issue.requirements[2]).to.equal('Third requirement');
      });

      it('should extract acceptance criteria from numbered list', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.acceptance_criteria).to.have.lengthOf(2);
        expect(result.issue.acceptance_criteria[0]).to.equal('First acceptance criterion');
        expect(result.issue.acceptance_criteria[1]).to.equal('Second acceptance criterion');
      });

      it('should extract constraints', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.constraints).to.have.lengthOf(2);
        expect(result.issue.constraints).to.include('Must work offline');
        expect(result.issue.constraints).to.include('Compatible with CHT 4.x');
      });

      it('should extract reference URLs', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.reference_data?.similar_implementations).to.include(
          'https://github.com/medic/cht-core/pull/1234'
        );
        expect(result.issue.reference_data?.documentation).to.include(
          'https://docs.communityhealthtoolkit.org/apps/reference/contact-page/'
        );
      });

      it('should extract description from Description section', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.description).to.include('test feature for unit testing');
      });

      it('should parse a minimal ticket with only required fields', () => {
        const ticketPath = path.join(fixturesPath, 'minimal-ticket.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.title).to.equal('Minimal ticket');
        expect(result.issue.type).to.equal('bug');
        expect(result.issue.priority).to.equal('low');
        expect(result.issue.technical_context.domain).to.equal('configuration');
        expect(result.issue.technical_context.components).to.deep.equal([]);
        expect(result.issue.requirements).to.deep.equal([]);
        expect(result.issue.acceptance_criteria).to.deep.equal([]);
        expect(result.issue.constraints).to.deep.equal([]);
      });

      it('should parse asterisk bullet lists', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket-asterisk.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.requirements).to.include('First requirement with asterisk');
        expect(result.issue.requirements).to.include('Second requirement with asterisk');
        expect(result.issue.constraints).to.include('Constraint using asterisk');
      });

      it('should extract URLs from markdown links [text](url)', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket-asterisk.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.reference_data?.similar_implementations).to.include(
          'https://github.com/medic/cht-core/pull/5678'
        );
        expect(result.issue.reference_data?.documentation).to.include(
          'https://docs.communityhealthtoolkit.org/apps/guides/messaging/'
        );
      });

      it('should extract both markdown link URLs and plain URLs', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket-asterisk.md');
        const result = parseTicketFile(ticketPath);

        // Should have both the markdown link URL and the plain URL
        expect(result.issue.reference_data?.similar_implementations).to.have.lengthOf(2);
      });

      it('should extract non-backtick components from technical context', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket-asterisk.md');
        const result = parseTicketFile(ticketPath);

        // Should include both backtick-wrapped and non-backtick items
        expect(result.issue.technical_context.components).to.include('api/messaging');
        expect(result.issue.technical_context.components).to.include('webapp/sms-gateway');
      });

      it('should extract existing references from technical context', () => {
        const ticketPath = path.join(fixturesPath, 'valid-ticket-asterisk.md');
        const result = parseTicketFile(ticketPath);

        expect(result.issue.technical_context.existing_references).to.include('existing-ref-1');
        expect(result.issue.technical_context.existing_references).to.include('existing-ref-2');
      });
    });

    describe('invalid tickets', () => {
      it('should throw error when file does not exist', () => {
        const ticketPath = path.join(fixturesPath, 'non-existent.md');

        expect(() => parseTicketFile(ticketPath)).to.throw('Ticket file not found');
      });

      it('should throw error when title is missing', () => {
        const ticketPath = path.join(fixturesPath, 'invalid-missing-title.md');

        expect(() => parseTicketFile(ticketPath)).to.throw('Ticket must have a "title"');
      });

      it('should throw error for invalid domain', () => {
        const ticketPath = path.join(fixturesPath, 'invalid-domain.md');

        expect(() => parseTicketFile(ticketPath)).to.throw('Invalid domain');
      });

      it('should throw error for invalid type', () => {
        const ticketPath = path.join(fixturesPath, 'invalid-type.md');

        expect(() => parseTicketFile(ticketPath)).to.throw('Invalid type');
      });

      it('should throw error for invalid priority', () => {
        const ticketPath = path.join(fixturesPath, 'invalid-priority.md');

        expect(() => parseTicketFile(ticketPath)).to.throw('Invalid priority');
      });

      it('should throw error when domain is missing', () => {
        const ticketPath = path.join(fixturesPath, 'invalid-missing-domain.md');

        expect(() => parseTicketFile(ticketPath)).to.throw('Ticket must have a "domain"');
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
