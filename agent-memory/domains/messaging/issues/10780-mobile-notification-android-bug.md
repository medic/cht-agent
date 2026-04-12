---
id: cht-core-10780
category: bug
domain: messaging
subDomain: notifications
issueNumber: 10780
issueUrl: https://github.com/medic/cht-core/issues/10780
title: Mobile notification delivery failing on Android devices
lastUpdated: 2026-04-12
summary: Push notifications were failing to deliver on Android devices while working correctly on iOS, causing Android users to miss important messages and updates from the CHT app.
services:
  - webapp
  - notifications
techStack:
  - javascript
  - react-native
  - firebase
  - google-cloud-messaging
---

## Problem

Android users were not receiving push notifications from the CHT mobile app while iOS users received them consistently. This left Android users unaware of new messages, appointments, and critical updates. The issue affected all notification types including new messages, appointment reminders, and system alerts.

## Root Cause

The notification service was using Firebase Cloud Messaging (FCM) for Android but had incorrect configuration in several areas:
1. Wrong notification channel configuration for Android O+
2. Missing payload structure requirements specific to Android notifications
3. Incorrect handling of background notification delivery
4. Missing vibration and sound settings that Android requires for proper delivery

The iOS implementation worked correctly because it used Apple's Push Notification Service (APNS) with proper configuration.

## Solution

Updated the notification service to properly handle Android-specific requirements:
- Configured proper notification channels for different notification types
- Added Android-specific payload structure with required fields
- Implemented background notification handling with proper priority settings
- Added vibration patterns and sound settings for Android notifications
- Created separate notification templates for Android and iOS platforms
- Added proper error handling and retry logic for FCM delivery

The key improvement was creating platform-specific notification handlers with proper Android configuration.

## Code Patterns

- Use platform-specific handlers: `if (platform === 'android') { handleAndroidNotification }`
- Configure notification channels: `android.channel.create('messages', 'Message Notifications')`
- Use correct Android payload structure: `{ notification: { body, title, channel_id }, data: {...} }`
- Handle background delivery: `android.notification.setPriority('high')`
- Pattern: `const notification = platform === 'android' ? createAndroidNotification(payload) : createIOSNotification(payload);` handles platform differences
- File: `webapp/src/services/notification-service.js` contains the core notification logic
- The fix ensures Android devices receive notifications properly

## Design Choices

Chose to implement platform-specific handlers rather than a unified approach because Android and iOS have fundamentally different notification systems. This approach ensures each platform gets the optimal notification experience while maintaining a consistent API for the application.

## Related Files

- webapp/src/services/notification-service.js
- webapp/src/components/NotificationSettings.js
- webapp/src/ios/NotificationService.js
- webapp/src/android/NotificationService.js
- test/unit/notifications.test.js

## Testing

- Created comprehensive test suite for Android notification delivery
- Tested on multiple Android versions (Oreo, Pie, Android 10, 11, 12)
- Verified notification channels work correctly
- Tested background notification delivery scenarios
- Performance testing for notification processing

## Related Issues

- #10802: Message processing state management
- Multiple mobile-specific notification problems
- iOS vs Android platform compatibility issues