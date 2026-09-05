# UI evidence runner and safe local release — reviewed results

Date: 2026-09-04. This is the implementing agent's review, not an independent
third-party certification. Scope: the next small batch after internal adoption.

## Milestone and ownership

Milestone commit: `5b3f48f` (`refactor(ui): adopt owned Neo-Brutalist library and
foundation contracts`). It is local; no push was performed. Subsequent changes
in this report are not included in that milestone.

The product continues to consume its own Neo-Brutalist library, typed SDK and
canonical owners. No external `raft-ui` dependency, new theme, database schema,
runtime scheduling algorithm or Agent prompt was introduced. The comparison
runner uses actual production composition with the existing isolated fixture,
not a cloned reference application. The restart tool is RAH operational glue
over existing asset validation, SQLite online backup and launcher/signal drain.

## Source and comparison

The authenticated official channel page was inspected in the browser. Its loaded
script was `https://app.raft.build/assets/index-Biin3FEA.js`; a read of those
public bytes confirmed SHA-256
`e798f35bde09eeda2927669406e10718392ff7574796016441def59dbc5b05f9`.
Content-free measurements are frozen in
`docs/evidence/raft-ui-foundations-20260904.json`; the plan pins their digest.

`npm run test:web:ui-compare` produces JSON, Markdown and screenshots. It checks
the current library/source hashes, component-to-behavior binding, unique samples,
viewport/DPR, loaded fonts and enabled Tab order before comparing observations.
Missing or mismatched prerequisites are **uncomparable**, not passed. Differences
are printed in CI; the command returns nonzero for differences, missing evidence
or runtime errors. The CI workflow includes this gate, but CI itself was not run
remotely because this work was not pushed.

This command is **official-capture replay**, not a new authenticated official
scan every time. Official capture refresh remains operator-assisted. The paired
data-independent properties do not establish identical conversation fixtures,
font fallback rasterization or whole-page pixel identity.

Initial result: 41 matched / 9 different properties (including repeated viewport
findings). Final result: 50 matched / 0 different / 0 uncomparable across four
scenarios and four components. These are measurement counts, not feature counts
or a whole-site completion percentage.

Final generated evidence:
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-comparison-jKTrXZ`.

## Corrections driven by evidence

- Raft's frozen TabList defaults `activateOnFocus=false`. Actual End/Home input
  confirmed that selection stays on Chat while focus moves. RAH previously
  selected Files immediately. Shared Tabs now separate focus from controlled
  selection; Enter/Space activate. Disabled skipping, wrapping, scroll containment
  and one focus stop remain tested for Room and Agent compositions.
- Header action text color/font size now use black/12px; action SVG root declares
  the measured stroke width. Rest transform is `none`, retaining the existing
  hover/pressed states. SVG-root inheritance is not proof that the former sprite
  actually drew a one-pixel stroke; the report distinguishes the observed DOM
  property from a visual rasterization claim.
- Two catalog entries pointed to the inspector-resize behavior instead of the
  header-action behavior. Their links were corrected; a negative test now detects
  this kind of misbinding.
- A capture attempted while fonts were loading was correctly rejected. The
  runner now waits for fonts after state transitions as well as initial load.

The browser reproducer failed before the Tabs change. The initial comparison
failed before the leaf fixes. New negative tests failed before implementation
for missing observations, differing prerequisites and incorrect behavior links.
Old reports of automatic Home/End selection are historical evidence, superseded
by this narrower live observation and correction.

## Release protection and audit

The guarded operator command requires exact PID, process start identity, checkout,
listener and database ownership. It validates the expected frozen build, checks
active execution owners, creates an exclusive private backup, verifies SQLite
integrity/foreign keys and file digests, and rechecks before SIGTERM. Every step
must produce a positive receipt. Errors and explicit false receipts stop the
sequence; no force-kill or restore-over-live-data path exists.

Tests cover every pre-stop failure, stop failure, real committed WAL backup,
symlink refusal, corrupt SQLite, damaged backup files, recursive backup refusal,
unknown schema and active execution owners. Review found that copying all files
as 0600 would lose owner-execute permission on recovery helpers; a failing test
was added and fixed. File hashing streams bytes rather than loading large files
into memory. These are local safety tests, not power-loss or high-load benchmarks.

An intentionally invalid candidate build was submitted against the formal PID.
The guard rejected it before stop; the original PID/start time and health were
unchanged. The later valid command completed backup and graceful replacement.

This is **not an atomic maintenance lock**, zero-downtime deployer or automatic
rollback coordinator. Avoid concurrent user mutations during release. A
last-moment arrival still belongs to the existing daemon drain/fencing owner.
The installed macOS/K upgrade path is unchanged. Startup failure after stop
requires operator recovery with the retained known-good build, not data restore.

## Gates and formal verification

- `npm run check`: 874 package tests, 872 pass and two existing opt-in skips;
  287 Web tests and 34 regression tests passed. A final comparison-prerequisite
  test was then added; the final Web suite passed all 288 tests.
- Restart guard tests: seven pass. Comparison classifier/plan tests: six pass.
- Chrome/Firefox foundation/integrated matrix: 12/12 pass. Full isolated Chrome
  business-flow gate passed. These tests used fake providers, not paid models.
- Formal build, type checks, formatting and diff checks passed. The pre-existing
  large-chunk build warning remains.

Foundation receipt:
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-aHgpOe`.

Formal URL: `http://127.0.0.1:4173`. New frozen Web build:
`1fb700228815fdfd2fec7ab4d329eba7933b96c21fd90d0a9f8dfbbb693e0dc1`.
Chrome 152.0.7977.77 and Firefox 150.0.2 verified fresh pages at 1440×900,
1440×598, 1024×598 and 390×844: build identity, Room/inspector header alignment,
close-button pointer hit, focus-only End/Home, Enter activation, Files callback
and reload. No page/console errors were recorded; screenshots were inspected.

Formal receipt/screenshots:
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-release-formal-kDNApL`.
Private backup:
`/Users/sun/.rah/backups/pre-restart-786f91c6-80d3-45c3-a845-c8337dd2b94b`.
Post-restart comparison found identical full rows for six Rooms, 40 Messages and
four Agent definitions; 40 memory/configuration files retained their digests.
There was no active execution work. No paid-provider call, test conversation,
Task or Agent was created in the formal instance.

## Remaining work, in order

1. Consolidate the remaining Shell tracks/identity slots and button families.
   The 50-property subset does not cover the channel identity tile, all header
   content, sidebar rows or every page. Visual differences outside that subset
   remain candidates, not silently certified matches.
2. Shared overlays/focus lifecycle, including the previously observed intermittent
   relationship-preview Escape failure. Passing this batch does not close it.
3. Forms, empty states and toolbars, each with a representative production page,
   followed by progressive page migration and removal of duplicate page rules.
4. Expand official capture coverage to hover/press/disabled/loading, inspectors,
   drag bounds, narrow screens and backend-dependent states. Current local
   matrices cover more of these than the bilateral replay; they are not the same
   evidence. Do not infer full backend parity from UI measurements.

The boundary remains: one internal maintained library; reviewed official inputs;
generated observation reports; existing canonical business owners. No claim of
complete Raft UI, mouse interaction or frontend/backend parity is warranted.
