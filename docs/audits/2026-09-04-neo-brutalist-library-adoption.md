# RAH Neo-Brutalist UI adoption — verification and limits

Date: 2026-09-04. Scope: internal source ownership and dependency consolidation,
not a redesign or whole-site Raft parity certification.

## Delivered

- English standard: `docs/design/neo-brutalist-ui.md`; policy: ADR 0028.
- Existing `ui-tokens` now owns maintained source, with 18 adopted inputs and
  separate provenance. Immutable fonts/sprites/avatar data retain original hashes.
- Removed the external-checkout importer and snapshot-to-product generator.
  Historical snapshot bytes remain intact. The sibling checkout was not changed.
- Five existing primitives moved to `ui-web/src/neo-brutalist`, without app-local
  compatibility copies: Icon, PanelHeader, PanelHeaderAction, PanelTabs, PanelResizer.
- Three production composition templates are cataloged with executable examples,
  existing behavior IDs and browser scenarios. They do not embed reference state.
- One library CSS entry replaces nine independently assembled resource imports
  and three app-local shared stylesheets. The duplicate overlay CSS import is gone.
- Browser receipts now hash the library's source/assets and catalog as well as
  app source. Moving a component outside the app does not hide subsequent drift.
- No Kernel/schema, Provider, memory-policy, routing or business-state rewrite.

## TDD and audit findings

The first three tests failed before migration: no maintained-source export,
external importer still present, and nine resource imports instead of one entry.
They now pass. An additional recursive CSS closure test caught the activity CSS
still importing `generated/` after relocation; the path was repaired without
changing declarations. The full suite also caught one stale test-source path;
it was updated to the new owner without changing behavioral expectations.

Negative contract tests reject unsafe paths, duplicate IDs, unknown behavior or
template-component links, undocumented adopted CSS changes and modified immutable
assets. Maintained CSS with an explicit change record is allowed to evolve while
its origin hash stays fixed. This is provenance validation, not semantic proof.

## Checks

| Gate                                       | Result                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `npm run check`                            | 867 package tests: 865 pass, 2 existing opt-in skips; 282 Web tests pass; 34 regression tests pass |
| `npm run test:web:foundations`             | 12/12 across Chrome 152.0.7977.77 and Firefox 150.0.2                                              |
| `npm run test:web:browser`                 | Full isolated business flow passed                                                                 |
| `npm run test:web:firefox`                 | Persistent isolated desktop and 390×844 flow passed                                                |
| `npm run build:web:workbench`              | Passed; existing >500 kB chunk warning remains                                                     |
| `npm run format:check`, `git diff --check` | Passed                                                                                             |

Final foundation evidence:
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-EC9WUf/receipt.json`.
Initial identical-layout screenshots were inspected for button states, 1440×598
alignment and 390×844 inspector layout. The matrix includes long names, empty/
disabled data, keyboard Tabs, pointer capture, bounds and breakpoint combinations.
No new official bilateral comparison was performed.

## Formal release

Formal `http://127.0.0.1:4173` was restarted against frozen build
`bd713e7d549abdc41c8fa4c5ff17f2ee88777f4c300983dd6b987d6c7f7e23f4`.
Fresh Chrome/Firefox pages verified the build ID, Room and Agent header alignment,
inspector close hit target, Home/End tab selection, Files callback and reload at
1440×1000, 1440×598, 1024×598 and 390×844. Both reported zero page/console errors.
Formal desktop/mobile screenshots were inspected.

Formal receipt and screenshots:
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-library-formal-XL1viE`.
These are private temporary evidence, not a public fixture or committed data.

Release-operation issue: the first SQLite backup was created, but its read-only
integrity check failed to open the WAL-format backup. The shell sequence did not
stop the subsequent termination command. This was an orchestration mistake, not
an application defect. Writable integrity checking confirmed that backup was
valid. A complete backup was then rebuilt and verified; a second restart put all
backup/active-work/PID checks in one fail-closed Node sequence before termination.
Future manual releases must not place stop after an unchecked shell command.

Final private backup:
`/Users/sun/.rah/backups/pre-ui-library-20260904-vnko4V`.
Both database quick/foreign-key checks passed. Before restart all 30 Activations
were completed, 30 RunAttempts exited and 30 processes terminated. After browser
verification, full rows of 6 Rooms, 40 Messages and 4 AgentDefinitions matched the
backup. Five MEMORY/notes files and five configuration/credential files were
byte-identical; no values were printed. No production message, task or paid
Provider request was made. No commit or push was requested/performed in this batch.

## Remaining work

The library is the single maintenance and comparison entry, but not all legacy
rules have been consolidated. Base fallback tokens/extracted aliases and page
CSS remain. Settings/Computer, general buttons/forms/overlays/empty states and
toolbars require subsequent family migrations with removal of duplicate rules.
The previously recorded preview Escape intermittency was not reproduced by this
successful run and is not declared fixed. Automated official bilateral diff and
full behavior coverage remain open. Internal consistency does not prove Raft
parity, and a reconstructed reference cannot certify itself.
