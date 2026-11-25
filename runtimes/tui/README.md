# OAR TUI runtime

`createTuiRuntime(cli)` supports Claude Code, Codex, and Antigravity. `createTuiRegistry()` adds `claude-tui`, `codex-tui`, and `agy-tui` alongside the existing headless runtimes. OAR consumers get the session record stream, prompt, local queue, withdrawal, guarded abort, and disposal. The provider adapters supply launch arguments, screen rules, and native hooks. The local OAR queue is in memory. loomd owns its durable inbox and uses the same transport directly when managing a pane or reconnecting after restart.

`openNativeTui()` resolves the native CLI from its absolute path or a standard installation directory and starts `tui/loom-pty` under hc. Use `LOOM_CLAUDE_BIN`, `LOOM_CODEX_BIN`, or `LOOM_AGY_BIN` for other locations. The pane runs independently of loomd. Its launch records associate the control socket, native event sink, request book, and exit record with the process incarnation. A failed wrapper before native launch can leave a plain hc pane for a human. The transport and fallback reason appear in Loom receipts.

The wrapped host exposes `restart()` after hc confirms the old process ended. An optional `resume` UUID selects the exact provider session. The replacement receives a new incarnation, hook sink, and request book. A supervising caller can persist the new binding and decide how to reconcile unresolved deliveries from the predecessor.

Use `boundTranscript: false` to scope evidence reads to the specified state directory. Antigravity records hook activity directly from the payload in this mode.
