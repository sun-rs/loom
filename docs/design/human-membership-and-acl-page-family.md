# Human membership and ACL page family

Status: implementation plan, 2026-09-05.

## Source and product boundary

The published Raft `HumanDetailPanel` is the structural reference for the
members sidebar, Human profile, direct-message action, self profile editing,
role presentation and permission-conditional management controls. The frozen
evidence is `docs/evidence/raft-web-20260831-current/HumanDetailPanel-DvWNsDz9.js`
(SHA-256 `83c31367e48dc1ff6fb75c763ae78fafe16070d53e7d4d58ba16303f7c49bceb`).
The live authenticated page was checked read-only on 2026-09-05: it lists all
Workspace Humans, opens a stable Human URL, exposes the same role/profile
sections, and uses a central email/link invitation dialog.

RAH does not copy Raft's central account invitation backend. A local device
pairing code is not a Human identity invitation, and removing only the control
Room row is not a safe Workspace-wide removal. Those controls remain absent
until a local identity credential lifecycle and atomic all-Room revocation owner
exist.

## Single owners

- Workspace Human membership: Human memberships in the unique control Room.
- Public identity: canonical `Principal`; role and join time: control-Room
  `membership`.
- Directory read: one ACL-checked Kernel projection, exposed through the typed
  Human API. It is bounded and contains Humans only.
- Cross-page identity: `workspace-entities`; the sidebar, profile, messages,
  mentions, creator cards, Tasks and relationship graph do not keep copies.
- Role mutation: the existing causal `room.member.role` command on the control
  Room. The UI does not create a second Workspace-role state machine.
- Direct message: the existing idempotent `room.direct.open` owner.

## TDD and acceptance matrix

1. Kernel rejects outsiders, excludes Agents, sorts deterministically, returns
   current Principal metadata and bounds the result.
2. Protocol/client/HTTP route reject actor injection and response widening.
3. The members sidebar displays every authorized Human and identifies only the
   current actor as “you”; every row opens that Human's stable profile.
4. Owner-only role editing obeys last-owner protection and reconciles the
   profile from the canonical response. Members never receive a working write
   control merely because the page rendered it.
5. Desktop and 390×844 Chrome/Firefox scenarios cover multiple Humans, profile
   navigation, DM open, role save, denied management, reload, hover/focus and
   long names. Browser success must be paired with an independent API read.

The batch does not claim Raft account/email parity, Human invitation, global
removal, or a complete product-wide ACL matrix.

## 2026-09-06 authority freshness repair

The current one-shot App control-Room role read is a second, stale presentation
of membership. Replace it with the existing reconciled `workspace.human.list`
projection; failed/pending scope reads fail closed for management controls.
Directory failures must show retry, never an unexplained zero-person directory.
The same directory observation refreshes an open Human profile when that
Human's identity/role or the viewer's role changes. An editor closes when its
authority is lost, and keyboard submission checks the same authority.
Scope changes must unmount the old Human editor so late mutation errors cannot
replace the new subject's form; successful saves return focus to the trigger.

Sources: the frozen HumanDetailPanel above and live read-only official Human
profile/role-help inspection on 2026-09-06. Live official data has one Human;
it cannot certify a multiple-Human permission transition. Multica commit
`11861145abc59a0d39c8c8f24ad837d4584e664f`,
`server/internal/handler/workspace.go::UpdateMemberRole` also invalidates its
membership cache after a role update and guards the last owner. RAH retains its
existing stricter owner-only mutation and atomic Kernel check; no Go handler,
central invitation, cache or permission state machine is ported. Official self
message and email fields remain declared local differences; local role-help
focus return remains accessible even where the observed official Escape leaves
focus on the document.

Acceptance uses a separately flagged disposable fixture with three real Human
principals and the real canonical APIs. It covers role save, repeat reads,
last-owner/denied writes, authority loss with an open editor, directory failure,
reload, mobile navigation and old-scope responses. No real-provider calls or
formal Human role changes are involved.
