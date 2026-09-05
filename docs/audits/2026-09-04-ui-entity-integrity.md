# UI identity projection and integrity — first delivery

## Scope and ownership

This is the first slice of `docs/design/ui-entity-network-closure.md`, not a
complete Human/Computer ownership API or whole-site Raft parity certificate.
No backend mutation, runtime scheduling, provider configuration, membership or
ACL owner changed. No new persistent store, dependency or graph database was added.

`workspace-entities.ts` joins current actor/workspace-scoped canonical projections
at the App boundary. Task candidate sets still come from their authorized queries.
Computer rows and hover summaries no longer independently choose last/first
runtime bindings. Unknown or multiple bindings remain explicit. A revision editor
is not used as the original creator, and local co-location does not prove ownership.

## Delivered

- CSS name-integrity gate: 21 previously unresolved file/name pairs fixed.
  Existing token names are reused; black-opacity 20/30/60 complete the existing
  scale. The guard is not a replacement for cascade/computed-value inspection.
- Standalone status-dot primitive moved into the owned Neo-Brutalist library;
  parent-dependent shape and duplicated preview-event styling removed.
- Both task toolbars consume shared person-option projection: sentinel text and
  reserved alignment slot, actual avatar/displayName, handle search and stable ID
  selection. The existing common popup owns its 2px border / 4px focus shadow.
- Agent fallback avatars use the same Agent renderer as Computer/sidebar avatars,
  including when no explicit avatar key was saved. Human initials stay Human-only.
- The hover identity shows one status indicator and resolves Computer/runtime/model
  through the shared directory. Live activity and permission-conditional regions
  are explicitly not completed by this change.

## Failure-first evidence

The new tests first failed for the missing CSS checker, then for the 21 actual
unresolved references. The real Chrome component test reproduced a 0px radius
instead of 50%. Later integration testing reproduced the incorrect focus shadow.
Visual inspection caught Agent rows incorrectly falling back to Human initials;
an explicit browser assertion was added, failed, then the shared renderer was used.
Directory tests also caught a cleared avatar being resurrected by an older search
candidate, and a missing model descriptor incorrectly erasing a unique runtime
binding. Both were corrected with regression cases.

Tests cover removal/rename, scope absence, contradictory entity kinds, typed-ID
separation, ambiguous bindings and no guessed ownership/creator edges. Browser
coverage uses isolated fake-provider state at 1440×900 and 390×844, three global
task menus, rest/hover Computer cards and standalone dot sizes/states, in addition
to existing foundation scenarios. No paid provider was invoked for this validation.

## Source and limitations

Structural reference: the preceding 2026-09-04 official code/browser inspection
of `index-Biin3FEA.js` / `index-DuTUw-4P.css`, `fp` and `n7/BJe/Vu`.
These are extracted behavior contracts, not original React source imports.
This delivery does not claim a fresh exhaustive official-side browser pass.
Self-review is reported as self-review, not an independent third-party audit.

Remaining order: shared entity-card/profile/empty-state body templates; Human
profile navigation and canonical metadata; conditional/live hover details;
Computer diagnostic information layout; settings dirty-state/layout migration;
broader source-linked integration comparison. Full page alignment remains open.

## Final verification

- `npm run check`: passed. Packages 872 passed / 2 skipped; Web 302 passed;
  actual callback regression 34 passed. The latter now follows the migrated
  status-dot owner rather than expecting a function in its compatibility export.
- `npm run format:check`, `git diff --check`, `npm run build:web:workbench`:
  passed. The existing large-chunk build warning remains; no bundle performance
  improvement is claimed.
- `npm run test:web:foundations`: 14 scenario/engine receipts passed, Chrome
  152.0.7977.77 and Firefox 150.0.2. Current source hashes were rechecked with zero
  drift. Receipt: `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-2a9pUA/receipt.json`.
- `npm run test:web:ui-compare`: foundation 50 + Shell 68 properties matched,
  zero differences. These remain limited historical official-capture replays,
  not 118 newly verified whole-site behaviors.
- Formal guarded restart completed: successor PID 39140, port 4173, existing
  `/Users/sun/.rah/state`, build
  `534426094f238ced5718957c6e597546db118a91dafae9a81b98bef56cf8853b`.
  Verified backup: `/Users/sun/.rah/backups/pre-restart-bd45d19f-979a-4515-988d-6291c1967a71`.
- Post-restart Chrome/Firefox ran the three menus and Computer card checks on
  the actual formal build at desktop/mobile widths, without sending messages or
  invoking providers. Screenshots were inspected, including identical Agent
  fallback artwork across menus and Computer rows. Output:
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-formal-entity-ui-bwXCvF`.
  A Chrome hover check confirmed `Mac-Studio`, the bound OpenCode runtime, and
  exactly one identity status indicator. Full hover activity parity is still open.
- Before/after canonical counts matched: 6 principals, 6 Rooms, 43 Messages,
  2 Tasks, 4 execution policies, 4 Agent definitions and 34 Agent revisions.

Intermediate runs whose source changed were rejected and rerun; they are not
release evidence. No Git commit or push was performed in this delivery.
