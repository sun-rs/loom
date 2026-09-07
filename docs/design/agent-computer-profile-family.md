# Agent / Computer / identity preview family

Status: bounded implementation verified; see the [release audit](../audits/2026-09-05-agent-computer-profile-family.md).
Continues the existing entity-network plan;
not another theme, store or behavior registry.

## Scope and source

Addresses the screenshot's Computer section geometry/diagnostic density, profile
runtime inconsistency, and conditional identity-preview content. Retain already
verified cards, status dots, Human navigation and task identity menus as regressions.
Agent and Computer editors, created-Agent cards, metadata, action sections and
preview lifetime must be accepted as one production page family.

Reviewed published sources on 2026-09-04 (download hashes match the existing
`raft-ui-body-20260904.json`): `MachineDetailPanel-DuFZ_vgC.js`,
`AgentDetailPanel-BayGfy6W.js`, `index-Biin3FEA.js`.
Machine uses natural-height px-5/py-4 fields, 1px black/10 dividers, a px-5/py-5
hero, metadata separated from diagnostics. Agent uses the same section geometry.
`XO/ent/ant/rnt` gates recent trajectory by management/creator permission, omits
an empty recent region, separates metadata by a muted line, and shows reasoning
only for supporting runtimes. Adopt structure, not Raft's unavailable Server code.

## Single owners

- Existing authorized entity directory owns identity/runtime joins; profile and
  preview share runtime/model/reasoning presentation. Ambiguous bindings never
  use array order. Existing Kernel trajectory ACL remains authoritative.
- Internal `ProfileSection` owns metadata/field divider and spacing variants.
  Existing editor commands keep revision, idempotency and draft ownership.
- Existing PreviewCard owns placement/hover/focus/Escape; profile.css/preview.css
  own maintained presentation. Remove replaced app CSS; do not add overrides.
- Computer host ID, offer count, paths and last observation are local diagnostics,
  not substitutes for unknown creation or Human ownership facts.

## Exit gates

TDD covers ambiguous runtime bindings, field visibility, scoped preview reads,
empty/error distinctions and dismissal before delayed hover opens. Browser tests
use actual profile consumers and isolated canonical fake-provider state in Chrome
and Firefox at desktop/390x844: cards, editors, long labels, disabled actions,
runtime-chip interaction, previews, navigation and reload. No paid providers.
Run complete checks/build, inspect screenshots, then guarded formal restart and
read-only acceptance. Record official source, capture replay, local browser and
formal acceptance separately; missing official states are not passed.

Notification subscription investigation is a separate track; a settings badge or
successful push transport does not certify macOS banners or iOS delivery.

## Implemented ownership changes

`runtimeProfilePresentation` is a pure view of the scoped directory plus canonical
execution policy. Metadata refresh follows Agent revision, not array order or a
presence tick. `AgentComputerIdentity` resolves the current local binding before
opening the Computer surface; no name-based join or remote host route is added.
Computer field/save handlers retain expected revision and idempotency. Agent
profile edits retain canonical room barriers and expected Agent revision.

ProfileSection now provides divided/undivided field variants and a title action
slot. Agent/Computer profile rules and Agent preview rules move out of page styles
into the existing internal profile.css/preview.css. Redundant preview dot colors
are removed; StatusDot remains authoritative. PreviewCard has explicit closed,
pending and open phases, so Escape cancels a pending reveal without introducing a
new popup system. Recent trajectory is fetched only for managers/the creator;
empty recent sections are omitted, while read errors remain distinguishable.
The shared AgentAvatar has an explicit 48px preview variant; it does not inherit
or override the full-profile 64px variant through page specificity.
An open preview refreshes its bounded tail when presence.trajectoryVersion
changes (activityAt fallback for older daemons), retaining the old rows during the
read and rejecting aborted/old-scope responses. The hint reads the existing per-Agent
trajectory tail server_sequence, including non-status records; it does not change
activityAt, activity mapping, delivery acknowledgements or Task state. This reuses presence reconciliation, not another polling timer.
Unknown/failed profile reads never claim that a creator is absent; only an
explicit null creator does. Both directory profiles and previews resolve Runtime
bindings through the scoped entity directory, including principal identity checks.

The browser matrix is registered as UI009 with preview-lifetime,
preview-content, profile-read-state and profile-family scenarios. Failed receipts remain evidence of
development, never completion. A fixture-only virtual clock uses a separate page
so its instrumentation cannot enter production sandboxed file previews.

## Deliberately not closed by this family

- Complete upstream activity filtering and every provider capability variant
  remain unclosed. The separate open-preview invalidation gap is repaired in
  [the trajectory refresh audit](../audits/2026-09-07-agent-preview-trajectory-refresh.zh-CN.md).
- Computer bulk select/create/workspace-scan administration and complete
  start/stop action parity. Existing safe local action owners are unchanged.
- Human-to-Computer ownership metadata: host presence is not proof of ownership.
- Settings body/form states, remaining discovery/message empty compositions,
  full Human directory/ACL matrix, physical macOS/iOS notification delivery.
