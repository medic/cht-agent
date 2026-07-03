---
title: "Config bug: <one-line summary of the config defect>"
type: bug
priority: high
domain: configuration
layer: cht-conf
configArtifact: app-settings
artifactName: base_settings
chtConfVersion: "6.5.0"
deploymentRef: "medic/cht-core:4.x"
---

<!--
  DEMO TICKET TEMPLATE - cht-conf site reconstruction
  ===================================================
  Copy this file, then edit the placeholders below. This template is wired for
  the cht-conf routing path: `layer: cht-conf` in the frontmatter takes
  precedence, so routing goes to the config layer WITHOUT an LLM disambiguation
  call. See src/utils/ticket-parser.ts - `metadata.layer` is read straight from
  the frontmatter; domain inference only fills `layer` when it is absent, so a
  frontmatter value always wins.

  WHAT TO CHANGE before running the demo (defaults below are valid so the ticket
  parses as-is; a bare `<placeholder>` in these two fields would be REJECTED by
  the parser's domain/artifact validation, so change the value, not to a stub):
    * title           - one-line summary of the observed config defect.
    * domain          - the CHT domain that owns the symptom. One of:
                        authentication | contacts | forms-and-reports |
                        tasks-and-targets | messaging | data-sync |
                        configuration | interoperability | infrastructure.
                        Default `configuration`; use `forms-and-reports` for a
                        form/report defect.
    * configArtifact  - the cht-conf artifact implicated. One of:
                        form | contact-form | task | target | contact-summary |
                        app-settings | messaging | purge | translations |
                        resources | tooling. Default `app-settings`; switch to
                        `form` for a form-level bug.
    * artifactName    - (optional) the specific artifact, e.g. the base name of a
                        form (`pnc_followup`) or `base_settings`.
    * chtConfVersion  - (optional) the cht-conf version the partner built the
                        config with (this workbench ships cht-conf 6.5.0).
    * deploymentRef   - (optional) the cht-core version / config-repo ref the
                        site runs.
  Then fill every `<...>` slot in the body, especially the SYMPTOM slot below.
-->

## Description

<!-- SYMPTOM SLOT: replace the sentence below with the exact user-visible symptom. -->
On a clean reconstruction of the partner site, <describe the observed behaviour>
happens when <describe the trigger / the steps that reproduce it>. The expected
behaviour is <describe what should happen instead>. The defect reproduces from the
committed configuration artifacts alone (the files listed under Technical Context),
so this is a cht-conf configuration issue rather than a cht-core platform bug.

## Technical Context

<!-- List the config artifacts implicated in the bug; the parser reads these as `components`. -->
- `app_settings/base_settings.json`
- `forms/app/<form_name>.xlsx`

## Requirements

- Reproduce the reported symptom on a clean reconstruction of the partner site
- Isolate the exact expression / setting in the config artifact that drives the behaviour
- Express the fix as a change to the cht-conf artifact, not to cht-core

## Acceptance Criteria

1. The symptom is reproduced from the committed configuration artifacts alone
2. The root cause is pinned to a named artifact and expression
3. The fix is a cht-conf configuration change and passes `cht ... validate-app-forms`

## Constraints

- Keep all contact and report samples fully scrubbed of PII before committing
- Match the deployment's cht-core version when reconstructing the site

## References

**Documentation:**
- https://docs.communityhealthtoolkit.org/building/reference/app-settings/
