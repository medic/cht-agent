---
id: cht-core-715
category: feature
domain: interoperability
subDomain: inbound
issueNumber: 715
issueUrl: https://github.com/medic/cht-core/issues/715
title: Figure out how to accept data from ODK mobile data collection tools
lastUpdated: 2015-06-26
summary: An early proof-of-concept to allow data collected via ODK-compatible mobile apps to appear in medic-webapp as if sent from a SIM app. The solution (Mar 2015) was receiving data from medic-collect (a medic-specific ODK Collect fork, issue #893) via JSON-based form support, scoped to integer/numeric/string/date fields with a pre-built matching form definition. Generic ODK XForm acceptance was deferred to issue #885.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

Community health programs that already used ODK Collect in the field needed a way to route their data into medic-webapp without requiring all CHWs to switch tools immediately. At the time, medic-webapp only accepted data from its own SIM-based messaging tools. The goal was a first small interoperability step: make data from an ODK-compatible app appear in medic-webapp as if it were sent from a SIM app, reducing pressure on next-generation form tooling by allowing existing ODK deployments to coexist.

Constraints explicitly scoped for the proof of concept:
- ODK form limited to integer, numeric, string, and date/timestamp field types
- A suitable hand-built CHT form definition must already exist that matches the ODK form
- The ODK mobile app must have a mobile data connection available

## Root Cause

medic-webapp had no inbound data path for third-party form collection tools. All data entry was assumed to go through medic-specific clients (SIM apps, medic-collect). There was no mechanism to parse or accept ODK submission formats and map them into CHT documents.

## Solution

Closed Mar 19, 2015, with final clarification added Jun 26, 2015. The original need was satisfied by **medic-collect** (issue #893) — a medic-specific fork of ODK Collect — rather than by building a generic ODK XForm acceptance endpoint. The implementation added support for receiving form data as JSON (`support for adding new forms via JSON`, commits by @mandric). The submitted data is mapped into a CHT document using a pre-existing hand-built form definition that matches the ODK form structure.

The requirement to accept **generic ODK XForms** (i.e. from unmodified ODK Collect using the standard XForm submission protocol) was separated into issue **#885** and not implemented here.

## Code Patterns

- Form data is submitted as JSON rather than as raw ODK XForm XML (multipart/form-data); this simplifies parsing but requires the submitting app (medic-collect) to serialize the form data to JSON before sending
- The field type mapping is limited to: integer, numeric, string, date/timestamp — complex types (groups, repeats, selects) were out of scope for this proof of concept
- A hand-built CHT form definition must exist that maps ODK field names to CHT document fields; there is no automatic inference of structure from the XForm definition
- Pattern: for proof-of-concept interoperability work, scope tightly to a specific field type subset and a specific app variant (medic-collect) rather than attempting full generic ODK compatibility upfront

## Design Choices

- Chose to satisfy the need via medic-collect (a controlled fork of ODK Collect) rather than building a generic ODK XForm endpoint, because the proof-of-concept did not need to be "DIY ready" or generalized
- Scoped to JSON submission format rather than raw XForm XML because it simplified the initial implementation; full XForm parsing was deferred to #885
- Required a pre-existing hand-built form definition to match the ODK form, rather than inferring structure from the XForm, to ensure data quality guarantees consistent with native CHT form submissions
- Explicitly a proof of concept: "solution does not yet need to be DIY ready, and does not yet need to be generalized" (from the original issue description)

## Related Files

- api/src/controllers/ (inbound form submission handling)
- api/src/services/ (form document creation)

## Testing

- Acceptance testing milestone reached Mar 19, 2015; issue closed by @ghost
- Jun 26, 2015: @abbyad clarified that medic-collect (#893) serves the original need and moved the issue to "Ready"
- Generic ODK XForm acceptance deferred to and tracked in #885

## Related Issues

- #893: medic-collect (the medic-specific ODK Collect fork that satisfied this issue's original need)
- #885: Accept generic ODK XForms (the deferred requirement for unmodified ODK Collect support)
- #6306: Send outbound push without delay (complementary outbound integration)
