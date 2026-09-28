# verify-drafts fixture corpus

Every `invalid-*` / defect fixture here transcribes a defect a human reviewer
actually found in the first promote batch (PRs #120, #121, #123, #130, #131,
#132). The spec asserts `verify-drafts` still fails on each one, so a defect
class that took two review rounds to catch cannot silently return.

This file also doubles as a fixture: it has no frontmatter and is named
`README.md`, so it must be *skipped*, not reported as malformed.
