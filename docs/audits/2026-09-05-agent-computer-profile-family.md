# Agent / Computer profile family: bounded release audit

Date: 2026-09-05. Scope: [family design](../design/agent-computer-profile-family.md).
This closes a bounded **profile-body, identity preview and navigation** batch,
not every Agent tab, Computer administration feature or whole-product Raft parity.
An independent read-only subagent reviewed the implementation; the main agent
reproduced findings, reviewed screenshots and owns the release decision. This is
not certification by an external audit organization.

## Source → local owner → acceptance

Published Raft sources reviewed on September 4–5 match the recorded hashes in
[source evidence](../evidence/raft-ui-body-20260904.json):

- `MachineDetailPanel-DuFZ_vgC.js`: `ea64ce261730bd0311f09e677f1d46e8668541bc9480783a6b1542cbb1e49ed1`.
- `AgentDetailPanel-BayGfy6W.js`: `e6ef1e2a3df4585e687d481a1a51f4b43983a8b5d13dcc5a61d652fbed53481f`.
- `index-Biin3FEA.js`: `e798f35bde09eeda2927669406e10718392ff7574796016441def59dbc5b05f9`.

These are published bundle observations and structural ports, not original
official React source or a new dependency on the sibling raft-ui directory.

| Trigger / content                      | Source rule and local owner                                                                                                         | Verification / boundary                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Computer / Agent profile fields        | Natural-height sections, 20px horizontal padding; field variants and 1px muted divider in internal `ProfileSection` / `profile.css` | Real browser geometry, long/multiline edits, reload and cancellation; no fixed field height                                  |
| Computer Agent card → Agent → Computer | Authorized entity directory binding, existing Agent route, `AgentComputerIdentity`                                                  | Isolated canonical API and formal read-only round trip; no name matching or inferred hardware ownership                      |
| Runtime / model / effort metadata      | Profile and preview use `entities.runtimesForAgent` plus `runtimeProfilePresentation`                                               | Reordered/multiple bindings, exact model identity, unsupported effort and missing/error data; no arbitrary first Runtime     |
| Avatar hover / keyboard focus          | Existing PreviewCard pending/open/closed lifetime; internal preview frame and explicit 48px avatar variant                          | Delayed Escape, open Escape, pointer transfer, outside dismissal, long identity at 1440 and 390px                            |
| Recent activity                        | Published manager/creator gate, compact tool label, omitted empty region; canonical trajectory ACL                                  | Other-user fixture issues no trajectory read; creator/manager, empty and failures tested; no raw command body in compact row |
| Creator information                    | Canonical creator fact, shared Human/Agent identity                                                                                 | Loading/error/unknown remain distinct from explicit null; unknown is not “no creator”                                        |
| Local runtime diagnostics              | Existing daemon observations remain factual, separate collapsible section                                                           | Mouse/keyboard disclosure; retained diagnostics are not inserted into profile identity fields                                |

Native Firefox official read-only operations covered: Computer detail, description
editor and Escape, Computer Agent card to Cindy, the Computer reference in her
profile, runtime editor showing Codex CLI / GPT-5.6 Sol / Extra High, unchanged
disabled Save and Cancel. No official mutation was submitted. This was not a
fresh equal-viewport computed-style capture for every row/state; denied access,
all provider variants and nonempty workspace browsing are **not** bilateral passes.

## TDD and independent findings

All listed findings were corrected and retested:

1. Late chat CSS overrode preview row geometry. Move 16px line-height / 6px gap
   into internal preview.css and delete the app rules.
2. Failed profile read falsely showed “未分配创建者”. Only explicit null can do so;
   unknown and error have separate labels. Browser receipt `AorlS7` reproduced it.
3. Open previews retained their initial activity forever. Canonical activityAt
   changes now refresh the bounded tail without remounting or another timer;
   keep previous rows during refresh, scope by client/actor/workspace/Agent,
   and reject aborted responses. `RyHYl6` reproduced the retained-open failure.
4. Main-agent screenshot inspection caught an additional 64px avatar overriding
   the 48px preview size. `L0mhyh` measured 64×64 instead of 48×48. The shared
   Avatar now has a preview variant, not another selector override; final browser
   assertions measure both dimensions in both engines and viewports.

The auditor also identified a second Runtime filtering path in the full profile.
It has been removed in favor of the same scoped entity join as the preview.
Final independent read-only review found no new blocking defect in these changes;
targeted profile-family tests passed 6/6. The audit explicitly retains the
incomplete trajectory invalidation boundary below.

