# Run-scoped message search and reactions

## Source and adopted behavior

Raft Computer 1.0.18 `packages/shared/src/agentApiContract.ts`, extracted from the
published npm Computer bundle, defines messageSearch and messageReactionAdd/Remove
at lines 1463–1491. Extracted-file SHA-256:
`ce9db68aff56f34e56186cc8332d9b1dae74196422f113353de0a288915cf4db`.
The source contract binds actions to the Agent credential and visible messages.
Existing upstream provenance/license records remain in the
[reuse ledger](../audits/2026-08-29-raft-multica-reuse-ledger.zh-CN.md).

Multica revision `11861145abc59a0d39c8c8f24ad837d4584e664f`,
`packages/core/api/client.ts` addReaction/removeReaction around lines 1375–1387,
uses server-owned comment reaction commands. It does not supply a RAH Run-scoped
Room authority model. No upstream code was copied in this batch: this is local
glue over existing discovery and reaction owners, implementing the observed
capabilities without claiming the private Raft server algorithm.

## Owners and intentional differences

Protocol owns strict `WorkerMessageSearchRequest/Response` and
`WorkerMessageReactionRequest`. WorkerApplicationService authenticates the Run
credential; MessageSocial delegates search to GlobalDiscovery and delegates
reaction writes to the same private transaction used by Human reactions.
RoomKernel supplies the existing unforgeable execution-context validator.
The common Human service composition supplies that validator; it does not grant
the Worker Human discovery, bookmark or account permissions.

- POST `/v1/worker/messages/search`: query, limit (1–100), optional cursor.
- POST `/v1/worker/messages/react`: messageId, emoji, active, basedOnRoomSeq,
  idempotencyKey. Add/remove is explicit desired state, not a toggle.
- CLI: `rah worker message-search` and `rah worker message-react`; fixed route
  mapping, strict allowed options, no caller-supplied actor or Room.

Search uses the existing discovery_messages projection, Unicode casefold/term
matching and discovery pagination owner. Cursor filters bind the Run, Room,
query and delivered upper sequence. Ordering is recent-first; no unknown Raft
relevance algorithm is claimed. The cursor is not advertised as signed;
authenticated scope and the independently enforced toSeq ceiling bound every read.
A cursor never provides authority to another Room or later messages.

Reaction revalidates current membership, execution fence and message visibility;
its causal frontier must be the Run's delivered toSeq, known to the service after
sync. The same reaction tables, per-actor idempotency receipts and Room event
writer serve Human and Agent actions. Replaying a command does not increment the
count or create a second event. It does not acknowledge Inbox or complete Task.
No new schema/table, queue, history store or credential type is introduced.

RAH intentionally permits only this Run's Room and frozen delivery ceiling.
Raft's broader Agent directory/channel/profile capabilities are not implicitly
granted by these endpoints. Human-controlled membership remains the current
work path; autonomous Room joining would require its own explicit authority
contract. Self-profile editing belongs with profile behavior, not message tools.

## Verification

HTTP tests first failed at the missing search route (404), then cover bounded
pagination, current Room isolation, later-message exclusion, changed-query
cursor denial, authenticated reaction attribution, replay, removal and revoked
credentials. CLI tests first failed for the missing commands, then verify exact
routes/bodies and reject Room injection.

The browser gate launches a real isolated OS child using the existing fake CLI.
After sync it invokes the actual injected Worker wrapper to search the explicit
probe message and react. Human Chrome/Firefox, desktop/390×844, read the same
canonical reaction count and Agent identity. This is not a paid-model test or
new official live bilateral acceptance.
