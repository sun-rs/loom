# PROMPT-STATE-1 — standard "waiting on a choice/approval" state for every CLI, visible in status, and a measured answer to "does a paste work while a prompt is up"

User questions (2026-11-25):
1. Can approval and choice prompts be recognised in a standard way and shown in system status?
2. When a TUI shows an up/down + Enter prompt, do the CLIs still accept a delivery — does a paste into the composer actually take effect?

Base: main @ 36b40f46 (deployed to pilot-2). Do not commit. Today the screen recognisers return `permission`/`picker`/`overlay` for Claude, Codex and agy (adapters/*/screen.mjs); OpenCode has none. Native signals are not used (Claude's `Notification` hook with permission_prompt is not wired). `blocksInput` keeps loom from writing while the prompt is up. `loom status` shows the raw kind only.

1. **Live matrix first (report before changing behaviour).** Use native CLIs (Claude 2.1.331, Codex, agy 1.5.17, OpenCode) with an isolated HOME, absolute paths, a loopback/mock model where possible, and a test PTY via a real holder. For each CLI, raise:
   - (a) a tool approval;
   - (b) a multiple-choice question (Claude AskUserQuestion; the equivalent where one exists);
   - (c) a model/menu picker.

   While each prompt is up, send a bracketed paste of a CJK multi-line text that contains digits and y/n, then (separately) a lone Enter. Record per cell:
   - whether the paste reached the composer, was dropped, or was interpreted as option keys/hotkeys (did a digit/y select something?);
   - whether the text survives after the prompt closes;
   - what Enter does.

   Also record what is visible in the native transcript/hooks while the prompt is up. Write docs/research/2026-11-25-tui-prompts.md (dated, with versions).
2. **Standard state.** Add `awaiting-approval` and `awaiting-choice` (plus the existing picker/overlay) as normalised session states with `{since, cli, source: native|screen, summary (question, ≤120 chars), options count}`. Never record answer content beyond the summary.
   - Prefer native signals: Claude `Notification` hook (permission_prompt, elicitation) and PreToolUse/PermissionRequest; Codex app-server approval requests (headless) and TUI screen; agy hook/transcript if any; OpenCode event stream/screen.
   - Fall back to the screen recogniser. Add an OpenCode recogniser.
   - Show the state in `loom status` (top section, like stalled deliveries) and `loom ls`.
3. **Delivery and escalation.** Never write a paste or Enter while a prompt is up (keep blocksInput; prove from item 1 that this is required). A delivery waiting on a prompt gets reason `target-awaiting-user` under DELIVERY-SLA-1. A senior role stuck on a prompt past the bound escalates one level (Leader → Auditor, Auditor → Super/user desktop notice), once. Headless workers: confirm approvals cannot block OAR workers (bypass) and report.
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before; never type into pilot-2 panes.

## Item 4 (user, 2026-11-25): choice prompts block senior roles just like approvals
The user once came back after hours to find the Auditor sitting on a set of three AskUserQuestion prompts. The Leader and workers kept working, but the Auditor neither worked nor supervised. Auto/bypass mode removes most approvals but not question tools.
- **Prevent at launch, per CLI, using launch-scoped flags only (never user config).** Disable the native question tool for loom-managed roles:
  - Claude: `--disallowedTools AskUserQuestion` (verify the exact flag on 2.1.331).
  - Codex: no plan mode / disable request_user_input.
  - agy: ask_question, if a launch setting exists.
  - OpenCode: permission `question: deny` via the launch config path loom already controls.
  - Verify each live: the role cannot open a question prompt, and the tool's absence does not break the turn.
  - Policy override `roles.<r>.allowNativeQuestions` (default false).
- **Non-blocking replacement.** Role prompts and the skill say: to ask the user or Super, use `"$LOOM_BIN" notifications --needs-decision TEXT --kind decision` (PYRAMID-2), write the options in a file, and keep working on whatever else is possible. Super/user answers arrive as a normal delivery.
- **Detect anyway.** Items 2–3 still apply, because a prompt can appear by other paths (slash pickers, approvals outside bypass, future tools). A senior role in `awaiting-choice`/`awaiting-approval` past the bound gets a desktop notice to the user that names the role and the question summary.
