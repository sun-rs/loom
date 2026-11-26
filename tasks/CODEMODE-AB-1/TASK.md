# CODEMODE-AB-1 — does "write one script instead of many tool calls" help? Same-task A/B

User request 2026-11-26. Background: docs/research/2026-11-26-code-mode.md (read it). Claude Code 2.1.331 has experimental Code Mode (`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`, interactive TUI only, one-time confirm prompt, REPL tool runs JS outside the sandbox). Codex reportedly has `features.code_mode.enabled` (verify on the installed Codex). No vendor numbers exist; third-party single runs disagree. We want our own measurements.

## Arms (same model per vendor across its arms; record exact CLI versions/models)
- **C0** Claude TUI, default.
- **C1** Claude TUI, Code Mode on (launch-scoped env only).
- **C2** Claude TUI, Code Mode off + the script-first skill below (separates "the feature" from "the instruction").
- **X0** Codex TUI, default.
- **X1** Codex TUI + script-first skill.
- **X2** Codex with native code_mode, only if the installed Codex supports it (launch-scoped `-c`, never edit ~/.codex/config.toml); else record "unsupported" with evidence.

**Script-first skill** (write it as `tasks/CODEMODE-AB-1/script-first.md`, ~30 lines, CLI-neutral): when a task needs several reads/searches/commands whose intermediate output you don't need to reason over, write one script (bash/node/python) that does them, filters, and prints only the compact result; prefer one script over many tool calls; still inspect results that need judgement; never hide failures (print exit codes). Deliver it through each CLI's own launch-scoped instruction channel (Claude `--append-system-prompt`, Codex developer instructions via `-c`), identical text for both.

## Tasks (fixed inputs, automatic correctness checks; prepare them first)
Use throwaway copies of /Users/sun/Code/repos/loom_new at one fixed SHA (one fresh copy per run, outside the repo, e.g. /Users/sun/Code/exp-relay/codemode/<run>/). Three task types:
1. **Fan-out survey**: e.g. "list every CLI subcommand, the file that implements it, and whether it has a test" → compare against a ground-truth table you compute by script beforehand.
2. **Mechanical multi-file edit + verify**: a rename or option-plumbing change touching ~5–10 files, then run the relevant tests → checker = tests pass + diff matches expected shape.
3. **Diagnosis**: inject one known bug into a copy (same bug for all runs), "find and fix the failing test" → checker = test passes and the fix is at the injected site.
**N = 3 runs per arm per task** (if cost looks excessive after a pilot run of each arm, stop and report before continuing). Fresh session per run; identical prompt text.

## Metrics per run (from native transcripts/event logs, not screen)
model requests, input/cached/output tokens, peak context, tool calls (and REPL/script calls), wall time, correctness (pass/fail + checker detail), human interventions (should be 0; the Code Mode confirm prompt counts as setup, record how you handled it).

## Output
RESULT.md (Chinese, `STATUS: done`): per-arm table with mean and spread, per-task breakdown, verdict on (a) Code Mode vs default, (b) skill-only effect on Claude and Codex, (c) native Codex code_mode; risks observed (sandbox bypass, prompts, failures hidden by scripts). Raw per-run JSON in tasks/CODEMODE-AB-1/runs/ (no transcript bodies, no secrets). Record the CLI versions and dates. Uncommitted for Super review.

## Red lines
Isolated HOME or each CLI's existing loom provider-home mechanism; absolute CLI binaries (never PATH `claude`, which is a CCP wrapper); never read or print credentials, auth files, keychains, `.env`, `~/.codex/auth.json`, `~/.codex/memories*`, provider configs; no global config edits (launch-scoped flags/env only); never touch /Users/sun/Code/ccp, Solars, rah_os, loom-next, pilot-2 panes; only your own hc terminals; Code Mode scripts run outside the sandbox — keep every run inside its throwaway copy and inspect the scripts afterwards for any access outside it (report any).
