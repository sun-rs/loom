# RELAY-GATE-1 (urgent) — gate-pack conclusions are not relayed when the decision tag is not on the first line

LIVE pilot-2 evidence (/Users/sun/Code/loom-pilot2/.project/inbox/state.json):
- Gate packet 511b7774 (G4-MERGE, `gatePacket` set, `expectReply: true`) completed at 23:54 (`completion.source: claude transcript turn_duration`). The body is:
  - line 1: "合入门禁第 1 轮的材料已看完：…现在回给 Leader。"
  - paragraph 2: "REJECT G4-MERGE 第 1 轮…"
- No `Loom reply from` message was created. The Leader sat waiting ("等待 Auditor 合入授权") for 24+ min until Super forwarded the verdict by hand.
- Same for gate e79b69e5 (G4-TESTS r1 REJECT, 22:44).
- d8f90c12, whose body starts with "PASS", was relayed.

Base: main @ f2955b89 (deployed). Do not commit.
1. **Gate packets always relay their conclusion turn.** HIST-FIX-1 item 3 said a gate-pack reply relays as the conclusion turn regardless of the first line. Implement and test that exception on every completion path (hook Stop, transcript fallback, OAR turn-end).
2. **Decision tag detection.** The tag is the first line that starts with a decision tag (DONE/BLOCKED/FAILED/PASS/REJECT/APPROVE…, optionally after markdown emphasis), not only line 1. When relaying, put that tagged line first and keep the full body.
3. **Never silent.** A turn that completes for a message with `expectReply` but is not relayed (ack/NOREPLY/no tag) is recorded with an explicit `relay: suppressed (<reason>)`.
   - For a gate packet or any expectReply from a senior role, suppression with no NOREPLY → relay anyway with a "未带结论标签" note. Waiting senders must never wait silently.
   - Hook into DELIVERY-SLA-1: the sender's next wake / `loom status` shows "reply to <id> suppressed".
4. **Role prompt reinforcement.** The Auditor/Leader skill puts the decision tag on the first line of conclusion replies (keep, but don't rely on it).
5. Regression: the two pilot-2 bodies above (copy read-only) must relay; an ack body must not.
Tell me with a short line when green so I can hot-deploy. npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before.
