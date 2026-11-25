# ROUTING-1 — restore the pyramid in message routing: the Auditor is quiet by default

User ruling 2026-11-25 (R20): like the hc prototype, worker turn ends push to the **Leader**; the Leader decides what, if anything, goes up to the **Auditor**. The Auditor is normally idle.
Evidence (pilot-2, `loom hist --role auditor`): 84 Auditor turns — 43 (51%) woken by loomd "Loom drift and fact checks" notices, 10 (12%) by auto-relayed replies; Leader's 58 turns were all real tasks.

Base: main @ 8a88b9ad. Do not commit.
1. **Drift/fact signals go to the Leader, not the Auditor.** All loomd-generated drift, fact-check, repeated-failure, budget and stuck signals about workers are attached to the Leader's next real wake (never a separate wake) and included in the gate pack. Only **red** facts escalate to the Auditor, and only via the gate pack or one escalation per gate: protected/fence files touched, deleted or weakened assertions, skip/only added, a fact-miss the Leader confirmed after checking, sandbox escape attempts. Remove direct Auditor delivery of drift notices.
2. **No auto-relay ping-pong.** A role's turn reply is auto-relayed to a sender only when that sender asked for a reply (e.g. `loom send --expect-reply` or the gate-pack request), and never relays a reply to a message that was itself an auto-relayed reply. Default: no relay to the Auditor.
3. **Auditor wake sources whitelist** (enforced in loomd, documented in docs/ORG.md and the skill): user/Super messages; the Leader's gate pack (one per gate); explicit Leader escalation (`loom escalate`, rate-limited, reason required); succession supervision. Anything else is queued into the next allowed wake or dropped to `loom status`.
4. Regression: replay pilot-2's notification/delivery sequence (read-only from /Users/sun/Code/loom-pilot2/.project) through the new routing and report how many Auditor wakes would have occurred (target: ≤ 1 per gate + user/Super messages).
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before.
