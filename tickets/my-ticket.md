---
title: Fix login page not working on mobile
type: bug
priority: high
domain: authentication
---

# Description

Users are reporting that they cannot log into the CHT app on their mobile phones. The login button doesn't respond when tapped on smaller screens (phones), but works fine on tablets and desktop computers.

This is blocking community health workers from accessing the system during their field visits.

## Requirements

- Login button must be tappable on all mobile phone screen sizes
- Login form must be visible and usable on screens as small as 320px wide
- Touch targets should be at least 44px for easy tapping

## Acceptance Criteria

- User can successfully tap the login button on iPhone SE (smallest common screen)
- User can successfully tap the login button on Android phones
- Login form is fully visible without horizontal scrolling
- All form fields are easily tappable
- Tested on at least 3 different mobile devices

## Constraints

- Must maintain current desktop/tablet functionality
- Must work on both iOS and Android browsers
- Should work on older phones still in use (at least 2 years old)
