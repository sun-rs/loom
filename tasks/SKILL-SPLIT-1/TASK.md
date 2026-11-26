# SKILL-SPLIT-1 — split the loom skill: short role cores, event-delivered modules, pointers for rare how-tos

User 2026-11-26: one skill holding every role's duties takes too much context; keep long or rarely-needed logic behind one-line pointers. Today `skills/loom/SKILL.md` is one 13.4 KB file (≈4–5k tokens) and every role carries all roles' text. This follows Anthropic's own skill guidance (progressive disclosure: short SKILL.md, details in referenced files). Do it AFTER ROT-TUNE-1 and SKILL-VERIFY-1 are merged (they rewrite parts of the skill).
**Process (user 2026-11-26: be careful): (a) research first — Super is collecting official guidance, real skill libraries, and evidence on instruction length/compliance and importance-based splitting into docs/research/ (wait for it); (b) design from that research; (c) A/B validate on rule compliance and senior input tokens; (d) the final product goes to the veteran roles (t17g, t17w, t13n, t4c) for review before merge.**

Draft design (Super, to be revised by the research):
1. **Per-role cores** (Super, Auditor, Leader, Worker): each ≤ ~120 lines / ~1.5k tokens: role boundary and red lines, conclusion tags, the handful of commands used every turn, memory-writing rules for senior roles (short, from the memory work in pilot-2), and a pointer list.
2. **Event-delivered modules (zero extra requests)**: text needed only at a specific moment is attached by loomd to the delivery that triggers it — rotation prompt + handover template, successor first-turn verification, gate-pack format, needs-decision template, REJECT fix routing. The role never has to go and read them.
3. **Pointer files for rare how-tos** (read on demand, costs one tool call when used): upgrade/release, tool guard and override, worker tiers/grants, accounts, layout/TUI, troubleshooting. One line each in the core: "需要 X 时读 references/x.md".
4. Every rule enforced by loomd/lint is removed from prose (point to the enforcement instead).
5. Measure before/after: tokens of each role's launch context; run one pilot gate cycle with the split skills and compare senior-role per-turn input and any rule slips.
Tests: skill lint (every pointer resolves, each module referenced by the loomd event that delivers it, size budgets). RESULT.md Chinese, STATUS: done, uncommitted.

**Research done:** docs/research/2026-11-26-skill-split.md — implement its design conclusions 1–8 (they supersede the draft above where they differ), starting with the eval harness (item 7) before rewriting any text.

**User 2026-11-26: redesign the skill, cut filler and low-value sentences, make sure the model executes fully rather than half-understanding.** Concretely:
- Every sentence must be an instruction the model can act on or a fact it needs; delete explanations of rationale, history, restatements, hedges and examples that don't change behaviour (keep rationale only where it prevents a known misreading, one clause).
- Prefer "When X: do Y (command)." over prose; one rule per line, numbered, no nested conditions beyond one "unless".
- Each rule gets a test in the eval (item 7): a scenario where the rule must fire, measured for full execution (all steps, correct order, correct command) — not "mentions the rule".
- Report per rule: kept/merged/deleted/moved-to-loomd, and the size of each role core before/after.
**Phasing so we don't wait on other cards:** Phase 1 now — eval harness + scenarios per role run against the current 13 KB skill (baseline numbers), plus a line-by-line concision audit table. Phase 2 after ROT-TUNE-1, SKILL-VERIFY-1 and pilot-2's memory-writing rules land — write the new cores/modules/pointers incorporating them, rerun the eval, then hand to the veterans for review.
