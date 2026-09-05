# Secondary headers and Push read-state review

Date: 2026-09-04. B2 continuation / narrow B3 error-state repair. This is the
primary agent's code, test and screenshot review, not an independent audit.

## Changes and owners

- Saved/Search now consume the internal `PanelHeader`, `PanelHeaderIcon` and
  `PanelHeaderAction`. Search's conditional clear control uses the shared
  24px/12px compact variant, restores input focus, and retains the existing query
  owner. Mobile back is an actual action, not a decorative icon. Esc handling
  still ignores IME composition. The mobile shortcut hint follows the source's
  small-screen visibility rule.
- Deleted obsolete Saved header and Search header/tile geometry rather than
  adding a late overriding theme. The maintained catalog now has six primitives
  and five composition templates. There are 79 behavior records, not 79 freshly
  certified product behaviors.
- Notification settings distinguish loading, unknown/read failure, explicit
  unsupported browser, unavailable local Push configuration, denied permission,
  granted-but-unsubscribed, active subscription and explicit opt-out. Unknown
  device/subscription counts no longer become zero/none. Desktop read failure
  no longer displays iOS-only setup advice.
- Read-only retry uses the existing status API and registration reader. The
  existing `createLatestRequest` fences obsolete reads; actions invalidate old
  reads and prevent focus refresh from racing the write. No new polling loop,
  subscription flow, backend queue, notification event policy or provider path.
- Kernel, typed SDK, Saved pagination/mutations, Search ACL/navigation and Room
  truth remain their existing owners. Browser preference remains the existing
  preference; this does not introduce another persistent business store.

## Provenance

Implementation order and extracted locations are in
[the scoped design](../design/ui-secondary-headers-and-push-status.md).
The authorized frozen shared bundle is `index-BoAC7nSE.js`, SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`;
the Saved bundle is `SavedPanel-BvhJ1TDV.js`, SHA-256
`261c2bd2262c8afe8040486ff2b5dad330badc14c573ee05c2ae522ffbb180cf`.

Shared header `xg` and Search's title-slot/back/clear markup supply the extracted
presentation contract. React composition is RAH adaptation, not byte-exact
official React source. The pure notification presentation is explicitly
`rah-local`, using the existing source-derived `b4/hce/Lit/Dit` registration/read
semantics. Those registration helpers were inspected but not rewritten here.
The external reconstructed `raft-ui` directory is not a dependency or standard.

## TDD and verification scope

Observed failures preceded implementation: absent notification presentation
owner; pending read displayed as disabled; undefined status produced an iOS
hint; missing Saved shared icon; missing Search clear/mobile-back composition;
mobile Esc hint still visible; granted-but-unsubscribed mislabeled undecided.

Browser fault tests run on isolated real browser engines with a controlled
`getSubscription` failure. They assert retained error, unknown counts, usable
retry, recovered state, a late failed read not overwriting a newer success, and
zero subscription mutations. They are not OS notification delivery tests.

The integrated matrix covers Saved/Search at 1440×900, 1440×598 and 390×844,
in addition to the prior Shell, header, Tabs, splitter and interaction-state
matrix. Assertions cover explicit geometry, actual pointer clicks, input focus,
keyboard Escape/IME, no horizontal overflow and mobile return. Screenshots are
reviewed, not inferred from green assertions.

Gate hardening exposed a missing favicon on the test-only page and a Firefox
font cancellation caused by resizing a mobile route and navigating before its
new desktop font finished. The fixture now declares its icon and settles route
state/fonts before navigation. Console/HTTP errors remain failures; no error
filter or weakened geometry expectation was added. One intermediate receipt
was invalidated by the input-hash guard when the test changed during execution;
only a later frozen-input run can be release evidence.

An additional frozen run stalled during Chrome shutdown and was stopped as an
isolated test, not counted as passed. A clean subsequent run completed both
browser shutdowns and all 14 scenarios without changing the production code or
relaxing the checks.

Final gates:

| Gate                                       | Result                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                            | Package tests: 872 passed, 2 skipped; Web: 293 passed; callback regression: 34 passed; type, registry and library gates passed |
| `npm run format:check`, `git diff --check` | Passed                                                                                                                         |
| `npm run build:web:workbench`              | Passed; pre-existing bundle size warning remains                                                                               |
| `npm run test:web:foundations`             | 14/14 Chrome/Firefox scenarios; no source hash drift                                                                           |
| `npm run test:web:browser`                 | Existing isolated desktop/mobile business gate passed                                                                          |
| `npm run test:web:ui-compare`              | Prior official-capture replay: 50 + 68 properties matched, no differences or uncomparable properties                           |

The 118 replay properties are the existing foundation/Shell sample, **not** 118
new Saved/Search behaviors or a new official browser capture. Their scope is
unchanged. Temporary reproducible receipts (not permanent baseline files):

- `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-kyktEe/receipt.json`
- `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-comparison-kvQQNc/report.json`
- `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-comparison-RW0U4b/report.json`

## Formal deployment

The guarded restart verified idle state, backed up and verified persistent data
at `/Users/sun/.rah/backups/pre-restart-b3d85e46-b0b2-4f7b-aa98-8ada660d41a1`,
then gracefully replaced PID 96093 with PID 17456. The formal HTTP build header
matches `7c1e02e29f555ad2083b9a73f9f95ddb5b9c72bd42f525a04ad13ad1bcafe17d`.
The formal user-review URL is `http://127.0.0.1:4173`, not a fixture.

All rows in `rooms` (6), `messages` (40), `agent_definitions` (4) match the
backup exactly. All 35 protected memory/runtime-profile files retain their
hashes. The restart did not execute a paid provider or migrate business state.

Post-restart header/navigation checks passed in installed headless Chrome
152.0.7977.77 and Playwright Firefox 150.0.2 at the formal URL, including the
secondary-header matrix. Screenshots were inspected. Receipt:
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-secondary-formal-E76BXm/receipt.json`.
Only the disposable acceptance profiles opted out of Push; no existing user's
subscription/preferences were changed. There were no uncaught page errors.

**Important retained failure:** Chrome's status read settled to the explicit
profile opt-out. Firefox's real subscription read returned
`Error retrieving push subscription.`; the page displayed `无法检查`, unknown
counts and an enabled retry, without the false iOS advice. That confirms honest
failure presentation, **not** a successful Firefox subscription or OS delivery.
The underlying browser/service read issue and actual notification banners/clicks
still need their separate investigation and device acceptance. The locked Mac
also prevented a foreground browser demonstration in this turn.

## Limits and next order

1. Remaining B2 composition/splitter policies and mobile Agent header scope are
   not all newly paired against official evidence.
2. B3 general buttons, overlays/focus (including the previously recorded preview
   Escape intermittency), forms, empty/error states and toolbars still require
   family-by-family migration and removal of old page rules.
3. Then migrate page bodies and audit their existing typed SDK/canonical owner
   bindings. This batch neither finds nor certifies closure of all backend gaps.
4. Official live browsing was blocked by the locked Mac this turn. Frozen-source
   review and replay of earlier official captures are not a new bilateral crawl.
   Expand same-precondition official state/mouse captures when accessible.
5. Notification read recovery does not prove Chrome/Firefox macOS banners,
   notification-click navigation or iOS PWA delivery. Those device-level gates
   remain separate; a browser subscription read error is still shown honestly.

Do not call this full Raft parity, all-page migration, or complete notification
acceptance. No paid provider, commit or push was used for this batch.
