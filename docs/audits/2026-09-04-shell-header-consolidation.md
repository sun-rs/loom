# Shell header consolidation — verification and limits

Date: 2026-09-04. Continuation of ADR 0028 / batch B2. This is a primary-agent
code and evidence review, not an independent third-party audit.

## Decision and implementation

Keep the internal RAH Neo-Brutalist UI library as the maintained source. No
external `raft-ui` checkout, reference state machine, new theme or business
protocol is introduced. The typed SDK and canonical owners are unchanged.

- Room navigation, Settings, Computer, member navigation and global Tasks/Activity
  consume `PanelHeader`. Standard 62px and short-height 48px tracks have one
  library owner; the 50px compact rail configuration moved alongside them.
- `PanelHeaderIcon` owns the non-interactive 36px tile and its explicit 14/18px
  glyph slots. It is not an Agent avatar generator.
- Mobile header/back controls use `PanelHeaderAction`. The false arrow-left to
  chevron alias and page rotations were removed; the official arrow geometry
  was added to the internal sprite. Prior sprite bytes remain hash-checked.
- Removed obsolete fixed heights, tile sizes, typography and back-button rules
  from five page/style files (219 lines removed, 5 lines added there). This is
  consolidation into existing owners, not another late override layer.
- Catalog now contains six primitives and four executable composition templates.
  The behavior registry retains 78 records, not a fabricated completion rate.

## Source and adoption classification

Official live navigation/DOM/computed-style observations covered Channel,
Settings notifications and Computer headers. The content-free reproducible
capture for paired Channel/Settings properties is
`docs/evidence/raft-ui-shell-20260904.json`, SHA-256
`a3285983d8a3a812672260b5b84762e68e559755a4faec2ee1a6bd4eaf67fa3e`.
Its source is `https://app.raft.build/assets/index-Biin3FEA.js`, independently
verified SHA-256
`e798f35bde09eeda2927669406e10718392ff7574796016441def59dbc5b05f9`.

`h-panel-header` / `size-icon-header` dimensions and title typography are
**extracted presentation contracts**; the React wrappers and route bindings are
**RAH local adaptation**. The arrow path data is **verbatim official geometry**,
not a claim that the whole sprite/component is official source. Existing
reference-reconstruction provenance remains recorded in `adoption.json`.

No account, official conversation or provider state was changed during capture.
Mobile hidden icons were excluded from paired comparisons, rather than counted
as successful visible controls.

## TDD and final checks

Observed red cases before implementation included missing shared header/tile
consumers, Settings staying 62px on a 598px-high screen, the false back glyph,
unsupported comparison route acceptance and compact track ownership remaining
in page CSS. Logs are `/tmp/rah-shell-{owner,browser,glyph,comparison,tracks}-red.log`
(the measurable Settings-height failure is `rah-shell-browser-red2.log`).

Final checks:

| Gate                                       | Result                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                            | Package tests 872 passed / 2 skipped; Web 290 passed; callback regression 34 passed; type/registry/library checks passed |
| `npm run format:check`, `git diff --check` | Passed                                                                                                                   |
| `npm run build:web:workbench`              | Passed; existing large-chunk warning remains                                                                             |
| `npm run test:web:foundations`             | 12/12 Chrome/Firefox scenarios passed                                                                                    |
| `npm run test:web:ui-compare`              | Existing 50 plus new 68 properties matched; zero differences/uncomparable values                                         |
| `npm run test:web:browser`                 | Existing isolated canonical business flow passed, including desktop and 390×844                                          |

All provider execution in automated gates used isolated fake providers. No paid
model was used. Foundation tests cover pointer/keyboard/disabled/pending,
long-name/capability combinations, the existing 11-viewport Room/inspector
matrix, plus six production surface families at desktop/short-height and mobile
Settings back/index/reload. The new family is included in the integrated-shell
scenario, not counted as additional independent scenario IDs.

Early browser attempts sampled a transient detached initial route tree. The
final gate waits for route network-idle and font readiness before measurements,
and records missing geometry explicitly. A successful test must not infer its
expected dimensions from current rendered dimensions.

Final temporary receipts (not permanent or whole-site certification):

- `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-BwYuE9/receipt.json`
- `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-comparison-FwGEoX/report.json`
- `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-comparison-laRN4z/report.json`

Chrome Settings short-height, Firefox Computer short-height and mobile Settings
screenshots were inspected. Cross-implementation results are **official capture
replay**, not a fresh automated login/crawl or whole-page pixel match. The 118
measurements are properties, not 118 functions. Full mouse-state parity remains
unproven.

## Formal release

The guard verified an idle formal instance, made and verified the private backup
`/Users/sun/.rah/backups/pre-restart-dcbe1486-aafe-4a82-94ea-f0d3c5d21b91`,
then gracefully replaced PID 84406 with 96093. The live HTTP build header matches
`cb54e9f5e6751619513b5013c6ba38cebd8d38f9dbaa069e0374d37a8ebc09a4`.
The formal URL remains `http://127.0.0.1:4173`.

All rows of `rooms` (6), `messages` (40) and `agent_definitions` (4) match the
backup exactly; 35 memory/runtime-profile files match their pre-restart hashes.
Formal read/navigation header checks passed in installed headless Chrome
152.0.7977.77 and Playwright Firefox 150.0.2, with no uncaught page errors.
Receipt and reviewed screenshots:
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-shell-formal-9j3680/`.
The Mac was locked during the last visible-browser attempt, so this does not
claim a final foreground browser demonstration. No commit or push was made.

## Review findings and remaining order

1. Finish B2 specialized Saved/Search headers and the remaining page-specific
   splitter policy integration. Mobile Agent header retains its earlier 76px
   composition; it is locally tested, not newly certified against Raft.
2. B3: general button families, overlays/focus, forms, empty/error states and
   toolbars. Delete corresponding obsolete rules with each migration. Then
   progressively migrate page bodies, retaining existing SDK commands.
3. Expand same-precondition official mouse/state capture. Current sampled
   title contracts do not prove menus, permission errors, drag bounds or all
   backend features are closed.
4. Screenshot review found a pre-existing notification error-state defect:
   fresh headless Firefox may return `Error retrieving push subscription` after
   reload, leaving `status` undefined; `!status?.supported` then incorrectly
   displays iOS-only guidance on desktop. Owner:
   `apps/web/src/components/web-push-settings.tsx`. The header-only acceptance
   does not assert subscription success, OS delivery, or absence of rendered
   application alerts. Keep this issue open for error-state TDD; do not hide the
   real browser subscription failure or count this run as notification acceptance.

Conclusion: this bounded header-family migration passes its stated gates and
is deployed. It does not certify all frontends, notifications, backend parity,
or complete Raft UI/mouse equivalence.
