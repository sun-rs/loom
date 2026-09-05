# ADR-0030: Bounded Room history and visible receipt projections

## Status

Accepted on 2026-09-05.

## Context

The Room ledger is the canonical collaboration history, but a Human browser is
not a second ledger owner. A cold browser previously synchronized from sequence
zero, repeatedly requested every page, and retained every event body. A
100,000-event Room therefore produced 200 automatic reads and an unbounded
in-memory projection even though the Message surface already exposed Raft's
50-message initial window and an explicit earlier-history action.

Simply truncating Room events in the browser would have removed visible
semantics. In particular, Agent-reference read/unread dots were derived from
the complete historical delivery and Inbox event stream. Task, Review and
Submission projections also contained whole-Room and per-Task query patterns.

The available Raft evidence establishes the visible Message window, explicit
history loading, receipt markers, and user interaction contract. It does not
provide an official Raft server implementation that can be copied into the
local daemon. The local persistence and ACL behavior therefore remain owned by
the RAH Kernel.

## Decision

1. A cold Human `RoomSession` requests `bootstrap: "latest"`. The Kernel returns
   a current Room snapshot at `snapshotSeq`, together with at most 500 trailing
   events and an explicit `eventFloorSeq`. These metadata fields are paired,
   schema validated, and may be used only for a cold projection.
2. Worker synchronization keeps the complete causal event-delivery path. The
   bootstrap shortcut is a Human read-model optimization and cannot skip an
   Activation's durable range or acknowledgement.
3. The browser retains at most 2,000 Room events per open projection and marks
   whether the event history is complete. Code that needs complete history must
   not silently treat a bounded projection as complete.
4. Message bodies continue through the dedicated `MessageSession`: the first
   page is 50 Messages, older pages are loaded only by an explicit user action,
   and prepend preserves the visible anchor. Explicitly requested history may
   stay in the current Message session; it is not fetched automatically on a
   cold Room open.
5. Room, Message and Thread session maps are eight-entry least-recently-used
   caches. Revisiting an entry refreshes its position; eviction never changes
   daemon truth.
6. Visible Agent-reference read states come from a dedicated ACL-checked query
   over canonical `room_events` and `inbox_items`. Each request accepts at most
   200 unique visible Message identities. An acknowledged mention is `read`;
   any other existing mention Inbox item is `unread`. Presence and replay depth
   are not receipt truth.
7. Room Task reads use descending `task_number` keyset pagination with a
   default of 200 and a maximum of 500. Dependencies and participants are
   loaded once per returned page, not once per Task. Room Review and Submission
   evidence reads accept an exact Task set and use the same 200/500 bound.
8. Schema 49 adds indexes for Message aggregate receipt lookup and bounded
   Room evidence ordering. Protocol, SDK, HTTP and Kernel all carry the same
   limits and identities.

## Consequences

- Cold Room cost is bounded by the snapshot and tail instead of Room age.
- The Raft-visible Message, mention receipt, Thread and attention behavior is
  retained without requiring complete browser ledger replay.
- A snapshot is trusted only at its declared current boundary. Missing,
  mismatched, or partial bootstrap metadata fails closed.
- Explicitly loading arbitrarily old Message pages can intentionally grow the
  currently open Message session. A future product limit must be a visible
  history policy, not silent data loss.
- Older Task-page UI, Thread-directory scale, membership scale, and frozen
  delivery evidence remain separate follow-up work; this decision does not
  claim whole-product Raft parity.
