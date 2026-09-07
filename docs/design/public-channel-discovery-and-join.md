# Public Channel discovery and authenticated self-join

Date: 2026-09-07. Backend slice implemented; verification is recorded in the linked audit.

Raft's authorized frozen Web bundle `index-BoAC7nSE.js`, SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`, exposes
Channel search and `message.chatPanel.joinChannel` / Thread join-to-reply
controls (render paths near 3197206 and 3273805). Its public-read, participation
and follow semantics are distinct. These are product behavior evidence, not
available Raft server implementation. Multica revision
`11861145abc59a0d39c8c8f24ad837d4584e664f` was searched for a comparable Human
public-channel self-join owner; its connector Channel handlers are not equivalent.
No upstream server algorithm or legacy RAH Session model is claimed copied.

The Kernel's collaboration policy owns current eligibility. A new narrow Human
Channel service composed through the existing Human command factory owns the
metadata directory and self-join transaction. It reuses memberships and the
RoomEventWriter; it adds no database, queue, role model or delivery state. HTTP
and SDK are typed facades over the same HumanApplicationPort.

This first slice exposes only public active Channel metadata inside an active
Workspace with a current Human control-Room membership. Results are bounded
(1–100), use live Room-ID keyset pagination, and contain the Room, current Room
sequence and the caller's membership if present. Cursors are seek positions, not
frozen history or authorization. Every page checks current permissions. Search
is literal text, not SQL patterns. Private, direct, control and archived Rooms
are absent. Agents and outsiders cannot use this directory.

Self-join accepts only Workspace ID, Room ID, observed Room sequence and an
idempotency key. Actor identity is authenticated and the resulting role is
always member. Current Workspace/Channel eligibility is checked inside the
transaction, including replay. A changed Room sequence holds the mutation.
Success inserts one membership and one existing membership.added event; joining
alone neither activates Agents nor acknowledges Room delivery. Replay with the
same original key returns the original event only while that joined membership
still exists. Leaving and rejoining is a new intent with a new key. Another
join key against existing membership conflicts without changing its role.

This is deliberately a backend prerequisite, not complete public-Channel parity.
No frontend button is enabled until its full contract is ready. Existing
rooms.list stays the joined directory; history, Search contents, file access,
Task writes, Agent delivery and follow permissions remain unchanged. The next
slice must integrate the shared public-read decision across all read entry
points before offering the official non-member Chat/Thread UI. Full history
snapshots must be reviewed for non-message payload disclosure rather than
blanket-changing requireRoomMember.

Required tests: bounded pages/filtering, authenticated ordinary Human success,
Agent/outsider/control/private/direct/archive denials, role-spoof rejection,
permission/visibility changes between discovery and join, stale sequence,
duplicate and cross-actor keys, rollback on event failure, restart persistence,
and unchanged pre-join history access/Inbox/Activation/cursors. HTTP and SDK
must prove they call the same capability and reject unrecognized input.

The current createWorkspaceRoom implementation already enrolls existing Workspace
Humans when creating a public Channel. This slice preserves that behavior and
supports rejoining after leave (and later Workspace members); it does not claim
to redesign initial enrollment. HTTP POST /v3/client/rooms/public/discover and
/rooms/public/join correspond to SDK room.public.discover and room.public.join.
The new implementation is RAH glue over existing Kernel owners; no new upstream
code was copied and no new license notices are applicable.

See [verification](../audits/2026-09-07-public-channel-discovery-and-join-verification.zh-CN.md).

## 2026-09-07 continuation: public content and Thread attention

The initial metadata-only slice above is historical. The current candidate adds
`room.preview` / `/v3/client/rooms/preview` through the same Human port. The
collaboration policy owns a shared current content-reader predicate, consumed by
Search, exact message/Thread navigation, bounded Channel/Thread previews and
published attachment reads. Full Room sync, delivery ACK, Task mutations,
Agent execution grants and uploads retain their membership gates. No Worker
Workspace-wide grant is introduced; Raft Agent channel join/leave and search
facades remain a separately unclosed parity difference.

Preview reads at most 50 messages (plus one Thread root), resolves only projected
authors and excludes execution/event/Inbox payloads. Ordinary pages freeze a Room
sequence ceiling; exact message context uses the existing live bounded context
owner. Each request rechecks access; a cursor or prior download receipt grants
nothing. Activity retains eligible followed public Threads after leave, but
ordinary channel attention and new unsolicited mentions still require membership.
Task details in Activity remain membership-only. Follow management grants no
Agent follower administration. Visibility/Workspace revocation hides the Thread.

Search selection is URL-owned and preserves the left search panel. Joining feeds
the existing Room session and composer. Activity opens nonmember Threads through
the same bounded preview. No second send or membership owner exists. A failed
preview read clears displayed old content. Join retries retain the exact intent;
using a newer Room sequence is an explicit separate action.

Live official observation on 2026-09-07, `app.raft.build/s/hakasemac/search?q=test`,
confirmed Search remains left of its opened Channel (1280x720: rail 64px, Search
560px, Channel 656px). 560px is a live measured result, not an extracted CSS
literal. Escape with the Channel composer focused did not close that Channel;
the local preview does not invent that shortcut. This was an already joined
Channel; official nonmember join/follow and equivalent nonempty data have not
been bilaterally accepted. The minimal nonmember preview does not yet certify
all official tabs, message actions, avatar presentation or media draft tray.

Evidence and remaining boundaries: [current continuation audit](../audits/2026-09-07-pre-settings-continuation.zh-CN.md).

## 2026-09-07 public surfaces continuation

Live Raft nonmember checks now additionally cover reading the Task board,
opening a Task Thread, and the empty Files tab. The operator rejoined the
reference Channel and confirmed its composer returned. Nonempty official Files
and ordinary nonowner Task writes were not exercised. A visible New Task button
on the reference Workspace owner's screen is not a grant for every nonmember.

The Human preview reuses the existing bounded Task projection for `view: tasks`
and includes only Tasks linked to visible roots in chat. Authors use the canonical
Principal profile projection; Thread IDs/counts use the existing Thread projection.
`rootMessageId` opens an unanswered root without creating a Thread or work.
All previews recheck current content-reader eligibility; full sync remains fenced.
Task pages are current keyset projections, not frozen Task state at message ceiling.

Personal bookmarks reuse MessageSocial and its idempotency receipts. Public
readers may save readable messages without Room events. Saved discovery rechecks
current access. Reaction mutations still require membership, including retries;
`canReact` is a server-derived presentation capability, never write authority.

The frontend composes existing ConversationTabs, TaskPane, RoomFilesPane and
MessageArticle. Task cards separate reading from mutation/drag disabling. A Channel
and its Thread coexist on desktop; mobile shows the Thread with a return action.
Tab selection belongs to the existing URL navigation owner. No new business store,
Provider parser or central-server dependency was introduced.

Candidate verification is tracked in the current continuation audit. These changes
do not certify full Raft parity, nonempty official file browsing or paid Providers.
