# Raft UI audit

Last reviewed: 2026-08-26. Source build: `666bab60d8658d9e382e2c286ce1e423231e8f31`.

## Review result

The reference is a protocol-driven interactive fixture, not a static screenshot.
All declared release gates pass in Chromium and Firefox. The review does not
claim that every Raft route or state is already a 1:1 source-backed reproduction;
`coverage-matrix.json` is the authoritative boundary for that claim.

## Defects fixed in this review

- Invalid adapter results now fail closed and cannot leave a transaction pending.
- Keyed requests abort stale adapter work and late results cannot overwrite the
  current Chat, Search, Task, Member, Computer or mobile projection.
- Native and non-native transaction controls have one ownership/restore protocol;
  overlapping unrelated work is rejected.
- Canonical intent vetoes no longer leak legacy events; invalid legacy metadata
  cannot leave a dangling canonical intent.
- Resizer cancellation restores its origin and rejected commits restore width.
- Late Agent profile failure restores data without navigating away from the
  member the user selected meanwhile.
- Activity completion uses a post-unlock commit so the action remains permanently
  disabled with either the fixture adapter or a real asynchronous adapter.
- Settings and Billing segmented controls share one keyboard/ARIA primitive;
  Admin now follows the official select/listbox model with shared search, arrow,
  Home/End, Escape, outside-close and focus-return behavior.
- Multi-field forms lock all transaction-owned inputs while a save is pending.
- Admin is tied to the current official `SettingsPanel-*.js`, live DOM/computed
  style and focused member/role menu captures. Its 0.5px per-section drift,
  disabled/dirty states, normal-flow agreement expansion, 160/5000 limits,
  inline failures and submitting/saved states are now browser-gated.
- Fixture success has moved out of the transport-neutral runtime into an explicit
  reference adapter. Adapter absence fails closed, RAH adapters are rejected on
  reference surfaces, and temporary test adapters restore the previous owner.
- All reference pages are backend/network-free. The official CSS bundle remains
  hash-audited while its generated offline mirror rewrites only remote font
  loading to the already hashed local files.
- The RAH integration is injected, capability-gated and endpoint-free; all 74 UI
  intents have a current backend-readiness/owner entry.

## Verified gates

- Published artifact hash and generated-source audit.
- Source-backed geometry/computed style calibration and focused overlays.
- Shared shell, Search, notifications, Activity, Tasks, Members, Computers and
  source-backed Admin default/menu/expanded/validation/transaction states.
- Source-backed 390x844 Web/PWA header, tabs, notification, composer and
  `visualViewport` keyboard accommodation in Chromium and Firefox; native iOS
  screenshots are explicitly kept as information-architecture/state evidence.
- Protocol, control ownership, accessibility semantics and coverage declarations.
- Reference/integration dependency direction, no-network rendering, capability
  gating and injected FakeRahClient command mapping.
- Visual state cases for hover, focus, press and scrolling.

## Open, explicitly non-verified scope

- `rah_os` daemon transport, authorization and canonical store adapters.
- Loading, streaming, several disabled/error states, Task CRUD/drag and non-profile
  Agent tabs without captured official samples.
- Billing and native-only mobile states that still rely on screenshot evidence;
  Admin no longer belongs to that category. Admin's remaining gap is the missing
  `rah_os` administration adapter and uncaptured server-specific destructive/error variants.
- The standalone `mobile.html` remains an early reference surface.
