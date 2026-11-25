# loom-pty

Install the pinned dependencies with `npm ci` at the repository root. The root postinstall repairs the executable bit on the macOS prebuilt `node-pty@1.1.0` spawn helper.

Production startup uses `loom spawn … --mode tui`. hc runs `tui/loom-pty /absolute/path/to/native-cli …`. hc owns the visible pane, terminal attachment, agent badges, and exit observation. loom-pty owns the inner PTY, parses the terminal grid and relays human input. `hc ls` continues to report native agent and status.

## Input and recovery

A session has one private Unix control socket and a durable JSONL request book. `hello` reports the protocol version, incarnation, and supported methods. `state`, `submit`, `interrupt`, `dialog`, and `confirmations` are also available on wrappers from before `hello`. Managed clients bind each request to the wrapper incarnation. The inbox records intent before sending a request. The wrapper commits the request ID and text hash before pasting and commits the native confirmation when it arrives. The same ID returns the existing outcome, and changing its text yields an ID conflict.

- For submit, the wrapper requires a stable empty composer. It guards the frame with a generation, pastes the whole input, and waits at least 50 ms before pressing Enter on the matching draft. It can press Enter once more if the provider repaints the same draft and native activity has not advanced. Human input, resize, or a buffer switch interrupts the draft transaction. Keystrokes pause automation for 800 ms. A withheld paste can release the next request once the composer is empty, and its original ID remains available for reconciliation.
- For Claude and OpenCode, startup requires native session evidence. Codex 0.171 and agy first emit root hooks during the first turn. For a fresh wrapped pane with those CLIs, the settled composer and guarded readback authorize the first write. Later writes require native idle evidence and a settled empty composer. hc busy and blocked statuses can veto a write.
- An interrupt binds to the observed native turn and frame. When the cancellation hook is absent, a fresh agy cancellation notice or a Claude draft matching the running request can confirm the interruption. The wrapper requires two matching observations on the same turn. A restored Claude draft stays available for the user. Subsequent writes require an empty composer.
- loomd reconnects to the existing pane after a restart. If the wrapper and pane exit, loomd reconciles the native hooks and request book. Attempts with unknown outcomes remain uncertain and escalate under the existing delivery protocol. Queued requests that never attempted a write receive `target-exited`.
- When the wrapper exits before launching a native process, Loom may launch plain hc and report `transport: "plain-hc"` and `transportReason: "loom-pty-start-failed"`. A person can operate that pane with hc.

Directory-trust actions use the control socket and only advance a recognized stable dialog. Test trust acceptance with isolated provider configuration because native CLIs can save a directory trust decision. An attached user can respond to other dialogs through hc.

[Orca MIT license](LICENSE.orca) · [TUI host experiment](../tasks/TUI-HOST-0/RESULT.md) · [Production integration evidence](../tasks/PTY-INTEG-0/RESULT.md).
