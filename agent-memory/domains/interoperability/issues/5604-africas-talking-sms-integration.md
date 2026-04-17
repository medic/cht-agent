---
id: cht-core-5604
category: feature
domain: interoperability
subDomain: sms
issueNumber: 5604
issueUrl: https://github.com/medic/cht-core/issues/5604
title: Integration with Africa's Talking SMS aggregator
lastUpdated: 2019-07-10
summary: The EBS project needed SMS via feature phones using a cloud-hosted aggregator instead of medic-gateway (which had Play Store removal risk, sleep issues, low throughput). PR #5717 added Africa's Talking as a first-party SMS provider in api/src/services/africas-talking.js, including outbound SMS sending, inbound SMS webhook, and delivery status webhook. The existing gateway integration was refactored to share services with AT.
services:
  - api
techStack:
  - javascript
  - nodejs
---

## Problem

The EBS project deployed CHT for feature phone users who communicate via SMS rather than smartphones and a data connection. The standard CHT SMS mechanism was `medic-gateway` — an Android app that sends/receives SMS via a local SIM card. This had several blocking issues for EBS and similar deployments:

- **Play Store removal risk**: Google periodically removes apps with foreground SMS permissions
- **Sleep/connectivity issues**: Android battery optimisation kills the gateway background process
- **Low throughput and high latency**: a local Android device handles ~1 SMS per few seconds; delays up to 2 minutes were observed in field testing
- **Hardware dependency**: each deployment needs a physical Android device with a SIM card

Africa's Talking (AT) is a cloud-hosted SMS aggregator with high throughput, a sandbox for development, dedicated support, and an official npm SDK. An expressjs prototype by @newtewt was used as a starting point.

## Root Cause

CHT had no abstraction layer for SMS transports — the medic-gateway integration was hardcoded in the API. Adding AT required implementing three new routines (outbound sending, inbound webhook, delivery status webhook) while simultaneously refactoring the existing gateway code into shared services so future providers could be added without duplication.

## Solution

PR #5717 (merged Jul 10, 2019) added a first-party Africa's Talking integration:

1. **Outbound SMS** (`api/src/services/africas-talking.js`): Sends both immediate auto-reply messages and scheduled messages via the `africastalking` npm SDK. Hooks into the same message pipeline used by medic-gateway.
2. **Inbound SMS webhook**: A new API endpoint AT calls when an SMS is received. Parses the AT payload format and creates a CHT incoming-message document.
3. **Delivery status webhook**: A new API endpoint AT calls with delivery status updates (delivered, failed, etc.), which updates the message status in CouchDB.
4. **Disabled by default**: The integration only activates when AT credentials (`api_key`, `username`, `shortcode`) are present in `medic-credentials`.
5. **Gateway refactor**: Existing medic-gateway integration was refactored ("Refactoring to make it easier to reuse") to share services with the AT integration, enabling future providers to reuse the shared layer.

A full acceptance test was not possible in sandbox mode — the integration was released and tested in the field with a production AT account.

## Code Patterns

- AT sending uses the `africastalking` npm SDK (`africastalking` package) rather than raw HTTP — the SDK handles authentication, payload formatting, and error codes
- Service file: `api/src/services/africas-talking.js` — confirmed from field debugging (log output referenced this path)
- The integration is conditionally activated based on the presence of credentials in `medic-credentials` — the API does not need to restart when credentials are added
- Inbound AT webhook payloads must be validated (using the AT API key header) before creating a CHT document; never trust unauthenticated webhook calls
- Pattern: when integrating a new SMS provider, hook into the existing message queue interface rather than creating a parallel send path — this ensures existing retry and scheduling logic applies

## Design Choices

- Used the official `africastalking` npm SDK for reliability rather than raw HTTP; AT has strong npm SDK support and sandbox environment
- Implemented as a CHT API service (not a standalone mediator) to reduce deployment complexity for the initial EBS project
- Explicitly scoped to AT for the first provider, while refactoring the gateway to shared services to make future providers (Twilio, Infobip, etc.) easier to add
- Did not do a full AT in sandbox because a production AT account and provisioned shortcode are required for realistic testing; released and validated in the field instead
- Known field issue: `RejectedByGateway 502` response from AT occurs when the wrong shortcode type is provisioned on the telco's end (on-demand instead of toll-free). This is an AT/telco configuration issue, not a CHT code issue

## Related Files

- api/src/services/africas-talking.js
- api/src/controllers/ (inbound and delivery-status webhook controllers)
- api/src/services/ (shared SMS service layer refactored from gateway integration)

## Testing

- Sandbox AT (Jun 17, 2019 by @dianabarsan) on branch `5604-africas-talking-integration`
- Field testing (Jul 10-16, 2019) by @benkags and @derickl on the EBS production account:
  - Inbound messages worked but had up to 2-minute delay (AT network latency, not CHT)
  - Outgoing messages initially failed with `RejectedByGateway 502` — root cause was wrong shortcode type (on-demand vs toll-free) provisioned by telco; resolved Jul 16, 2019 after AT support intervention

## Related Issues

- #5904: Cluster safe credentials (the medic-credentials storage used here was later made cluster-safe)
- #6306: Send outbound push without delay (complementary outbound data push feature)
