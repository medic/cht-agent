---
id: cht-core-10783
category: bug
domain: messaging
subDomain: threading
issueNumber: 10783
issueUrl: https://github.com/medic/cht-core/issues/10783
title: Message threading breaks when replies contain emojis
lastUpdated: 2026-04-12
summary: Message conversation threading was breaking when users replied with emojis, causing replies to appear as separate conversations instead of being properly threaded under the original message.
services:
  - api
  - webapp
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

Message conversations were getting out of order when users included emojis in their replies. Instead of appearing as threaded replies under the original message, messages with emojis would appear as separate conversations in the chat interface. This made it difficult to follow conversations and maintain proper message threading.

## Root Cause

The message threading algorithm was using simple string matching and character counting to determine message relationships, but didn't account for Unicode characters like emojis which can be represented as multiple code points. When a reply contained emojis:
1. The message ID generation would create different IDs due to Unicode character variations
2. The threading reference matching would fail because the comparison didn't handle Unicode normalization
3. The database queries for related messages would fail to find the parent message

This caused the threading system to treat emoji-containing replies as new conversations.

## Solution

Updated the message threading system to properly handle Unicode characters:
- Implemented Unicode normalization for all message ID generation
- Used Unicode-aware string comparison for message threading
- Added emoji-safe message reference tracking
- Created a fallback threading mechanism for edge cases
- Implemented proper Unicode validation in message processing

The key improvement was ensuring all string operations used consistent Unicode handling.

## Code Patterns

- Normalize strings before processing: `message.content.normalize('NFC')`
- Use Unicode-aware comparisons: `const isRelated = compareMessages(msg1, msg2);`
- Handle emoji-safe message IDs: `const messageId = generateSafeId(content);`
- Use proper Unicode regex: `/pattern/u` for emoji detection
- Pattern: `const normalizedContent = message.content.normalize('NFC');` ensures consistent threading regardless of emoji usage
- File: `api/src/services/message-threading.js` contains the core threading logic
- The fix maintains conversation integrity even with emoji-rich messages

## Design Choices

Chose to fix at the message processing level rather than filtering emojis because emojis are legitimate communication tools that users need. The solution preserves all message content while ensuring reliable threading across all character types.

## Related Files

- api/src/services/message-threading.js
- api/src/controllers/messages.js
- webapp/src/components/MessageThread.vue
- test/unit/message-threading.test.js

## Testing

- Created comprehensive test cases with various emoji combinations
- Tested real-world conversations with emojis and special characters
- Verified backward compatibility with existing ASCII-only messages
- Performance testing for Unicode processing
- Edge case testing with mixed content and complex Unicode sequences

## Related Issues

- #10729: SMS parsing with special characters
- #10802: Message processing state management
- Multiple issues related to Unicode handling in messaging