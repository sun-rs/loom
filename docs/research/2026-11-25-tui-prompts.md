# Native TUI prompts and delivery input

Card dated 2026-11-25. Measured 2026-11-26 CST on macOS arm64 against Claude Code 2.1.331, Codex 0.171.0, Antigravity CLI 1.5.17 and OpenCode mini 2.3.0. Each cell used an absolute native executable path, a fresh HOME and Git workspace, a 112×34 PTY backed by Loom's shipped native holder, and a mock model on 127.0.0.1. The shell tool, where approved, only ran `/bin/echo FIXTURE-APPROVED`.

With the prompt visible, the holder wrote one bracketed paste containing `2y1n 界面测试甲\n3n2y 界面测试乙`, then a separate CR. Screen snapshots were taken before paste, after paste, after CR and after dismissal where required. No cell accepted this paste into the conversation composer. No digit or y/n in the bracketed text fired as an independent hotkey. Two choice dialogs took the text as an answer, and the OpenCode model picker took it as a search query.

| CLI | Prompt | Paste and survival after dismissal | Separate Enter | Native evidence while open |
| --- | --- | --- | --- | --- |
| Claude | Bash approval | No composer text or visible selection change. Composer empty after closing. | Approved the highlighted Yes in a repeat and in the Enter-only control. Another run stayed on the approver until Escape canceled. | `PreToolUse` then `PermissionRequest` for Bash, and assistant tool use in JSONL. The tool result appeared after resolution. |
| Claude | AskUserQuestion | Put both lines into the write-in field and selected that field, with no digit hotkey. Text persisted as the tool answer after Enter. | Submitted the answer. Enter alone selected Blue in the control. | `PreToolUse` and `PermissionRequest` named AskUserQuestion. Assistant tool use held the question and options before the answer. |
| Claude | `/model` | Ignored; no text after the menu closed. | Saved the highlighted model as the default in the isolated HOME. | Session hooks remained visible. No new user turn or tool activity for opening the picker. |
| Codex | Shell approval | Ignored; no text after approval. | Approved the highlighted Yes and the echo ran. | Rollout contained the function call and an active turn. The live TUI rendered the approval; app-server has a dedicated command approval request. |
| Codex | Plan-mode request_user_input | Opened the answer notes and inserted both lines. After Enter they survived in the tool answer, with an empty composer. | Submitted the choice response including the notes. | Rollout contained the request_user_input function call and an active turn. No new user-message receipt for the notes. |
| Codex | `/model` | Ignored; no text after dismissing both picker levels. | Opened the reasoning-level picker for the highlighted model. | No corresponding conversation turn. |
| agy | run_command approval | Ignored; no text after approval. | Approved the default Run command option. | `PreToolUse` and the planner tool call precede execution, and the post-tool hook follows it. |
| agy | ask_question | Ignored; no text in the composer and no write-in. | Selected Blue and returned it as the answer. | `PreToolUse` identifies ask_question and the planner transcript carries the question/options. `PostToolUse` followed selection. |
| agy | `/model` | Ignored; no text after selecting. | Selected the highlighted model. | No model turn or tool hook for the picker. |
| OpenCode | shell permission | Ignored; no text after approval. | Confirmed Allow once and the echo ran. | Session export showed the user's active turn. The live event stream emitted `permission.asked` and, on resolution, `permission.replied`. |
| OpenCode | question | Ignored; no text after answering. | Selected Blue and resumed the turn. | Session export showed the user's active turn. The live event stream emitted `form.created` and, on resolution, `form.replied`. |
| OpenCode | Switch model from Ctrl+P | Added both lines to the picker search, concatenated. Escape discarded the filter, leaving the composer empty. | With zero results, kept the picker open. | No corresponding conversation turn. |

Loom must hold delivery until the prompt closes. Enter can act on the dialog even when the paste is dropped, and a paste can populate a write-in or picker search without reaching the composer.

Raw holder streams, rendered snapshots, mock requests and native extracts are in the following isolated runs. `native-before.json` is captured before the experiment's paste. The native extracts may have synthetic fixture answers.

- [Claude and agy observations](/private/tmp/ps1-kCbzOU), [Claude repeat and agy approval/picker](/private/tmp/ps1-IpfsoA), [Claude Enter-only control](/private/tmp/ps1-PBdX6b)
- [Codex observations](/private/tmp/ps1-IMtK8C)
- [OpenCode approval and question](/private/tmp/ps1-cLTm3y), [OpenCode model picker](/private/tmp/ps1-Bq5Fov)
- [OpenCode live event observations](/Users/sun/Code/exp-relay/prompt-state-1/open-native-final.log)
- [OpenCode permissions and native event API](https://opencode.ai/docs/permissions/) · [OpenCode TUI event interface](https://opencode.ai/docs/build/plugins/cli/)


## Launch-scoped question policy and headless approvals

Claude's `--disallowedTools AskUserQuestion` and OpenCode's launch-scoped `question` deny rule removed the question tool from their loopback model requests. With `features.default_mode_request_user_input=false`, Codex still advertised the schema, but its Default-mode rollout returned `request_user_input is unavailable in Default mode` when the mock called it. All three completed the turn. Codex 0.171.0 still lets an operator explicitly switch to Plan, where the prompt remains detectable. agy 1.5.17 accepted a scoped permission deny but still opened the question. The launch-mounted `PreToolUse` deny stopped its question before the UI appeared, including with permission bypass enabled, and the model completed the turn. [Default role launch probes](/Users/sun/Code/exp-relay/prompt-state-1/deny-live-final.log) · [Antigravity hook protocol](https://antigravity.google/docs/hooks)

Native OAR runs with loopback models completed a harmless shell tool and a final reply on Claude, Codex, agy and OpenCode. OpenCode sent an ACP permission request that OAR answered in the same turn. Claude and agy used their native bypass flags. Codex used `approvalPolicy=never`. A forced agy question in ACP completed without a user prompt, even though the mock could see the tool name. [Claude, Codex and OpenCode headless runs](/Users/sun/Code/exp-relay/prompt-state-1/headless-live.log) · [agy shell run](/Users/sun/Code/exp-relay/prompt-state-1/headless-agy.log) · [agy question run](/Users/sun/Code/exp-relay/prompt-state-1/headless-agy-question.log)
