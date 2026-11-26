# DRAFT-HOLD-2 — agy Leader holds a partial paste (530/639 bytes) that loomd can neither continue nor prove complete

Base: main @ 762b702a (deployed to pilot-2). Do not commit. LIVE: pilot-2 is stalled on this; do NOT type into pane t3fn (agy Leader loom-8d74a63c), do not press Enter/Esc, do not clear the draft. Read-only investigation of the live state is fine (`hc read t3fn`, holder journal, .project files).

Evidence (/Users/sun/Code/loom-pilot2/.project):
- inbox/state.json messages[173] id 57883071-cae2-a796-329c-d9354090c345: continuation batch (worker T17-GOAL4-TESTS DONE + "Loom drift and fact checks" appendix), payloadDigest 1ee0d0b9…, writeTurn 47, issue uncertain.
- notifications: `:held-draft` "530/639 字节。完整粘贴或 Enter 状态未获确认"; then `:uncertain`.
- The composer on screen shows the tail of the message (ends with the drift appendix line) and "↑ 13 more lines" — so the 109 missing bytes may be in the middle, or the byte proof may be miscounting agy's wrapped/scrolled composer.
- After hot upgrade to 762b702a the new loomd's recoverStartup (tui/index.mjs ~152-185) still did not continue or adopt.

Do:
1. Determine exactly what is in the composer vs the expected wire text (holder journal / output bytes), where the 109 bytes went, and why `provePaste` gave neither `continuation` nor `complete` (or why `beforePasteTurn` was false).
2. Fix the root cause in the paste path for agy (chunking/bracketed paste/overflow scroll) so it cannot recur, and fix the proof for agy's scrolled composer if it miscounts.
3. Make the stuck case recoverable without a human: when a held draft is proven to be a prefix/scattered subset that cannot be continued, loomd may clear the composer with a provider-verified clear sequence ONLY if the composer contains nothing but loom's own wire text (token `[loom:<id>]` present, no human input since the write), then re-send the whole message once. Record it as `resent-after-clear` in the receipt. Never clear when a human typed.
4. Tests with the pilot-2 frame as a fixture; live check with native agy (isolated HOME, absolute path) pasting a ~640-byte CJK message with a drift appendix.
5. Separately (small): `repeated-failure test-failed count=2` was raised for T17-GOAL4-TESTS, a test-first card whose red is expected. The drift/repeated-failure check must honour the card's `expectRed` (HIST-FIX-1) — and check whether the Leader's spawn path even lets it set `expectRed`; if not, add it to `loom spawn` (`--expect-red`) and the skill.
Tell me with a short line as soon as 1–3 are green so I can hot-deploy; the new loomd must then resolve 57883071 by itself.
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before.
