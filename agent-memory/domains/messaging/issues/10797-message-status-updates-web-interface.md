---
id: cht-core-10797
category: bug
domain: messaging
subDomain: real-time
issueNumber: 10797
issueUrl: "https://github.com/medic/cht-core/issues/10797"
title: Message status updates not propagating to web interface
lastUpdated: 2026-04-12
summary: Message status changes (delivered, read, failed) were not being updated in real-time on the web interface, leaving users seeing outdated message status information.
services:
  - api
  - webapp
techStack:
  - javascript
  - nodejs
  - socket.io
  - websocket
---

## Problem

Users were seeing outdated message status information in the web interface. Messages that were delivered, read, or failed would continue showing as "sending" long after the actual status change. This created confusion and uncertainty about message delivery, making it difficult for users to trust the communication system.

## Root Cause

The real-time status update system had multiple issues:
1. WebSocket connections were not properly maintained between the API and web interface
2. Status update events were being sent but not properly received by the web client
3. The status update service was using polling instead of real-time updates
4. Event ordering was not preserved, causing status updates to arrive out of sequence
5. Missing error handling for failed status updates

This meant status changes in the database weren't reflected in the user interface.

## Solution

Implemented a robust real-time status update system:
- Created persistent WebSocket connections between API and web interface
- Implemented proper event ordering and deduplication
- Added status update service with proper error handling and retries
- Created client-side state management for message status
- Implemented offline status caching for when connections are lost
- Added proper connection lifecycle management

The key improvement was establishing reliable real-time communication between the backend and frontend.

## Code Patterns

- Use persistent WebSocket connections: `const ws = new WebSocket(wsUrl);`
- Implement event ordering: `const orderedEvents = orderEvents(events);`
- Handle connection failures: `ws.on('error', handleConnectionError);`
- Cache status updates offline: `const cache = new StatusCache();`
- Pattern: `const statusUpdater = new RealTimeStatusUpdater(socket, cache);` handles real-time status synchronization
- File: `webapp/src/services/status-updater.js` contains the real-time status update logic
- The fix ensures users see accurate message status information

## Design Choices

Chose to implement real-time updates instead of polling because it provides better user experience and reduces server load. WebSocket connections are more efficient than constant polling and provide instant status updates.

## Related Files

- webapp/src/services/status-updater.js
- webapp/src/components/MessageStatus.vue
- api/src/services/status-broadcaster.js
- api/src/controllers/status-controller.js
- test/unit/status-updater.test.js

## Testing

- Created comprehensive test suite for WebSocket connections
- Tested real-time status updates with various network conditions
- Verified proper error handling for connection failures
- Tested offline status caching and sync capabilities
- Performance testing for status update processing

## Related Issues

- #10802: Message processing state management
- #10780: Mobile notification delivery issues
- Multiple real-time communication problems