## Automated and browser evidence

- `npm run check`: passed, including typecheck; package tests 876 passed / 2
  skipped opt-in gates, web tests 315 passed, callback regressions 34 passed.
- `npm run format:check`, `git diff --check`, formal Web build: passed.
  Existing large-chunk build warnings remain; this batch is not a CPU/load audit.
- Final foundation browser gate: 22/22 engine/scenario results passed, Chrome
  152.0.7977.77 and Playwright Firefox 150.0.2. Scope includes 1440px and 390×844
  profile interactions and the wider existing shell/identity/state matrix.
  Receipt and screenshots:
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-ChzMtS`.
  The runner records exact input hashes and rejects changes during execution.
- Browser screenshots were inspected, not accepted solely from exit status.
  Earlier green receipts preceded the additional avatar assertion and are not
  the final acceptance baseline. Temporary artifacts are reproducible using
  `npm run test:web:foundations`; the registry has 83 behavior records, which is
  **not** a percentage of the whole Raft product.
- All write tests used disposable fake-provider state and existing canonical
  API routes. No paid Provider acceptance or GPT-5.6 Ultra test was run.

## Formal deployment

The final incumbent was re-resolved as PID 7289 owning the exact repository,
4173 listener and `/Users/sun/.rah/state/room.db`. Earlier offline observations
were not reused as restart facts. The guarded restart verified idle work,
SQLite integrity, file inventory and unchanged Room sequence baselines before
gracefully stopping that instance. Verified backup:
`/Users/sun/.rah/backups/pre-restart-69c085c7-249d-4101-b50a-ffaf538e23ec`.

The successor at initial verification is PID 18995, health online at
`http://127.0.0.1:4173`, serving frozen build
`a1d22bff497435b9e2afc27e43cd4f8c46bb502cced9ef8401afdb2c43a30fc3`.
Formal read-only Chrome and Firefox checks passed at 1440×900 and 390×844:
exact frozen build, four bound Agent cards, Computer→Agent→Computer navigation,
no document overflow, no creator-read error misreported as absence, and no page
exceptions. Screenshots were inspected. Receipt:
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-profile-family-formal-cLxFbu`.

Post-restart idle guard passed. Counts remained Principals 6, Rooms 6, Tasks 2,
Agent definitions 4 and definition revisions 34. All six Room sequence maxima
were unchanged (12, 80, 19, 263, 1, 1 in sorted Room ID order). No formal profile
edit, message send, paid Provider run or user notification preference mutation was
performed. Fresh isolated browser contexts disabled notification auto-enrollment
only in those temporary profiles; OS delivery remains a separate gate.

## Still open; next whole-family order

1. **Settings body/form family**: Appearance preview and control sizes, dirty /
   disabled / saving states, Notification button/badge colors, server-profile
   form structure and local destructive-action semantics. Previous header work
   is not proof that these screenshot differences are closed.
2. **Search / Task / message compositions**: remaining empty/error/loading and
   integration combinations. Existing task identity menus, circular dots and
   entity cards remain regression-covered, not newly claimed all-state parity.
3. **Full Human directory / ACL / ownership**: the current Human entry and profile
   work, but a workspace-wide member directory, safe membership removal and
   explicit Human–Computer ownership facts are not fabricated from local host
   presence. Reuse the same identity network when these canonical facts exist.
4. **Profile capability remainder**: Computer bulk/select/create/workspace-scan,
   complete action/provider capability parity, and full trajectory invalidation.
   activityAt is not a complete trajectory cursor: some tool_end/output/system/
   slock_action records do not advance it. Complete upstream filtering before
   selecting the recent five is also still open.
5. **Notification专项** remains a separate required acceptance gate. The isolated
   Firefox browser directly failed `PushManager.getSubscription()` three times
   with AbortError after an active worker / granted permission; Chrome returned
   successfully with no subscription. This locates a browser API failure in that
   controlled profile, not its definitive cause or the user's everyday Firefox
   profile. Accurate error presentation and simulated failure recovery passed;
   actual macOS banners/click return and installed iOS PWA delivery did not pass
   merely because permissions or HTTP transport were successful.

No commit or push was performed. Existing unrelated in-progress changes were
preserved. No whole-product completion or all-event notification parity claim.
