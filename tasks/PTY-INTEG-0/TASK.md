# PTY-INTEG-0: make hc + loom-pty the production TUI path for all top-level roles
Read first: tasks/TUI-HOST-0/RESULT.md, tui/README.md, tasks/PROTO-HARDEN-0/RESULT.md, docs/PROTOCOL-v2.md.
1. Dependencies: add node-pty and @xterm/headless (exact pinned versions used in TUI-HOST-0) to the root package.json; no sub-installs.
2. Generalise runtimes/claude-tui into one OAR-conformant TUI runtime (runtimes/tui/) for claude, codex and agy, built on tui/ (hc + loom-pty). The CLI-specific parts stay as thin adapter plugins. Delete code paths made redundant (old hc-send-based writes), keep a plain-hc fallback only if loom-pty fails to start, and report it in receipts when used.
3. loomd/inbox: TUI writes go only through the loom-pty control socket (writeIf/submit with confirmation; human-active pauses automated input). Keep the PROTO-HARDEN guarantees and tests green; add tests for human-typing contention via the socket.
4. Wrapper lifecycle: if the loom-pty process dies, loomd marks pending TUI deliveries uncertain → escalation (per protocol), and loom state shows it. Persist the request book so a restarted loomd can reconcile.
5. loom spawn --mode tui uses hc run ... -- tui/loom-pty <native binary absolute path> ...; hc ls must still show the right agent/status (verify).
6. Live smoke with REAL accounts (cheap models allowed: claude sonnet, codex gpt-6.2-sol low, agy default) in /Users/sun/Code/exp-relay/pty-integ-0/: for each of claude/codex/agy as TUI: cold start + trust dialog, 5 queued sends with native confirmation, one interrupt + continue, one draft typed by a simulated human (via hc keys) that must not be clobbered. Record evidence.
7. npm test green; RESULT in Chinese with before/after line counts of the TUI layer.
Writable: runtimes/, tui/, daemon/, inbox/, cli/ (spawn path only), package*.json, tasks/PTY-INTEG-0/.

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
