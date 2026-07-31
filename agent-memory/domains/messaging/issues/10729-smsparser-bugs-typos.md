---
id: cht-core-10729
category: bug
domain: messaging
subDomain: sms-parsing
issueNumber: 10729
issueUrl: https://github.com/medic/cht-core/issues/10729
title: Fix bugs and typos in smsparser.js and related files
lastUpdated: '2026-07-30'
summary: "Fixed two critical bugs in SMS parser, both of which threw rather than degrading: a string-list loop that iterated values as if they were indices and crashed on `item[0]`, and a parseArray call that invoked the parser before its null guard, crashing when getParser returned none. Also fixed typos in two code comments and one logger.debug format string."
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
source_pr: medic/cht-core#10730
source_prs:
  - "medic/cht-core#10730"
source_sha: 393b9d6a19f09b3c3a62e3c139943da886798630
related_issues:
  - cht-core-10802
---

## Problem

The SMS parsing system had two critical bugs affecting message processing:

1. **String list parser bug**: The code used `for (const i of field.list)` which yields array items, not indices. Then it used `field.list[i]` treating `i` as an index, making `item` `undefined`. With the conventional `[[value, label], ...]` list shape the very next line, `item[0] === cleaned`, therefore threw `TypeError: Cannot read properties of undefined (reading '0')`, which propagated out of `smsparser.parse` uncaught — the loop crashed rather than falling through to the "Option not available" warning. That warning was effectively unreachable: it required `field.list` to be empty (or to hold entries that coincidentally stringify to valid indices).

2. **parseArray null crash**: `parseArray` called `getParser(def, doc)` and invoked the returned parser before its `if (!def || !def.fields) return []` guard ran. For message shapes where `getParser` returns `undefined` (a non-string `doc.message`, or an unrecognized Muvuku format code), `parser(def, doc)` threw `TypeError: parser is not a function` before the guard could return. `getParser` does not return `undefined` merely because `def` is null; for an ordinary text message it returns `textformsParser.parse`.

Additionally, there were two spelling typos: "becuase" → "because" in comments in api/src/services/report/smsparser.js and api/src/controllers/infodoc.js, and "succesfully" → "successfully" in a `logger.debug` format string in sentinel/src/schedule/reminders.js (a log message, not a comment).

## Root Cause

1. **Iteration bug**: Developer confusion between `for...of` (which iterates values) vs traditional `for` loop (which iterates indices). The pattern should have been either `for (const item of field.list)` or `for (let i = 0; i < field.list.length; i++)`.

2. **Null check ordering**: The guard clause `if (!def || !def.fields) return []` was placed after the parser was already invoked, instead of at the top of the function before any parser calls.

## Solution

1. **Fixed iteration**: Changed from `for (const i of field.list)` with `field.list[i]` to `for (const item of field.list)` using `item` directly, matching the pattern used by the integer parser's `.find()` logic.

2. **Moved null guard**: Relocated the null-check `if (!def || !def.fields) return []` to the top of `parseArray()`, before any calls to `getParser()` or `parser()`.

3. **Fixed typos**: Corrected spelling errors in `smsparser.js`, `infodoc.js`, and `reminders.js`.

The fix merged as PR #10730.

## Code Patterns

- Always use `for (const item of array)` when you need values, not indices
- Place guard clauses at the top of functions before any logic that depends on the guarded values
- Pattern: `if (!def || !def.fields) return [];` should come before `const parser = getParser(def, doc);`
- File: `api/src/services/report/smsparser.js` contains the core SMS parsing logic
- File: `api/src/controllers/infodoc.js` had typo fixes
- File: `sentinel/src/schedule/reminders.js` had typo fixes

## Design Choices

Chose to fix the bugs directly rather than refactoring the entire parsing system because:
- The bugs were isolated and well-understood
- Minimal changes reduce risk of introducing new bugs
- Maintains backward compatibility with existing SMS workflows

## Related Files

- api/src/services/report/smsparser.js
- api/src/controllers/infodoc.js
- sentinel/src/schedule/reminders.js
- api/tests/mocha/services/report/smsparser.spec.js (existing spec; not modified by #10730)

## Testing

- PR #10730 (393b9d6a) touched no test files, and neither fix is covered by existing tests. In `api/tests/mocha/services/report/smsparser.spec.js` every `list:` fixture (lines 483, 490, 508, 527, 568) is on a `type: 'integer'` field, so the `string` list branch is untested; and the only `parseArray(null, doc)` case ('junk example data', line 1339) never reached the crash because `getParser(null, doc)` returns `textformsParser.parse` for that message. Note the spec path is `api/tests/mocha/services/report/smsparser.spec.js` — there is no `smsparser.js` under that directory.
- Typos had no functional impact

## Related Issues

- #10802: Message processing state management (related messaging issue)
