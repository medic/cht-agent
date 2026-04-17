---
id: cht-core-6024
category: bug
domain: interoperability
subDomain: outbound-push
issueNumber: 6024
issueUrl: https://github.com/medic/cht-core/issues/6024
title: The outbound error response logging is needlessly verbose
lastUpdated: 2020-07-09
summary: When an outbound push failed, sentinel logged the entire error object using the %o format specifier, producing multi-page log entries with socket info, headers, stacks, and nested objects. PR #6451 fixed this to log only the HTTP status code and response body as two concise ERROR lines, or just the error message for non-HTTP errors such as timeouts.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
---

## Problem

When the outbound scheduler attempted to send a payload and something went wrong (e.g. the target server returned a 400 or 500), sentinel logged the entire error response object:

```js
logger.error(`Failed to push ${medicDoc._id} to ${key}: %o`, err);
```

The `%o` format specifier serializes the entire error object. For HTTP library errors this includes socket info, request headers, response headers, raw body, status codes, and a full stack trace — producing log entries that were hundreds of lines long per failure. This made the sentinel log essentially unreadable under failure conditions and was particularly noticeable during testing of the #6306 and #6419 outbound features (raised by @ngaruko).

## Root Cause

The single logger call at the error catch site in `shared-libs/outbound/src/outbound.js` used `%o` unconditionally for all error types. This serializes the full error object regardless of whether it is an HTTP response error (which has a large nested structure) or a simple message error (timeout, config missing).

## Solution

PR #6451 (merged Jun 24, 2020, finally closed Jul 9, 2020) updated the error handling in `shared-libs/outbound/src/outbound.js` to check the error type and log only relevant fields. The fix produces two concise ERROR lines for HTTP errors:

```
ERROR: Failed to push <doc_id> to <key>, server responsed with 400
ERROR: Response body: {"flow":["No such object: <id>"]}
```

For non-HTTP errors (timeouts, missing credentials, mapping errors), only `err.message` is logged on a single line:

```
ERROR: Failed to push <doc_id> to <key>: CouchDB config key 'medic-credentials/textit.in' has not been populated. See the Outbound documentation.
```

## Code Patterns

- Check `err.statusCode` (or equivalent) to distinguish HTTP response errors from other errors before logging
- For HTTP errors: log status code in the first ERROR line, log `JSON.stringify(responseBody)` in a second ERROR line
- For non-HTTP errors: log only `err.message` — no stack trace in ERROR level logs
- The two ERROR lines pattern comes from two intentional catch sites in the outbound code: both catch internally and log, then return gracefully so sentinel continues processing other documents
- File: `shared-libs/outbound/src/outbound.js` is where the logging fix lives (not `sentinel/src/schedule/outbound.js` directly)
- DEBUG level logs still emit the full request details (URL, body, timeout) but these do not appear in production

## Design Choices

- Chose two separate ERROR lines (status + body) rather than one combined line for readability in log aggregators that truncate long lines
- Chose to keep stack traces out of ERROR level entirely; they are available at DEBUG if needed
- The DEBUG lines showing the full request are kept for local debugging and intentionally suppressed in production
- Did not change the catch flow: errors are still caught and swallowed at two call sites (transition path and scheduler path) so sentinel continues processing — the logging is the only thing that changed

## Related Files

- shared-libs/outbound/src/outbound.js
- sentinel/src/schedule/outbound.js

## Testing

- AT by @ngaruko (Jun 23, 2020) on local instance using TextIt API: verified that missing credentials, mapping errors, and bad HTTP responses all produce short single-line or two-line ERROR log entries instead of the previous multi-page output
- Verified: `DEBUG` lines (full request URL/body) still present locally but absent in production
- Reopened Jul 8, 2020 after a reported regression; confirmed Jul 9, 2020 the regression was due to testing against old master, not the branch

## Related Issues

- #6306: Send outbound push without delay (outbound feature whose testing first exposed the noisy logs)
- #6419: Allow configuring outbound to send the same record multiple times (also surfaced the verbose logging during AT)
- #7023: Outbound push may log user and password (follow-on security issue discovered after this fix)
