# PILOT-FIX-3 — agy long drafts are always held (every Leader delivery needs a human Enter)

Base: main @ 73a498c1. Main tree, do not commit.
Evidence: pilot Leader pane t3b8 (agy Gemini 4 Neon, read-only — do NOT type into it). Every multi-line loom delivery (wave results, Auditor rulings, Super rulings; 8–40 lines, starts with `[loom:<id>]`) lands in the agy input box un-collapsed and soft-wrapped, and is never submitted. Your FIX-1 RESULT already noted: "界面强制换行使长 agy 测试稿无法通过完整摘要比对，该稿由人工提交". In the pilot this is now the #1 source of manual intervention (4 times so far).

Required:
1. Make own-draft verification for agy robust to soft wrap / reflow: compare after normalising wrap (join visual rows by grid wrap flags from xterm `isWrapped`, not by guessing), collapse whitespace consistently, and accept when the draft begins with our `[loom:<id>]` marker, matches the payload digest after normalisation, and no human input/resize/buffer switch/native turn happened since our paste. Check what Orca does for agy/gemini paste confirmation first.
2. If the draft is taller than the visible input region (scrolled), verify via the head marker + tail segment + total normalised length instead of the full text; document why that is still safe (no human input in between is the actual guarantee).
3. Regression tests from captured agy screens of long wrapped drafts (match, partially edited, human-typed suffix).
4. Live check: isolated HOME, absolute agy binary, a 40-line message, must auto-submit once with native receipt.

Also report: which parts of FIX-1/FIX-2 live in loom-pty (cannot reach already-running sessions via `loom upgrade`) vs loomd. One paragraph; this feeds the "loom-pty slimming" follow-up.

npm test green (278+). RESULT.md in Chinese, end with `STATUS: done`. Same red lines as before.
