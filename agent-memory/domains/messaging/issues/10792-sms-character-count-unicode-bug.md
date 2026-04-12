---
id: cht-core-10792
category: bug
domain: messaging
subDomain: sms
issueNumber: 10792
issueUrl: https://github.com/medic/cht-core/issues/10792
title: SMS character count calculation incorrect for Unicode messages
lastUpdated: 2026-04-12
summary: SMS character count calculations were incorrect for messages containing Unicode characters, causing messages to be split incorrectly and sometimes not delivered at all.
services:
  - api
  - sms-gateway
techStack:
  - javascript
  - nodejs
  - sms-gateway
---

## Problem

SMS messages containing Unicode characters like emojis, accented letters, and non-Latin scripts were being calculated incorrectly, causing them to be split at wrong points or rejected as too long. This meant messages would arrive incomplete or not delivered, breaking communication with users who needed these characters.

## Root Cause

The SMS character counting logic was using basic ASCII-based calculations that treated all characters as single bytes. However, Unicode characters can be represented as multiple code points and require different encoding:
1. ASCII characters: 1 byte each
2. Basic Multilingual Plane characters: 2 bytes each in UTF-16
3. Supplementary Plane characters (emojis, some symbols): 4 bytes each in UTF-16

The system was incorrectly counting all characters as 1 byte, leading to wrong length calculations.

## Solution

Implemented proper Unicode-aware SMS character counting:
- Created a Unicode-to-GSM-7 converter for character counting
- Implemented proper SMS encoding detection (GSM-7 vs UCS-2)
- Added accurate character length calculation for Unicode messages
- Created message splitting logic that respects Unicode boundaries
- Added encoding fallback mechanisms for mixed-content messages

The key improvement was using the `String.prototype.length` property correctly and accounting for Unicode character encoding.

## Code Patterns

- Use proper Unicode counting: `const unicodeLength = message.length;`
- Detect SMS encoding: `const encoding = detectSmsEncoding(message);`
- Calculate accurate SMS lengths: `const smsLength = calculateSmsLength(message, encoding);`
- Split messages at Unicode boundaries: `const parts = splitUnicodeMessage(message, maxLength);`
- Pattern: `const smsInfo = calculateSmsLength(message);` returns accurate character count and encoding type
- File: `sms-gateway/src/utils/sms-length.js` contains the core SMS length calculation logic
- The fix ensures accurate SMS delivery for all character types

## Design Choices

Chose to implement proper Unicode counting rather than filtering characters because international users need to communicate in their native languages. The solution preserves all message content while ensuring reliable SMS delivery across all character sets.

## Related Files

- sms-gateway/src/utils/sms-length.js
- sms-gateway/src/processors/sms-splitter.js
- api/src/controllers/sms-controller.js
- test/unit/sms-length.test.js

## Testing

- Created comprehensive test suite covering all Unicode character types
- Tested with real-world messages from different languages
- Verified accuracy against GSM-7 and UCS-2 encoding standards
- Performance testing for message splitting algorithms
- Edge case testing with mixed-content messages

## Related Issues

- #10729: SMS parsing with special characters
- #10802: Message processing state management
- Multiple issues related to international SMS delivery