import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import { validateTicketFile } from '../../src/utils/ticket-parser';

describe('Ticket Validation', () => {
  const fixturesPath = path.join(__dirname, '../fixtures');

  describe('valid tickets', () => {
    it('should validate complete ticket without errors', () => {
      const filePath = path.join(fixturesPath, 'valid-ticket.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.true;
      expect(result.errors).to.have.lengthOf(0);
    });

    it('should validate minimal ticket', () => {
      const filePath = path.join(fixturesPath, 'minimal-ticket.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.true;
      expect(result.errors).to.have.lengthOf(0);
    });

    it('should validate ticket with asterisks', () => {
      const filePath = path.join(fixturesPath, 'valid-ticket-asterisk.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.true;
      expect(result.errors).to.have.lengthOf(0);
    });
  });

  describe('invalid tickets', () => {
    it('should detect missing title', () => {
      const filePath = path.join(fixturesPath, 'invalid-missing-title.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Title is required in the YAML frontmatter');
    });

    it('should detect invalid type', () => {
      const filePath = path.join(fixturesPath, 'invalid-type.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Type must be one of: feature, bug, improvement');
    });

    it('should detect invalid priority', () => {
      const filePath = path.join(fixturesPath, 'invalid-priority.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Priority must be one of: high, medium, low');
    });

    it('should detect invalid domain', () => {
      const filePath = path.join(fixturesPath, 'invalid-domain.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Domain must be one of: authentication, contacts, forms-and-reports, tasks-and-targets, messaging, data-sync, configuration, interoperability');
    });

    it('should detect missing domain', () => {
      const filePath = path.join(fixturesPath, 'invalid-missing-domain.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Domain is required in the YAML frontmatter');
    });

    it('should detect empty description', () => {
      const filePath = path.join(fixturesPath, 'invalid-empty-description.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Description cannot be empty');
    });

    it('should handle missing files', () => {
      const filePath = path.join(fixturesPath, 'non-existent.md');
      const result = validateTicketFile(filePath);

      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Ticket file not found');
    });
  });

  describe('warnings', () => {
    it('should warn about brief description', () => {
      const briefTicket = `---
title: Brief
type: bug
priority: high
domain: messaging
---

## Description
Short text

## Requirements
- Requirement 1
`;

      const tempFile = path.join(fixturesPath, 'temp-brief.md');
      fs.writeFileSync(tempFile, briefTicket);

      try {
        const result = validateTicketFile(tempFile);

        expect(result.valid).to.be.true;
        expect(result.warnings).to.include('Description is brief - consider adding more detail');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should recommend markdown sections', () => {
      const noSections = `---
title: No Sections
type: feature
priority: medium
domain: contacts
---

Plain text without sections.
`;

      const tempFile = path.join(fixturesPath, 'temp-no-sections.md');
      fs.writeFileSync(tempFile, noSections);

      try {
        const result = validateTicketFile(tempFile);

        expect(result.valid).to.be.true;
        expect(result.warnings).to.include('Ticket should include markdown sections');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it('should recommend requirements and criteria', () => {
      const minimal = `---
title: Minimal
type: bug
priority: low
domain: configuration
---

## Description
A minimal ticket.
`;

      const tempFile = path.join(fixturesPath, 'temp-minimal.md');
      fs.writeFileSync(tempFile, minimal);

      try {
        const result = validateTicketFile(tempFile);

        expect(result.valid).to.be.true;
        expect(result.warnings).to.include('Consider adding requirements');
        expect(result.warnings).to.include('Consider adding acceptance criteria');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });
});