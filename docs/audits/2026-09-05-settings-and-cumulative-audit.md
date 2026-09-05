# Settings family and cumulative-change independent audit

Date: 2026-09-05. Scope: the cumulative uncommitted `rah_os` worktree, not
only the last Settings edits. This is an independent subagent review followed
by main-agent reproduction/review, not certification by an external company.

## Implementation and provenance

The [Settings family plan](../design/settings-page-family.md) records the exact
published Raft chunk URL/hash and adoption limits. Its raw analysis-only artifact
is [frozen here](../evidence/raft-settings-20260905.js); the internal maintained
owner is `packages/ui-tokens/src/neo-brutalist/settings.css`. Corresponding
desktop/mobile rules were removed from `apps/web/src/product.css`, rather than
layering a new override sheet on top of them.

The shared Settings family now covers Account, Language & Region, Appearance,
Notifications, Workspace profile and the current-member Administration summary.
All 12 RAH sections consume the same shell. Navigating MCP/LAN/resource tabs is not proof of
complete feature equivalence inside them.

| Official contract                                    | Local owner / result                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appearance framed cards and unframed message preview | Internal Settings CSS; actual MessageMarkdown/reference renderer, inert demonstration identities, labelled keyboard toggle, device-storage feedback             |
| Notification yellow status, green test, pink save    | Semantic yellow/green/pink tokens, existing Push owner; request confirmation explicitly says to check system notification, not proof of OS display              |
| Profile dirty submit and read-only slug              | Account Human mutation and Workspace draft hook; Enter follows the same validation as the save button, trimmed names, grey read-only slug and left-aligned save |
| Identity displayed consistently                      | Administration uses Principal avatar and actual membership role; missing role remains unknown rather than owner                                                 |
| Canonical authority and pending/error behavior       | Workspace control-Room baseline and returned event sequence, retained drafts on refresh/conflict, explicit latest-version retry, client/entity response fencing |
| Language, translation and time preferences           | Raft's two-form layout; truthful Chinese/device-timezone limits, disabled unavailable translation modes and persisted 12/24-hour device preference              |

The current Raft `Ec` Workspace component does not include the old screenshot's
delete-server section. No fake local deletion capability was introduced. Local
avatar upload intents and conflict protection deliberately remain stronger than
blindly copying central-server state. No Provider installation/account management,
billing, central Apps or paid CLI execution was added.

## Independent findings and main-agent disposition

Three bounded reviewers independently inspected frontend/UI, backend/protocol,
and evidence/release tooling before remediation. Six P2 findings were confirmed;
no P0/P1 was found in those reviewed scopes. Absence of findings is not a claim
that the entire product is defect-free.

| Finding                                                               | Reproduction                                                                                                  | Disposition                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Virtual Appearance Human remained keyboard-active                     | Auditor's real isolated Chrome activated `appearance-preview-human` via Tab/Enter despite pointer-events:none | `inert` protects pointer and keyboard; production-context navigation test checks actual identity buttons cannot take focus                                                                          |
| Workspace stale control-Room version had no draft-preserving recovery | Remote sequence advance rejects save; old UI only offered retry when baseline was absent                      | Explicit reread/retry retains text; receipt event sequence replaces guessed +1; both conflict and failed-read recovery tested                                                                       |
| Fresh Human profile hidden by startup Principal cache                 | Pure projection and real Chrome returned fresh canonical data but displayed old identity                      | Authorized profile observation updates the existing Principal owner; typed read/write generation fence, settlement-triggered refresh, failed-write recovery and client/actor/workspace invalidation |
| Empty comparison plan could pass                                      | Validator accepted zero scenarios                                                                             | Nonempty plan required; regression rejects zero-work green result                                                                                                                                   |
| Evidence hashes omitted executable dependencies and new files         | Kernel fixture/client-core/SDK and newly added files outside old manifest                                     | Shared input inventory covers Web/package sources/tests, scripts/configuration and indirect frozen evidence; end-of-run re-enumeration detects additions, deletions and byte drift                  |
| Healthy-but-modified SQLite backup still verified                     | Legal UPDATE changed contents while integrity checks passed                                                   | Stable backup database hashes and exact database-set checks in addition to SQLite/FK checks; main review also corrected nested-path sorting and typed receipt declaration                           |
| Formal request guard was fail-open                                    | `/v2`, `/_rah` and Service Worker traffic could bypass the old page regex                                     | Red-first pure-policy tests; context-level all-request interception; Service Worker blocked; exact method/path/origin allowlist; minimum observed requests and per-engine counts recorded           |
| Auxiliary fixture pages had weaker evidence guards                    | Clock/Settings/new-context pages missed observers; later page mocks could outrank a route guard               | Instrumented browser/context factory protects every page; an independent request observer rechecks even fulfilled mocks; fixture API has an explicit allowlist; only exact CAS/SW test exceptions   |
| Formal compact receipt omitted runner provenance                      | Receipt named the runner but did not preserve its bytes                                                       | Full and compact receipts now preserve SHA-256 for the runner, request policy and red-first policy test                                                                                             |

