import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { validateTicketFile } from '../../src/utils/ticket-parser';

/**
 * Helper function to validate a ticket string and clean up temp file
 */
function validateTicketString(ticketContent: string): ReturnType<typeof validateTicketFile> {
  const tempFile = path.join(os.tmpdir(), `temp-${Date.now()}.md`);
  fs.writeFileSync(tempFile, ticketContent);

  try {
    return validateTicketFile(tempFile);
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

/**
 * Helper to assert valid ticket with no errors
 */
function assertValidTicket(filePath: string) {
  const result = validateTicketFile(filePath);
  expect(result.valid).to.be.true;
  expect(result.errors).to.have.lengthOf(0);
}

/**
 * Helper to assert invalid ticket with specific error
 */
function assertInvalidTicket(filePath: string, expectedError: string) {
  const result = validateTicketFile(filePath);
  expect(result.valid).to.be.false;
  expect(result.errors).to.include(expectedError);
}

/**
 * Helper to assert ticket warnings
 */
function assertTicketWarnings(ticket: string, expectedWarnings: string[]) {
  const result = validateTicketString(ticket);
  expect(result.valid).to.be.true;
  expectedWarnings.forEach((warning) => {
    expect(result.warnings).to.include(warning);
  });
}

describe('Ticket Validation', () => {
  const fixturesPath = path.join(__dirname, '../fixtures');

  describe('valid tickets', () => {
    const validTicketFiles = [
      'valid-ticket.md',
      'minimal-ticket.md',
      'valid-ticket-asterisk.md',
    ];

    validTicketFiles.forEach((fileName) => {
      it(`should validate ${fileName.replace('.md', '').replaceAll('-', ' ')}`, () => {
        const filePath = path.join(fixturesPath, fileName);
        assertValidTicket(filePath);
      });
    });
  });

  describe('invalid tickets', () => {
    const invalidTicketCases = [
      {
        file: 'invalid-missing-title.md',
        error: 'Title is required in the YAML frontmatter',
      },
      {
        file: 'invalid-type.md',
        error: 'Type must be one of: feature, bug, improvement',
      },
      {
        file: 'invalid-priority.md',
        error: 'Priority must be one of: high, medium, low',
      },
      {
        file: 'invalid-domain.md',
        error: 'Domain must be one of: authentication, contacts, forms-and-reports, tasks-and-targets, messaging, data-sync, configuration, interoperability',
      },
      {
        file: 'invalid-missing-domain.md',
        error: 'Domain is required in the YAML frontmatter',
      },
      {
        file: 'invalid-empty-description.md',
        error: 'Description cannot be empty',
      },
      {
        file: 'non-existent.md',
        error: 'Ticket file not found',
      },
    ];

    invalidTicketCases.forEach(({ file, error }) => {
      it(`should detect ${file.replace('invalid-', '').replace('.md', '').replaceAll('-', ' ')}`, () => {
        const filePath = path.join(fixturesPath, file);
        assertInvalidTicket(filePath, error);
      });
    });
  });

  describe('warnings', () => {
    const warningCases = [
      {
        name: 'brief description',
        ticket: `---
title: Brief
type: bug
priority: high
domain: messaging
---

## Description
Short text

## Requirements
- Requirement 1
`,
        expectedWarnings: ['Description is brief - consider adding more detail'],
      },
      {
        name: 'markdown sections',
        ticket: `---
title: No Sections
type: feature
priority: medium
domain: contacts
---

Plain text without sections.
`,
        expectedWarnings: ['Ticket should include markdown sections'],
      },
      {
        name: 'requirements and criteria',
        ticket: `---
title: Minimal
type: bug
priority: low
domain: configuration
---

## Description
A minimal ticket.
`,
        expectedWarnings: [
          'Consider adding requirements',
          'Consider adding acceptance criteria',
        ],
      },
    ];

    warningCases.forEach(({ name, ticket, expectedWarnings }) => {
      it(`should warn about ${name}`, () => {
        assertTicketWarnings(ticket, expectedWarnings);
      });
    });
  });
});
