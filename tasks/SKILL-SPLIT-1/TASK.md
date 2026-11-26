# SKILL-SPLIT-1 — split the loom skill: short role cores, event-delivered modules, pointers for rare how-tos

User 2026-11-26: one skill holding every role's duties takes too much context; keep long or rarely-needed logic behind one-line pointers. Today `skills/loom/SKILL.md` is one 13.4 KB file (≈4–5k tokens) and every role carries all roles' text. This follows Anthropic's own skill guidance (progressive disclosure: short SKILL.md, details in referenced files). Do it AFTER ROT-TUNE-1 and SKILL-VERIFY-1 are merged (they rewrite parts of the skill).
Design (Super):
1. **Per-role cores** (Super, Auditor, Leader, Worker): each ≤ ~120 lines / ~1.5k tokens: role boundary and red lines, conclusion tags, the handful of commands used every turn, memory-writing rules for senior roles (short, from the memory work in pilot-2), and a pointer list.
2. **Event-delivered modules (zero extra requests)**: text needed only at a specific moment is attached by loomd to the delivery that triggers it — rotation prompt + handover template, successor first-turn verification, gate-pack format, needs-decision template, REJECT fix routing. The role never has to go and read them.
3. **Pointer files for rare how-tos** (read on demand, costs one tool call when used): upgrade/release, tool guard and override, worker tiers/grants, accounts, layout/TUI, troubleshooting. One line each in the core: "需要 X 时读 references/x.md".
4. Every rule enforced by loomd/lint is removed from prose (point to the enforcement instead).
5. Measure before/after: tokens of each role's launch context; run one pilot gate cycle with the split skills and compare senior-role per-turn input and any rule slips.
Tests: skill lint (every pointer resolves, each module referenced by the loomd event that delivers it, size budgets). RESULT.md Chinese, STATUS: done, uncommitted.
