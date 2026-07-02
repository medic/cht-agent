# Integration state — `integration/demo-closed-loop`

Mission 03 assembly log. One section per merge-train step; SHAs are merge
commits on this branch. Base: `main` @ `ed07177`.

## S0 — `fix/filter-spec-skipped-pollution` (138c777) @ 3a8f4f5
- Tests: 558 → 558   Lint: clean
- Conflicts: none
- Notes / deviations: mission baseline said "~571"; measured main baseline is
  558 (571 is where the suite lands after S1's +13). Gate passed: `git status`
  clean after `npm test` — no `agent-memory/_skipped.ndjson` pollution, and
  the suite is green with ambient `ANTHROPIC_MODEL` set (both fixes active).
