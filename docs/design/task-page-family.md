# Task page family: Raft presentation over canonical RAH Task truth

## Decision

The Room Task tab and global Tasks surface are one page family. They consume one
board, one filter/menu family and one Kernel-owned Task lifecycle. Raft supplies
the visible and interactive contract; it does not become a second backend.

Source priority for this batch is fixed:

1. Raft published Web bundle
   `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`, SHA-256
   `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`.
2. Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`, inspected only where Raft does
   not provide a local reliability mechanism.
3. RAH local adaptation, documented here and owned by typed SDK/Kernel commands.

Raft functions `pce`, `Vst`, `qst` and `Kst` are the extraction landmarks:

- `pce` composes the five columns and initially collapses Done and Closed;
- `Vst` owns the Task card, Room-label scope, hover/lift and status trigger;
- `qst` owns the bounded fixed status menu;
- `Kst` owns repeatable title rows, row removal, blank filtering, “再加一条”
  and the plural create action.

The Multica Issue status/catalog/cache system was inspected and deliberately not
ported. Its Issue model is not RAH's `Task → RunAttempt → Submission → Review`
lifecycle, so importing it would recreate the split truth found by the external
architecture audit. No Multica production code is used by this page family.

## Owners

- `apps/web/src/components/global-task-board.tsx`: the shared Room/global
  board, card, column and five-state status presentation.
- `apps/web/src/components/task-toolbar.tsx` and
  `apps/web/src/components/discovery-filter.tsx`: creator/assignee filters and
  board/list controls.
- `apps/web/src/components/task-dialogs.tsx`: the Raft-shaped multi-title
  create dialog and the explicit pre-create collaboration stage.
- `apps/web/src/components/task-participant-fields.tsx`: the single shared
  assignee/collaborator/reviewer field owner used by both the Room composer and
  Task dialog. It validates combinations through `taskParticipantsForSelection`;
  it does not own Task truth.
- `apps/web/src/task-create-execution.ts`: the exact per-row command ledger.
  It removes confirmed rows, retains byte-equivalent ambiguous requests, and
  permits regeneration only after an explicit stale-context rejection.
- `apps/web/src/room-task-pages.ts`: the bounded Room Task page owner and
  continuation merge. It prevents the active projection from becoming either
  an unbounded resident list or a silent first-500 truncation.
- `apps/web/src/App.tsx` and `apps/web/src/global-task-actions.ts`: causal typed
  writes. The browser does not set Task state optimistically.
- `packages/kernel`: canonical lifecycle, Review gate, dependencies, execution
  continuation and Room events.

Raft's primary `Kst` screen remains the default: repeatable title rows are the
only fields shown initially. RAH adds an explicitly labelled second stage,
`配置协作与依赖`, before submission. It configures assignee, collaborators,
reviewers and active prerequisite Tasks in the same canonical `task.create`
commands as the titles. This is a documented local adaptation rather than a
claim about Raft's central backend. It prevents an open Task from being claimed
between creation and a later role edit, without making advanced configuration
mandatory for ordinary open Tasks.

## Local reliability adaptation

Raft sends all non-empty titles through a central bulk create call. RAH has a
local typed `task.create` command. The Web client therefore freezes the entire
per-row command and submits rows in order through the current Room sequence
session. Every dialog row has a stable client ID used as its idempotency key.
Once any request was attempted, title and collaboration inputs remain locked.
Confirmed rows leave the ledger; an ambiguous response retains the exact
request—including the original Room sequence and all role/dependency IDs—and
retry sends only that remainder. A stale-context response is different: Kernel
has rejected the command before acceptance, so the row may be regenerated from
the latest Room baseline. Every accepted row must independently appear in
`task.list` and as `task.created` in the Room ledger.

Room Task reads are bounded. The initial projection merges the recent slice
with at most 500 active Tasks and exposes the typed continuation. “Load earlier
Tasks” follows that continuation and merges by canonical Task identity. This is
not a second client-side Task truth and does not change global Task query truth.
The page owner retains at most three explicitly visited continuation pages for
each Room and at most eight Room windows. Every ordinary Room poll re-reads the
base and each retained cursor, so a visited older Task cannot disappear or keep
an obsolete state merely because the newest page refreshed. A generation plus
AbortSignal fence prevents a late read for an old Room from publishing after a
newer Room read. Loading an earlier page concurrently with a poll preserves the
newer explicit page window; a subsequent poll refreshes its canonical state.

The visible five-state menu is not permission to fabricate lifecycle evidence:

- In progress requires a real claim/RunAttempt.
- In review requires a frozen Submission.
- Done requires the configured Review and Human completion contract.
- Closed maps to canonical cancellation.
- Reopening a closed Task maps to canonical `task.reopened`.

## TDD and browser matrix

`apps/web/test/task-page-family-contract.test.ts` first failed against the old
single-task advanced form and the empty-only browser fixture. It now locks the
Raft source shape, internal owners, canonical fixture construction and browser
scenario wiring.

`discovery-page-family` runs the production UI against an isolated real
Kernel/daemon with fake runtimes. It covers:

- 1440×900 and 390×844;
- all five columns and terminal-column collapse defaults;
- non-empty cards, long titles, Room/global Room-label scope;
- creator/assignee filters, sentinel rows, search, clear and Escape focus;
- board/list mode and viewport bounds;
- five-option status menu, disabled evidence-forging transitions, canonical
  close/reopen results in both independent Task reads and Room events;
- two-title creation, optional prerequisite selection, both resulting Task
  projections, both dependency lists and both `task.created` Room events;
- a first-row success followed by an ambiguous second-row response, locked
  inputs, retry of only the byte-equivalent remainder, and no duplicate first
  command;
- a server-accepted Task whose successful response is replaced by malformed
  transport content, followed by an exact canonical read and byte-equivalent
  idempotent retry; a separate `stale_context` case proves that only explicit
  pre-acceptance rejection permits regeneration;
- 1,001 active Room Tasks across two 500-item continuation pages, two ordinary
  poll cycles, an older Task state transition and a final continuation. This
  proves visited pages remain visible, refresh canonical state and advance
  without silently truncating or growing the browser cache without bound;
- the full fake-runtime gate creates a Task through the same secondary stage,
  assigns Kimi and Alice as reviewer, observes first-submission rejection,
  revised frozen delivery and approval, then independently reads the completed
  Task and `task.completed` Room event after Human confirmation.

Passing this matrix proves only the registered Task page-family scope. It does
not claim all Raft permissions/error states, cross-computer behavior or full
product parity.
