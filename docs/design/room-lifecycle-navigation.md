# Room lifecycle settlement and navigation

Date: 2026-09-07. Implemented batch; verification and limits are recorded in the linked audit.

The App's existing navigation generation owns user location. An accepted leave,
delete or archive operation owns only its original Room projection. An old
settlement must not replace a newer Room/Workspace/Search location, close that
location's dialogs, or change its Room sequence. The original Room's successful
canonical change must still be reflected; dropping its response is not rollback.

Source: authorized Raft `index-BoAC7nSE.js` (SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`), Channel
overflow/edit confirmations around offsets 3065456 and 3090277, Chat/Thread
join controls at 3197206 and 3273805. These establish user-triggered lifecycle
and membership-dependent composer behavior, not an upstream proof of every
late-response race. Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`,
`server/internal/handler/chat_archive_cancel_test.go`, ties archive settlement
to post-commit cancellation of that exact bound session. It does not solve Web
navigation ordering, and copying its Session model would add integration cost;
no server handler or state model is ported for this client fix.
RAH reuses the existing navigation generation and canonical Room services.

First reproduce a held, actually accepted Room lifecycle response followed by
browser Back to a new surface. Check both the canonical original-Room result
and preservation of the new location; cover Chrome/Firefox, desktop/mobile,
reload, repeated reads, and a failed response. Dedicated fixtures contain no
real provider, and destructive actions never target the formal workbench.

Public Channel parity is a separate remaining contract: official non-members
can read public history, join to send, and retain eligible public Thread follows
after leaving. RAH currently requires membership for all Room reads. Do not
change `requireRoomMember` globally to implement join: delivery, reading and
writing need distinct policy boundaries and visibility-revocation tests. This
batch does not claim that public browse/join/follow parity is implemented.

## Next public-Channel slice: required owner separation

The next implementation must introduce a narrow Human public-read policy at the
existing collaboration policy owner, rather than weakening the membership gate:

- Read eligibility: current Human membership of the Workspace control Room plus
  public regular Channel, or existing Room membership. Private/control/direct
  Rooms remain behind their existing policies; Agents gain no Workspace-wide
  history access merely because a Human can browse.
- Participation: Room membership continues to own ordinary delivery, sending,
  Task mutations and activation eligibility. Join can add only the authenticated
  Human as an ordinary member; it cannot grant a role or enroll another actor.
- All read entry points must use the same current visibility decision: list,
  exact-ID navigation, history/cursors, Search, Thread and published Room file
  reads. This does not grant AgentHost private workspace filesystem access.
- Public Thread follows survive leave only while current read eligibility holds.
  They do not restore ordinary top-level unread/delivery or Agent activation.
  Public-to-private and Workspace revocation must immediately deny old cursors,
  saved targets and attachment reads; existing read receipts are not authority.
- Discovery and join use bounded typed projections and the existing Room
  transaction/event/idempotency/freshness owner. The UI offers join on a readable
  non-member Channel and Thread; writing stays disabled until the canonical
  membership result is reconciled. No second client membership state is created.

Exit evidence must include outsider/Agent/removed Workspace member denials,
private/direct/control/archive cases, concurrent visibility changes, duplicate
join, history pagination, follow delivery after leave and revocation, plus the
same front/back result at desktop and mobile sizes. These are planned tests,
not claims that the capability exists in this batch.

Verification: [Room lifecycle and Task virtual-window audit](../audits/2026-09-07-room-lifecycle-navigation-verification.zh-CN.md).
