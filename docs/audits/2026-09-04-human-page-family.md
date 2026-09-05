# Human page family: implementation review

Date: 2026-09-04. This is a self-review, not an independent third-party audit.
Scope and source: [Human page family](../design/human-page-family.md).
Supersedes the entry-point/edit omissions of the previous read-only Human batch.

## Delivered ownership

| Surface / behavior                                           | Owner and boundary                                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Members, message avatar, Human mention, Agent creator, graph | `HumanIdentityContext`, existing typed Human route; no implicit self-DM                                                                         |
| Human name/avatar/description                                | Original Principal metadata, projected through `workspace-entities`; no new store                                                               |
| Read profile / creation relations                            | `HumanProfiles`, current actor/workspace authorization, original creator IDs, bounded current Agent catalog                                     |
| Self description / avatar; account name / avatar             | Shared `useHumanProfileMutation`, existing `principal.update` and image upload intents                                                          |
| Multiline editor                                             | Internal `ProfileField`: 3000-character trim/clear, explicit Save/Cancel, Enter newline, Escape/focus return, pending/error with retained draft |
| Role help                                                    | Shared role modal / existing dialog keyboard owner; text reflects local membership semantics                                                    |
| Avatar/card/divider                                          | Internal shared components; duplicate page-local pencil styling removed                                                                         |

Schema 47 adds one nullable `principals.description` column. Old clients omitting
description preserve it. New editors supply `expectedProfile`: stale writes
conflict; an exact repeated final value succeeds. Existing image binding stays
in the same transaction, including rollback on failed updates. This does not
alter scheduling, Agent context, paid CLI invocation or conversation state.

## Official evidence and comparison limits

Published `HumanDetailPanel-p6I0u4UJ.js`, `ut`, SHA-256
`fca1dc1f0c7434d33856c716cb6a133904a8bfb275966a762671aaae15778470`:
source establishes self-edit gates, description limit/clear, avatar upload,
profile sections and created-Agent cards. This is a structural port, not an
official original-source package or proof of Raft Server internals.

Native Firefox read-only observation during this batch: clicked the signed-in
Human row, reached `/human/<id>`, opened description edit, observed placeholder,
Save/Cancel and `0 / 3000`, then Cancel. Official account data was not changed.
The official page also exposes self messaging, email and role permissions.
The current source-level 20px/16px/1px section geometry is checked locally.
This does not certify all official hover/keyboard states or same-fixture pixel
parity; no new official screenshot/computed-style receipt was captured.

## Reproducible local checks

`scripts/ui-human-family-browser-scenarios.mjs` is integrated in the foundation
gate and included in its input hash receipt. It runs only against the isolated
Kernel/fake-provider fixture, never formal state. Cases cover:

- Real keyboard/mouse navigation through all five entrance types, role modal
  Escape, created-Agent round trip, same identity after reload.
- Description save, Enter newline, Escape/Cancel, clear, 3000-character limit.
- A second editor causes a real backend 409; the failed UI keeps its draft.
- Real image upload/intent binding and account rename; sidebar/profile/creator/
  graph/message consumers see the same identity without an app reload.
- Delayed successful save while navigating to Tasks cannot reopen Human detail.
- 1440px desktop and 390×844 layout/editor screenshots in Chrome and Firefox.
- Existing Human read gate checks unavailable identity, retry, mobile return,
  role/join-date/creation cards and authorization boundaries.

### Final receipts

- `npm run check`: 876 package tests passed, 2 explicit opt-in skips;
  309 web tests and 34 interaction regression tests passed. Typecheck and
  library/registry checks also passed.
- `npm run format:check`, `git diff --check`, trusted workbench build passed.
  The existing large-chunk build warning remains; it is not a new measured
  performance regression or a load-test result.
- Foundation gate: 14/14 engine/scenario results passed (Chrome 152.0.7977.77,
  Playwright Firefox 150.0.2). Receipt and screenshots:
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-h08GtF`.
  Every recorded production/test input hash and the catalog hash were rechecked
  against the final tree: no drift. Human mutation checks are part of the
  integrated scenario, not counted as 14 separate Human tests.
- Screenshot review caught and corrected the editor's incorrect button color
  class and the new preview's missing frame. The reusable frame is now owned by
  `preview.css`; Agent/graph duplicate frame rules were removed. Color, border,
  background, z-index and uploaded-image decoding are now browser assertions.
  A compact graph shadow is retained as an explicit existing variant.
- Formal restart at 22:30 China time: exact previous PID/cwd/listener/database,
  idle work, backup inventory and canonical counts were checked by the guarded
  restart flow. Verified backup:
  `/Users/sun/.rah/backups/pre-restart-9d18cde9-428c-47aa-9df5-6450d1c1c41e`.
  Successor PID at verification: 96035, serving `127.0.0.1:4173` and frozen build
  `e1abf276bc20b9524ed631ad31e26aa6b1074f901e6b39c160401787fc0efd16`.
- Formal database migrated 46 → 47. Before/after counts are unchanged:
  Principals 6, Rooms 6, messages 43, Tasks 2, execution policies 4,
  Agent definitions 4, definition revisions 34. Active-work guard remains idle.
- Formal read-only Chrome/Firefox desktop and 390×844 checks passed; screenshots
  were inspected. Receipt:
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-human-family-formal-OS5YKv`.
  No formal profile edits/messages or paid-provider acceptance calls were made.

No commit or push was performed in this batch; the existing in-progress tree
was preserved. Older audit receipts are historical, not proof of these inputs.

## Explicitly open or intentionally different

- Workspace-wide Human membership management/invites/global removal are not
  implemented by removing only control-Room membership. That would leave
  other Channel permissions behind; it needs a separately scoped canonical
  contract. The sidebar still lists the signed-in Human, not a full directory.
- No central email/account billing, inferred hardware ownership or self-DM.
- Human hover reads share the same data/overlay owner; exact official hover
  layout and all cross-page states are not certified by this batch.
- Agent/Computer remaining body sections, settings forms, and other empty-state
  families remain subsequent **whole-family** work, not claimed finished here.
