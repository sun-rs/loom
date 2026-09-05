# Contextual empty states and entity cards — scoped delivery

## Scope and ownership

This is the second slice of the [entity network plan](../design/ui-entity-network-closure.md),
not completion of every profile or a replacement business system. The maintained
Neo-Brutalist library owns two additional primitives: `EntityCard` and
`EmptyState`. UI006/UI007 link their source, owners and executable scenarios in
the existing machine registry. No external `raft-ui` runtime dependency was added.

- Computer and created-Agent rows use one `AgentEntityCard` composition. It
  receives an authorized Agent projection, uses the existing avatar library,
  shows runtime as a subtitle and uses the existing presence projector for a
  single trailing status. CLI availability is no longer displayed as online
  status. Cards navigate by Agent definition ID, not display name.
- The `surface` avatar context is 32px with a 2px border (28px interior), distinct
  from the smaller existing member-row context. No new avatar artwork is generated.
- Search home fills the remaining stage and uses the official 48px / 14px / 12px
  icon/title/description hierarchy. Search history suggestions replace the initial
  empty state; clearing history restores it.
- Agent Activity retains its diagnostic toolbar. Its empty content fills the
  remaining body, with 36px icon, 18px title and source-backed description.
  Loading and read failures do not claim a successful empty result. Populated
  activity still uses the existing canonical projection and pagination callbacks.
- The former Computer/created-Agent row rules, mobile row wrapping overrides,
  intrinsic Search home wrapper and Activity fixed-min-height override were removed.
  Unmigrated empty-state families deliberately keep their existing owner.

No daemon, Kernel, ACL, provider, scheduling or persistence behavior changed.
No paid provider, user conversation, membership or CLI configuration was used as
test material. Browser fixtures use isolated canonical state and fake providers.

## Source and review limits

[Fresh source/native-browser observations](../evidence/raft-ui-body-20260904.json)
record release `16856201b6d089c251967fe2afdb2b0a0dcbb1a0`, exact bundle hashes and
`hre/X$e`, `On`, `pg/Vo` contracts. Offline adoption checks use matching structural
landmarks in the already-frozen 2026-08-31 official bundle. This is a structural
port with local binding, not a byte-identical original React component import.

Official Firefox: opened Search and observed its initial empty layout; inspected
Computer cards and clicked ParityAuditorA to verify exact Agent profile navigation;
opened Activity. That Agent has existing history, so an official empty Activity
was **not** reproduced. The source includes a caller-owned diagnostic toolbar
outside the empty component; it is retained locally. This is not a newly automated
same-viewport bilateral computed-style pass or an independent third-party audit.

## TDD and regression findings

The initial ownership tests failed because the shared owners did not exist. A
Chrome test then failed on the actual old Search position. Source review identified
the surface-avatar/member-avatar mismatch; the browser assertion first observed
28px/1px and failed, then passed after selecting the explicit 32px/2px context.

The matrix exercises native click/Enter, disabled/no-navigation cards, rest/hover/
focus borders, long names, one status marker, responsive status labels, empty/
loading/permission-error bodies, and 390/639/640/700/701/767/768/1440 widths.
Production Computer card navigation and Search query/history/clear use real app
callbacks. A scenario-order timing failure was removed by establishing the
no-history precondition through the actual clear-history action in the disposable
browser context, not by weakening the empty-state assertion.

Existing tests were redirected to the new avatar/card owner while preserving ID
navigation assertions. The legacy-registry deletion test now deletes B001 by ID,
not whichever newly-added UI record happens to occupy array index zero.

## Final verification

- `npm run check`: passed. Packages 872 passed / 2 skipped; Web 304 passed;
  real callback regression 34 passed. Final log: `/tmp/rah-body-release-check-20260904.log`.
- `npm run format:check`, `git diff --check`, `npm run build:web:workbench`:
  passed. The existing large-chunk build warning remains; no new performance
  claim is made.
- `npm run test:web:foundations`: 14 scenario/engine receipts, all passed in
  Chrome 152.0.7977.77 and Firefox 150.0.2. Source hashes rechecked with zero drift.
  Final receipt: `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-HwbuUI/receipt.json`.
  Intermediate receipts from before the surface-avatar correction are superseded,
  not final release evidence. Desktop/mobile screenshots were visually inspected.
- Historical official-capture replay: 50 foundation + 68 Shell properties matched,
  zero differences (`rah-ui-comparison-3tgHmZ`, `rah-ui-comparison-aHMTL8`). These
  remain old header/Shell capture comparisons, not new body/full-site parity claims.
- Guarded formal restart: existing `/Users/sun/.rah/state`, port 4173, successor
  PID 50198, verified served build
  `9fa4f1adc32981b56b1437670d1f9e6a8982c60525afb2c61ae609abe2b4d736`.
  Verified backup: `/Users/sun/.rah/backups/pre-restart-7f4d7e71-b5af-4eaf-a2b6-356b5579dca3`.
- Post-restart Chrome/Firefox tested actual formal task menus, Computer cards,
  exact profile navigation, Search home/query/history/clear at 1440 and 390 widths.
  Both passed with zero page errors, using disposable browser profiles (no changes
  to the user's saved browser history/preferences). Screenshots inspected at
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-formal-body-ui-PLX1gA`.
- Before/after counts matched: 6 principals, 6 Rooms, 43 Messages, 2 Tasks,
  4 execution policies, 4 Agent definitions and 34 Agent definition revisions.
  Count equality supplements the verified backup; it is not a proof of every
  business invariant. This delivery is self-reviewed, not independently audited.

## Remaining work

Next: Human profile navigation and minimal canonical profile/creator relations.
The sidebar Human is still non-clickable; the existing principal API does not yet
expose all requested description/join/ownership fields. Original creator must not
be confused with a revision editor or inferred from OS user/co-location.

Then: shared profile sections and diagnostic toolbars, remaining empty states,
Computer information/diagnostic layout, settings form dirty states and conditional
hover content. Bulk Agent selection and all official profile variants are outside
this slice. Whole-site parity, full identity-network backend coverage and all
notification delivery paths remain unclaimed. No Git commit/push is included.
