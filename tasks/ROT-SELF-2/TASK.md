# ROT-SELF-2 — a successor must continue outstanding work, not wait

Live on pilot-2 (release cf865965): the Auditor successor loom-b8f95f0b acknowledged the handover, listed the outstanding items ("goal 5 final conclusion to Super; register notifications --complete --phase goal5"), then wrote "I'm now waiting for Loom deliveries" and idled. Super had to poke it. Unattended successors must not wait for a delivery to resume work the predecessor left open.
1. Handover brief gets an explicit "Do now" section (outstanding items the predecessor was in the middle of or owed) separate from background; the successor's launch prompt and the skill say: after the acknowledgement, start the "Do now" items in the same turn (or the next turn automatically).
2. loomd: if the brief has "Do now" items and the successor goes idle without starting them (no tool call / notification / delivery related to them) within N minutes, deliver a one-line nudge to the successor once ("交接里有待办：…"), then escalate (Leader → Auditor, Auditor → Super) if still idle.
3. Tests with a fixture brief; one real Claude TUI rotation fixture where the successor continues by itself.
Base main HEAD; worktree of your choice outside the shared tree. RESULT.md Chinese, STATUS: done, uncommitted.
