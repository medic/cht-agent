---
id: cht-core-10729
category: bug
domain: messaging
subDomain: sms
issueNumber: 10729
issueUrl: https://github.com/medic/cht-core/issues/10729
title: SMS parsing fails for messages with special characters in rapidpro integration
lastUpdated: 2026-04-12
summary: SMS messages containing special characters like emojis, accented letters, and Unicode symbols were failing to parse correctly in the RapidPro integration layer, causing message delivery failures and data corruption.
services:
  - api
  - sms-gateway
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

Community Health Workers were unable to receive SMS messages containing special characters like emojis, accented letters (é, ñ, ü), and other Unicode symbols. These messages would either fail to deliver entirely or arrive with corrupted text, making communication impossible. The issue specifically affected the RapidPro integration layer which handles incoming SMS processing and message routing.

## Root Cause

The SMS parsing logic in `smsparser.js` was using basic string splitting and regex patterns that couldn't handle Unicode characters properly. When messages contained special characters, the parsing would fail at different stages:
- Character encoding mismatches between UTF-8 and ASCII
- Incorrect splitting on multi-byte character boundaries
- Regex patterns not accounting for Unicode word boundaries

This caused the parser to either crash or produce malformed message objects that downstream systems couldn't process.

## Solution

Rewrote the SMS parsing logic to use proper Unicode-aware processing:
- Replaced basic string operations with `String.prototype.normalize()` for consistent character handling
- Used Unicode-aware regex patterns with the `u` flag
- Implemented proper encoding detection and conversion
- Added fallback mechanisms for malformed UTF-8 sequences
- Created a character-by-character validation step before parsing

The key improvement was using JavaScript's built-in Unicode support instead of custom string manipulation logic.

## Code Patterns

- Always normalize strings before processing: `str.normalize('NFC')`
- Use Unicode-aware regex: `/pattern/u` instead of `/pattern/`
- Handle encoding detection with `Buffer.from()` and `TextDecoder`
- Validate character ranges before processing
- Pattern: `const normalized = message.normalize('NFC');` ensures consistent character representation
- File: `smsparser.js` contains the core SMS parsing logic
- The fix maintains backward compatibility while adding Unicode support

## Design Choices

Chose to fix at the parsing layer rather than filtering characters because special characters are legitimate content that users need to communicate. The solution preserves all message content while ensuring reliable processing. This approach maintains user freedom of expression while fixing the technical limitations.

## Related Files

- smsparser.js
- api/src/controllers/sms-controller.js
- sms-gateway/src/processors/message-processor.js
- test/unit/smsparser.test.js

## Testing

- Added comprehensive Unicode test cases covering emojis, accented letters, and symbols
- Tested with real-world messages from different regions
- Verified backward compatibility with existing ASCII-only messages
- Performance testing to ensure Unicode parsing doesn't significantly impact throughput
- Edge case testing for malformed UTF-8 sequences

## Related Issues

- #10802: Similar message processing issue in scheduled tasks
- Multiple issues related to character encoding in international deployments