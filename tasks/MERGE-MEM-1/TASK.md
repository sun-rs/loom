# MERGE-MEM-1 — bring pilot-2 memory v1 into main (user approved 2026-11-26)

Source: pilot-2 branch tip 2c2349e3 ("Persist receipts for every successful memory write"), 29 commits on top of merge-base 22b96cca. Target: main @ current HEAD (≥ 6239687c). The pilot-2 goal-3/4 reports are in /Users/sun/Code/loom-pilot2/.project/ (goal4-final-report.md and earlier) — read them for what memory v1 is and its known leftovers.

1. Create a worktree on a new branch `merge/pilot-2-memory-v1` from main (do not touch the main working tree or the pilot-2 worktree). Merge 2c2349e3 with a real merge commit. Resolve conflicts preserving main's newer behaviour (DELIVERY-SLA-1 … GATE-NOTIFY-1); where both sides changed the same logic, explain each resolution in RESULT.md.
2. Nothing in memory v1 may be wired into loomd by this card (that is the next phase); confirm no daemon path imports it at runtime unless it already did on main.
3. Remove pilot-only artefacts that do not belong in main (pilot .project files, logs). Keep docs that describe memory v1.
4. `npm test` twice on the merge commit: fail 0 cancelled 0 skipped 0; report the counts and the memory test count separately. `git diff --check`.
5. Secret-scan the merged range (keys, .env, auth/credential files, raw telemetry CSVs).

RESULT.md Chinese, `STATUS: done`, branch name + merge SHA; do not push, do not touch main — Super reviews and fast-forwards. Red lines as all prior cards.