The frontend reviewer examined 55 tracked frontend/UI diffs plus new production
owners, with emphasis on App routing/providers, Agent/Human/Computer identity,
Task identity menus, Search/Saved, Settings/Push and removed CSS. The backend
review covered all cumulative protocol/Kernel/SDK/HTTP diffs, schema 46→47,
Principal CAS, avatar intents and revision-one creator relations. The evidence
review covered runners/registries/adoption, CSS checks, CI and guarded restart.
These are bounded code reviews, not full line-by-line review of every historical
document or every unchanged service.

Backend reviewer tests also exercised real SDK→HTTP Human profile success,
nonmember denial and unauthenticated 401; CAS conflict preserved both the prior
avatar and upload intent via transaction rollback; identical retry after intent
consumption succeeded. Those temporary additional experiments are not all durable
release-gate cases yet. No production database was mutated for audit tests.

Main-agent review found and required additional Human race handling: rejected
reads must not leave a profile loading forever, failed writes must settle,
A→B→A must permanently invalidate the old scope, and a read token must not settle
a pending write. These are covered in the committed-to-worktree test sources.

The full browser gate subsequently caught a composition regression: the
settlement refresh unmounted a Human editor after a rejected save and discarded
its draft. The same exact authorized scope now preserves the editor during a
background read; scope changes, read errors and mismatched responses fail closed.
The existing browser assertion was not weakened. Its initial failing receipt is
`rah-ui-foundations-h2EBty`; the isolated repaired Chrome run is
`rah-human-family-race-GCB6mr`.

The all-tab gate also exposed loopback LAN discovery returning an expected
feature-absence 404, which polluted browser errors (`rah-ui-foundations-cdtGlY`).
Two red unit cases preceded an explicit HTTP 200 `{ available: false }` contract
for loopback and Vite. It grants no session, cookie or upstream access; other LAN
routes/POST remain 404 and pairing remains disabled. The backend reviewer
independently rechecked this final change and found no blocking issue. The
browser gate still rejects all unexpected resource/console/page errors.

## Verification and release

Final checks at the audited revision:

- `npm run check`: 879 package tests (877 pass, 2 skip), 325 Web tests and
  34 callback regressions pass. Type checks, UI library/registry checks,
  Prettier and `git diff --check` pass.
- The pre-unlock UI foundation gate recorded 24 engine/scenario results (12
  each in Chrome 152 and Firefox 150), all passed, with 948 exact input hashes.
  At that revision Settings covered desktop and 390×844, all 11 then-existing
  RAH sections, forms, errors, conflicts, stale/late responses,
  pointer/keyboard/disabled states and screenshot geometry. Historical receipt:
  `rah-ui-foundations-CtEfeE`.
- Frozen official-capture replay matched 50/50 body comparisons and 68/68 shell
  comparisons, with no different, uncomparable or error rows. Receipts:
  `rah-ui-comparison-EweCe3` and `rah-ui-comparison-72Vsyu`.
- Pre-unlock formal build
  `1462acb5e3d03bf80deb140016be08bf5241e000a8e18832bb383ffd060b8b8c`
  replaced the exact idle instance only after a private, SQLite-checked and
  content-hashed backup. The verified backup is
  `pre-restart-1e4d9cd5-4f57-48af-9e68-a79794abb868`.
- Fresh formal Chrome and Firefox profiles navigated all 11 tabs at both
  viewports with no page, console, response or unexpected request errors.
  Screenshots were inspected. The request guard allowed only typed reads and
  the app's normal read acknowledgement; canonical counts and every Room's
  maximum sequence stayed identical. Receipt: `rah-settings-formal-5CDAWq`.

All mutation tests use isolated fake-provider state. No real Provider or paid
model was run. The raw official bundle was freshly retrieved and its hash
checked. The first formal run covered the then-existing 11 RAH tabs; the Mac lock
prevented new interaction with the logged-in Raft browser at that point. That
limitation is superseded by the addendum below. No macOS banner/click-return or
iOS device delivery claim.

## Unlocked-Mac live Raft addendum

