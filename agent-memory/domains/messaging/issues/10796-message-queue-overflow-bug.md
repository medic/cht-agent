---
id: cht-core-10796
category: bug
domain: messaging
subDomain: queue
issueNumber: 10796
issueUrl: "https://github.com/medic/cht-core/issues/10796"
title: Message queue overflow error during high volume periods
lastUpdated: 2026-04-12
summary: During periods of high message volume (like mass campaigns or system alerts), the message queue would overflow and crash, causing message delivery failures and system instability.
services:
  - api
  - sms-gateway
  - notifications
techStack:
  - javascript
  - nodejs
  - redis
  - rabbitmq
---

## Problem

The system would crash during high-volume messaging periods like mass health campaigns, emergency alerts, or busy clinic days. Message queues would overflow, causing delivery failures, lost messages, and system instability. This left users without critical communications during the busiest times.

## Root Cause

The message queue system had several limitations during high volume:
1. Fixed-size queue buffers that couldn't scale with demand
2. No rate limiting or throttling for incoming messages
3. Synchronous processing that blocked the queue when downstream services were slow
4. No error recovery for failed queue operations
5. Memory leaks in queue management during sustained high volume

When message volume exceeded the queue capacity, the entire messaging system would become unresponsive.

## Solution

Implemented a robust, scalable queue system:
- Added dynamic queue sizing that scales with message volume
- Implemented intelligent rate limiting and message throttling
- Created async processing with proper backpressure handling
- Added circuit breakers to prevent cascading failures
- Implemented queue persistence and recovery mechanisms
- Added monitoring and alerting for queue health

The key improvement was making the queue system elastic and self-healing during high volume periods.

## Code Patterns

- Use dynamic queue sizing: `const queueSize = calculateOptimalQueueSize(volume);`
- Implement rate limiting: `const throttledQueue = rateLimit(queue, maxPerSecond);`
- Handle backpressure: `queue.on('backpressure', handleBackpressure);`
- Use circuit breakers: `const circuit = circuitBreaker(processMessage);`
- Pattern: `const resilientQueue = createResilientQueue({ maxSize, throttle, circuitBreaker });` creates a fault-tolerant queue system
- File: `shared-libs/messaging/src/queue-manager.js` contains the core queue management logic
- The fix prevents crashes and ensures reliable message delivery

## Design Choices

Chose to rebuild the queue system with resilience rather than simple fixes because the issue was fundamental to system architecture. This approach ensures reliable operation under all conditions and provides a foundation for future scaling needs.

## Related Files

- shared-libs/messaging/src/queue-manager.js
- shared-libs/messaging/test/unit/queue-manager.test.js
- api/src/controllers/message-queue.js
- sms-gateway/src/processors/queue-processor.js
- notifications/src/queue/notification-queue.js

## Testing

- Created stress testing with simulated high-volume scenarios
- Tested recovery from queue overflow conditions
- Verified rate limiting prevents system overload
- Tested queue persistence during service restarts
- Performance testing for queue scaling capabilities

## Related Issues

- #10802: Message processing state management
- #10780: Mobile notification delivery issues
- Multiple performance-related messaging problems