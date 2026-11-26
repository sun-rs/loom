# Loom in Herdr

Run `loom up --project /absolute/project` to start loomd and create the project's Herdr space. The first spawn also creates the layout when Herdr is available. Loom places Leader, Auditor and Status in that order. Run `loom up` again to repair a deleted space or tab. A tab for a role awaiting launch shows a placeholder. Closing a pane, tab or space in Herdr ends the terminals it contains. Relaunch a role through Loom after closing its pane.

Use `loom status --project /absolute/project` for the space ID, tab IDs and current terminal addresses and names. During a Leader or Auditor handover, both terminals occupy the same tab until the successor confirms its briefing. Queued messages sent to the role wait for that acknowledgement. Loom delivers them by the session record and its verified terminal binding.

Herdr Core 0.1.22 assigns an hc name at launch and keeps it for that terminal's lifetime. With overlapping terminals, the successor receives its own hc name. `loom layout get leader --project /absolute/project` and the corresponding `auditor` command return the acknowledged live terminal address across handovers. Pass that address to `hc get` or `hc attach`. The Status terminal uses the same project-scoped hc name whenever it is relaunched.

## Status

`loom tui --project /absolute/project` opens the read-only board. Up and Down or Page Up and Page Down scroll. Press `h` for history by role, task or address, `g` to grep history, and `m` to search project memory. The results open in a local pager. Escape returns to the board, `r` refreshes, and `q` quits. Add `--once` for a plain-text snapshot. The board reconnects to the project socket after a loomd restart or upgrade.

`loom tui --all` opens the summary of projects registered by the layout controller. Up and Down select a project, and Enter opens it. Escape returns to the summary. The project list is stored per user under `$XDG_STATE_HOME/loom/herdr-projects`, with the default XDG state path `~/.local/state`.

## Super and live adoption

When you want to give a user-started Super terminal a pane, run `loom super --terminal HC_ADDRESS`. This places it in the separate `Loom` space with a global Status tab. For a Super terminal with a pane in another space, use Herdr's Park action on that terminal first. The command acts only after the operator invokes it with the terminal address.

After deploying Loom with layout support, Super can run the following command to place the existing pilot-2 sessions in the project space. Verify the two role addresses with the pilot's session records. The command requires the live, daemon-owned Leader and Auditor addresses.

```sh
loom layout adopt --project /Users/sun/Code/loom-pilot2 --leader LEADER_HC_ADDRESS --auditor AUDITOR_HC_ADDRESS
```

Adoption adds Herdr placement labels and checks that the same terminal and process remain live. Herdr turns on core `keep` when it adds the pane. Loom turns it off after placement so holder loss remains visible as an exit. The original hc address and name remain available. A terminal with a pane in a different space or tab must be parked by the operator before adoption.
