# PILOT-FIX-2 — two live delivery stalls found after hot-upgrading pilot-1 to fd2b6290

Base: main @ fd2b6290 (your PILOT-FIX-1 commit). Work in /Users/sun/Code/repos/loom_new main tree. Do not commit; Super reviews and commits.
Live evidence (read-only): /Users/sun/Code/loom-pilot/.project/inbox/state.json, .project/loomd/, panes t3b7 (Auditor, Claude) and t3b8 (Leader, agy). Do NOT type into t3b7/t3b8; do not edit pilot state files.

## Bug A — received-without-completion blocks the queue forever (Leader, agy)
Message 50d04e8b (Leader startup prompt) is now `received` (reconciled by FIX-1) but has no `completion`. That turn was taken over by an external input (Super pressed Esc and typed via hc). The queue-mode gate in inbox/engine.mjs (~line 392: `isDone && !message.completion && !deliveryTurnReplaced && !stopped...`) therefore holds all later queue messages. Three W1 BLOCKED results (41396789, 18fcbaca, 3f424db6) have waited >1h on an idle Leader.
Required: when native evidence shows the delivered turn has ended (agy turn end / later native turn / idle after a newer native user turn), settle the completion (body if captured, else `noReply` with a source note) instead of waiting forever. Never fabricate a body. Add a regression for "human/external input took over the delivered turn".

## Bug B — Claude collapses long pastes to `[Pasted text #N +k lines]`, so draft verification can't prove ownership (Auditor)
Message 76f973fe (drift notice to Auditor) is `sending/uncertain`; pane t3b7 shows `❯ [Pasted text #1 +6 lines]` unsubmitted. Make loom-pty recognise its own collapsed paste for Claude (e.g. track that the placeholder appeared right after our own paste with no human input/resize in between, and the placeholder line count matches the payload) and submit once; otherwise keep holding and report `draft-held`. Check how Orca (LICENSE.orca code in tui/) handles this before inventing anything. Regression test with a captured screen.

## Also
- `loom upgrade` digest: current-release digest is computed from disk, so an in-place edited active tree reports the same digest as the new build. Record the digest the running loomd started with and compare against that. Small change only.
- Super notifications: blocked-escalation and delivery-uncertain must be included in `loom notifications` types that a Super watcher sees (confirm they are; if a type list exists in docs/skill, make it complete).

## Acceptance
- npm test all green (currently 276), new regressions for A and B.
- Isolated-HOME live check for B with native Claude TUI (absolute binary path; never PATH — CCP wrapper). Bug A may be verified by replay of the captured state shape.
- RESULT.md in tasks/PILOT-FIX-2/ in Chinese, ending with `STATUS: done`.
Red lines: same as PILOT-FIX-1 (no credentials, no CCP, no Solars, no loom-next, isolated HOME).
