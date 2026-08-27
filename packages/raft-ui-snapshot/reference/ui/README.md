# UI runtime ownership

This directory owns behavior shared by source-backed HTML projections. It does
not own Room, Agent, Task, Computer or Activity data.

## Runtime

`raft-ui-runtime.js` is the only module allowed to construct `CustomEvent`
instances for product integration. It validates and freezes v1 intent envelopes,
assigns request identity, rejects unregistered domain/action pairs, serializes
state transitions, supersedes keyed stale requests, locks all declared controls
while pending, prevents duplicate terminal transitions, runs rollback and the
post-unlock success `commit`, isolates sensitive adapter context, and exposes the
single host adapter. It contains no local-fixture success path and fails closed
with `ADAPTER_REQUIRED` when no adapter is installed.

`raft-ui-reference-adapter.js` is the only reference-fixture completion owner.
Every source-comparison HTML entry loads it explicitly after the runtime. It
marks the document as `data-raft-surface="reference"`, never performs network
I/O, and prevents a `rah-client` adapter from being installed on the same page.
The optional RAH bridge and fake client live outside this directory under
`integrations/rah-os/`; reference entries are forbidden from loading them.

## Primitives

`raft-ui-primitives.js` owns DOM behavior that must not be independently copied
by pages:

- `resizablePanel`: pointer capture, clamping, ARIA value projection and keyboard
  steps for context sidebars. Pointer cancellation restores the drag origin; the
  `requestCommit` hook lets the route bind both apply and rollback to one protocol
  transaction.
- `disclosure`: ARIA-expanded/panel visibility coupling, with a transactional
  request hook.
- `segmentedControl`: single-selection class/ARIA projection, arrow-key behavior
  and lazy apply/rollback hooks that remain correct under keyed supersession.
- `listboxSelect`: searchable and compact listbox selection, selected-state
  projection, arrow/Home/End/Enter/Escape handling, outside close and focus
  return through one delegated control owner.

Primitives do not invent product state. A page adapter supplies protocol intents
for any change that must leave the browser projection.

## Migration gate

A route is protocol-migrated only when it:

1. loads the shared runtime and explicit reference adapter before page code;
2. routes every product mutation through `RaftUI.project` or the explicitly
   host-completed `RaftUI.transaction` form;
3. records enough pre-state to rollback optimistic changes;
4. leaves backend ownership to an injected `rah-client` adapter outside the
   reference entry;
5. retains legacy events only through the runtime compatibility option; and
6. registers the action in `protocol/raft-ui-actions.json`; and
7. passes `scripts/raft-ui-protocol-check.py` in Chromium and Firefox; and
8. passes `scripts/raft-ui-boundary-check.py`, proving the reference surface has
   no backend integration or remote network dependency.

`scripts/raft-ui-control-ownership-check.py` separately walks every desktop entry
with Chromium's listener inventory and fails when a button has neither a direct
listener nor a narrowly declared ancestor/form owner. This keeps visually valid
but inert controls from silently returning.

Visual DOM is deliberately not abstracted here. Raft source-derived selectors and
box geometry remain stable while behavior is migrated; a future React port can
map these contracts to framework components without changing protocol v1.
