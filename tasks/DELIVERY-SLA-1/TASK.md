# DELIVERY-SLA-1 — a delivery that never became a native turn must never be silent (user ruling 2026-11-25)

User, after pilot-2 stalled for a long time on held draft 57883071 (Leader composer had the full text, Enter never happened):
> "这本质上是投递状态监控的一种失败……上级觉得投递了，等就好了，而实际上 worker 没拿到，最后一直死等；也可能反过来，投递给上级，结果上级那边没 enter 成功，上级绝对不知道自己有草稿，等好几个小时后，用户去问 super 或者 auditor，就傻眼了。"
Same failure class the user saw in pure hc. Super resolved 57883071 by one Enter after verifying the readback (611/615 bytes, whitespace-only diff, cursor at end).

Base: main @ e17e06c3. Do not commit.

1. **Invariant and state.** A delivery is done only when the target's native record shows the turn that carries `[loom:<id>]` (the native receipt). Each pending delivery has an age and a reason (`draft-held`, `waiting-writable`, `uncertain`, `no-native-turn`…). Past a bound (policy `delivery.stallMs`, default 120 s for an idle target, longer while the target is busy), it becomes `stalled`. That covers both directions:
   - Enter never landed (draft-held/uncertain).
   - The screen looked submitted but no native turn started. Re-check, then re-submit at most once with the same id.
2. **Independent sweeper.** loomd checks every pending delivery on a timer (e.g. every 15 s), not only on screen/hook events, and the check survives upgrades.
3. **Everyone who waits is told, through a channel that still works.**
   - The sender's next wake and `loom status` show "your message <id> to <target> is not received (<reason>, <age>)".
   - A worker result that hasn't reached the Leader marks the card `result-undelivered`.
   - When the stalled target is itself a senior role (its composer is blocked, so it cannot be told), loomd escalates one level: Leader → Auditor, Auditor → Super/user (desktop notification + `loom notifications`). This is an infrastructure exception to the quiet-Auditor rule; one notice per delivery, rate-limited.
   - `loom status` for Super lists all stalled deliveries first.
4. **Make the held case decidable automatically.**
   - The holder journal records the *class* of every human-input chunk: terminal report (focus ESC[I/ESC[O, DA/DSR replies, bracketed-paste guards, mouse) vs printable/editing keys. Record the class, never the content.
   - Terminal reports must not count as human input for draft ownership.
   - Auto-submit ladder: proven complete → Enter. Loom-only subset → clear + resend (DRAFT-HOLD-2). Readback equal to wire text modulo whitespace, cursor at end, and no printable human input since the write → Enter. Otherwise → stalled + escalate (item 3).
   - Fixture: the pilot-2 57883071 case (5 bytes at offset 140→145 after a resize).
5. **Docs.** docs/PROTOCOL-v2.md (delivery states, SLA, escalation) and docs/ORG.md ("投递没到就必须有人知道"), plus the skill line for Leader/Auditor: if you are waiting on a result for longer than expected, run `loom status` and check stalled deliveries.
6. **Flaky test capture.** A full `npm test` failed 1 test twice (762b702a, e17e06c3) and passed on rerun; the failure was not captured. Run the suite in a loop (≥10 runs, with saved logs), identify the test(s), and fix the root cause.
Regression: replay pilot-2 57883071 and the earlier 919d7ab2 half-pasted briefing; both must reach `stalled` + escalation within the bound, and the 57883071 frame must auto-submit under item 4.
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before; live checks in isolated HOME; never type into pilot-2 panes.

## Item 7 (added after Orca study, docs/research/2026-11-25-aggregators.md)
- **No blind second Enter.** A dialog can appear *after* the first Enter (tool approval, Claude AskUserQuestion where Enter picks option 1, trust/plan prompts), and a later paste or human typing could be submitted early.
  - Allowed: at most one re-Enter, and only when all of these hold: native shows no new turn after ≥1.5 s; the composer still shows our `[loom:<id>]` draft and is otherwise ours; no overlay/approval/selection on screen (provider recogniser); no printable human input since the write.
  - Record it as `re-enter` in the receipt.
- **Pointer mode for long TUI deliveries (Orca-style).** Above `delivery.inlineMaxBytes` (default ~300 bytes), or when the body is multi-line or contains CJK, a TUI target gets one short single-line ASCII pointer:
  `[loom:<id>] N new: run "$LOOM_BIN" inbox read <id>`.
  - The agent reads the body via CLI, and that read is the receipt (in addition to the native turn).
  - Unread past the SLA → one redrive, then stall + escalate (item 3).
  - Report the token trade-off (one extra tool call per wake) in RESULT.md, using pilot-2 delivery sizes.