The logged-in Firefox page was inspected read-only against Raft 1.12.0 on the
same date. Account, Language & Region, Appearance, Notifications, Server Profile,
Administration, MCP and About were opened directly. This confirmed the exact
notification scope text and visual roles already adopted, and found one false
exclusion: Language & Region was missing from RAH. A red-first contract and
isolated Chrome/Firefox fixture covered the added twelfth section, disabled
unsupported translation modes, keyboard time-format selection, save feedback
and reload persistence. Interim browser receipt: `rah-ui-foundations-26AVjs`.
It is superseded by the final receipt below because the registry and shared
time-format owner changed afterward.

The read-only live observation is recorded without user, email or workspace
identifiers in
`docs/evidence/raft-settings-live-observation-20260905.json`. It is manually
repeatable from an authenticated browser but not an automated replay artifact.

The final isolated browser matrix supersedes the interim receipt:
`rah-ui-foundations-UVsyUu` records 24/24 scenarios in Chrome 152 and Firefox
150, 956 exact current inputs and 48 Settings screenshots (12 RAH sections × 2
engines × desktop/390). Its registry hash is
`64562857904c40f1a0ad3ed0b39d7e87b444ef69c2a652d99bb31596395eb267`.
Every main and auxiliary page uses the same fail-closed request guard plus an
independent request observer, so a later route mock cannot bypass evidence.
Chrome and Firefox respectively observed 43 and 42 explicitly allowed fixture
API method/path kinds, with zero unexpected, blocked, page, console or HTTP
errors.
The compact durable attestation, including the full receipt hash and aggregate
screenshot manifest hash, is
`docs/evidence/rah-ui-foundations-settings-20260905.json`. The full receipt and
screenshots remain temporary by design to honor the repository's disk-space
constraint; the durable attestation also preserves the complete filename/content
input-manifest hash and runner/policy/test hashes, making the runner a pinned,
reproducible evidence source. This isolated
matrix is supplemented by formal deployed-build acceptance below.

The production Web build
`5950d755bad04ad75cc8cd48ddfe98524afb1ef070cd1ee829da495b00a92690`
was installed through the guarded restart path only after the exact idle process
and state owner were checked and the private backup
`pre-restart-8c8a5c48-eddd-407c-886e-8ad8ba18e562` was content-verified. The
successor was PID 82782 on loopback port 4173. The reusable formal runner then
navigated all 12 Settings sections in fresh Chrome 152 and Firefox 150 contexts
at 1440×900 and 390×844. All 48 screenshots were produced and sampled; no page,
console, response or unexpected API error occurred. Its exact API guard permits
only the declared typed POST reads, ordinary read acknowledgement, and the
content-free `GET /v3/client/health`; every other versioned request is aborted.
Canonical Principal, Room, Message, Task and Room-event counts and every Room's
maximum sequence were identical before and after. The compact receipt is
`docs/evidence/rah-settings-formal-20260905.json`; the full temporary receipt is
`rah-settings-formal-rZNFKh`. The runner now refuses to start unless the local
origin and `room.db` path are both supplied explicitly; it has no production
default target. That receipt is self-contained for runner
provenance and records 24 actually observed allowed API method/path kinds in
each engine, so an empty or bypassed request stream cannot produce a green run.

The live inspection also corrected the cumulative completion claim:
Administration is not feature-equivalent. Raft 1.12.0 includes owner/admin
assignment, #all visibility, invitations, pre-join agreement, Human onboarding,
Agent greeting, server translation and Human-directory privacy. RAH currently
shows canonical current membership and Agent count only. Central invitations and
cross-organization account functions remain out of scope; applicable local ACL,
system-Room visibility, onboarding and directory privacy still require explicit
owners. MCP likewise has a functioning local owner but not Raft's recommended
Notion/Linear catalog. These gaps are recorded rather than hidden by shared-shell
screenshots.

## Remaining whole-family order

1. Search / Tasks / message compositions: remaining error/loading/empty and
   combined states, including live activity and toolbars. Existing avatar menus,
   entity cards, status dots and scoped empty bodies remain regression-covered.
2. Complete workspace Human catalog and ACL actions through the same information
   network. Do not infer Human–Computer ownership from local host presence.
3. Remaining profile capabilities: Computer bulk/select/create/workspace scan,
   provider/action capability parity and complete trajectory invalidation/filtering.
4. Device-level notification acceptance: actual macOS/Chrome/Firefox banner and
   click return, installed iOS PWA, and event-matrix coverage. Settings/request
   feedback and simulated browser subscription states are not substitutes.

The 84 machine-registered behaviors are not a full-product completion percentage.
No commit or push was requested or performed in this continuation.
