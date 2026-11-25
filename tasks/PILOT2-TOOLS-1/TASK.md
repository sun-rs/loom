# PILOT2-TOOLS-1 — tool problems found by pilot-2 (after HOLDER-HARDEN-1)

Source: /Users/sun/Code/loom-pilot2/.project/pilot2-final-report.md ("给 main 的工具问题"), docs/research/2026-11-25-org-cost-pilot.md §4. Base: main HEAD at start. Do not commit.

1. **Fact-check false positives and loops** (main cause of Auditor = 74% of tokens): delivery/notice IDs (UUIDs, `[loom:…]`, 8-hex prefixes) treated as git SHAs; bare filenames without directory and modules a card plans to create treated as missing; replies quoting IDs trigger notices back and forth. Fix extraction; never re-notify on text that only quotes a previous notice. Regression from pilot-2 notices (read-only from its .project).
2. **Noise must not wake the Auditor**: drift/fact notices are batched and attached to the Auditor's next real wake (or delivered at most once per gate/hour), not delivered as their own turn. Add a policy knob; default on.
3. **Auditor rotation at gate boundaries**: support a policy `roles.auditor.rotateAt: "gate"` (or a token threshold) so the Leader/loomd proposes Auditor succession after each completed gate; succession guard still forbids simultaneous Leader rotation.
4. **Remaining false `corrupted`** on fully delivered Claude inputs: pilot-2 db8b48bc (fixed?), eec4e9d0, a111f511 — compare with native records; fix and regression.
5. **Handover brief rulings excerpt silently empty**: parser only understands template headings; ledger uses `R1.` lines. Support both, and always include a pointer to the ledger/handover file; never emit an empty section silently.
6. **Auto-relayed replies bypass the 600-byte rule**: when a role's turn reply is auto-relayed as a delivery and exceeds a configurable size, loomd stores it to a file under .project and delivers a short pointer + digest instead.
7. **Worker sandbox**: commits report `packed-refs.lock` permission errors (grant the worktree's needed refs lock path narrowly or make commits avoid packed-refs writes); here-document temp files denied (grant private TMPDIR for shell heredocs). Count every sandbox denial in evidence (one was missed).
8. **Leader running a background test misjudged `stuck`**: recognise agy/Claude background-task indicators as busy, not stuck.
9. Worker contract: forbid disabling git hooks (`--no-verify`, `core.hooksPath`) explicitly.
10. Re-verify agy native memory findings on 1.5.17 (docs/research/2026-11-25-memory-systems.md is for 1.5.16); update the doc with date/version.
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before.
