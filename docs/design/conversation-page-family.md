# Conversation interaction and Search state family

Status: implemented, verified in the cumulative Chrome/Firefox matrix and
deployed through the guarded formal-workbench restart

Date: 2026-09-05

## Owner and source order

This batch keeps the existing Room-first architecture. The browser renders and
initiates intent; the typed client, application service and Kernel remain the
only owners of Thread follow, Message, Task and Room-ledger facts.

Evidence order:

1. Authorized frozen Raft Web artifact
   `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`, SHA-256
   `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`.
2. Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f` for generic
   cancellable/IME-safe request patterns only.
3. RAH local glue only where the local canonical model differs.

The relevant Raft landmarks are `Bf` (Message item/context menu), `Kit`
(Thread overflow), `qO` (Search), `_lt` (five-card Search skeleton) and `Alt`
(Search failure). The frozen bundle places message actions in this order:
quick reactions, copy link, copy Markdown, optional translation, selection,
Thread entry, save, optional Thread follow, then linked-Task complete/reopen or
unlinked-message conversion.

## Adopted behavior

- A message with a real Thread lazily reads `thread.followers` only while its
  menu is open, then changes the Human's canonical follow state through
  `activity.follow`. A message without a real Thread does not invent the item.
- A linked Task uses Raft's `标记为完成` / `重新打开任务` labels and location.
  The action delegates to the same `task.workflow.update` interpretation used
  by the Task board, with a stale revision read before mutation.
- Search does not request during IME composition. A new query shows the
  source-backed five-card pending state; a failed read shows an in-stage error
  and an explicit retry; retained data is not replaced by an empty result.
- Long-message expansion, composer Send and Thread open/close remain shared
  behavior paths. Browser acceptance must verify their canonical or focus
  result, not only their visible DOM.

## Deliberate local boundary

Raft's menu can present reopen for a `done` task. RAH distinguishes a safely
cancelled Task from a completed delivery. A completed Task carries immutable
submission and Review evidence, so the menu retains Raft's `重新打开任务` label
but disables it with an explicit canonical-evidence reason. A cancelled Task
can reopen only through the existing cancellation fence. A submitted Task can
complete only after the Kernel verifies Review.

The frozen Raft Message menu does not contain ordinary-message edit/delete, so
RAH does not invent either action. Translation also remains absent until a
real local translation owner exists.

## TDD and browser matrix

The failure-first contract covers every Task state and permission branch,
source-backed menu items, Search IME, skeleton and retry ownership. The real
Chrome and Firefox matrix runs at `1440x900` and `390x844` and verifies:

- Search IME request suppression, five skeleton cards and failure/retry;
- reaction/save cleanup plus lazy message-menu Thread follow persisted in the
  canonical follower read model;
- linked todo Task completion disabled with the Review reason;
- long-message expand/collapse, Thread close focus return and composer Send;
- the posted Message is independently present in the Room ledger.

No paid Provider is used by this acceptance path.
