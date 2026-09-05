# Human profile and factual creation edges

Date: 2026-09-04. Scope: the third slice of the
[entity-network closure plan](../design/ui-entity-network-closure.md).
This is an implementation self-review, not an independent third-party audit or
a certificate of full Raft parity.

## Delivered boundary

The members sidebar's Human row is now an actual button. It opens a stable,
reloadable Human profile by principal ID, using the same desktop/mobile route.
The profile displays the authorized identity, control-Room membership role and
join date, and permitted created-Agent cards. Clicking a card opens that exact
Agent. Viewing one's own profile does not create a self-DM.

There is still one derived actor/workspace entity directory. The new query
enriches that directory's projection; it does not introduce another identity
store, graph database, provider parser, or browser persistence layer.

| Fact or behavior                            | Single owner                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Human identity and image                    | Existing Principal and `principal-profile.fromRow`                         |
| Current membership, role and join date      | Canonical control-Room membership                                          |
| Authorized Human profile read               | Kernel `HumanProfiles`, typed `human.profile` facade                       |
| Original creator                            | Shared `listCreatedAgentDefinitionIds`, revision 1, not the current editor |
| Current Agent/runtime/presence presentation | Existing workspace entity directory and `AgentEntityCard`                  |
| Human URL and mobile return                 | Existing `agent-route.ts` owner                                            |
| Profile section spacing/dividers            | Internal `ProfileSection` and `profile.css`                                |

The profile read checks the authenticated Human and both current memberships on
every request. Ordinary members can read the public Human identity, but cannot
enumerate the managed Agent catalog through creation edges. Creator queries
exclude tombstones, stay in the same control Room, return at most 500 IDs and
explicitly mark truncation. No schema migration or provisioning change was made.

Frontend responses are fenced by actor, workspace and target and aborted when
navigation changes. Catalog revision changes refresh creation edges; presence
ticks do not refetch the profile. An unavailable profile renders an error, not
the previous identity or a fabricated empty profile.

## Raft evidence and intended differences

The published
[HumanDetailPanel-p6I0u4UJ.js](https://app.raft.build/assets/HumanDetailPanel-p6I0u4UJ.js)
was inspected on this date. SHA-256:
`fca1dc1f0c7434d33856c716cb6a133904a8bfb275966a762671aaae15778470`.
Its `ut` component establishes the identity section, conditional fields,
created-Agent cards and section geometry: 20px horizontal padding, 16px section
vertical padding, and a 1px black/10 divider. Role colors are orange for owner,
pink for administrator, lavender for member. These were structurally ported
into the owned internal library, not claimed as byte-exact original React source.

Machine behavior UI008 also links the retained historical Human chunk
`docs/evidence/raft-web-20260831-current/HumanDetailPanel-DvWNsDz9.js`
(SHA-256 `83c31367e48dc1ff6fb75c763ae78fafe16070d53e7d4d58ba16303f7c49bceb`).
An old frozen directory name does not imply it is the current official release.

The official browser was in concurrent use; further interaction was stopped.
Therefore this batch has source inspection and the user's reference screenshots,
but **no fresh official Human-page bilateral browser acceptance**. Local Chrome
and Firefox results below do not fill that evidence gap.

Upstream self-DM, description/avatar editing, role changes and member removal
are not implemented by this slice. RAH does not fabricate email, Human description,
or ownership of a Computer from an OS account or physical co-location. The existing
account profile editor remains separate; this report does not certify it.

## TDD and review

Before implementation the Human route test failed by serializing Agent state,
and the Kernel test failed because `getHumanProfile` did not exist. Subsequent
tests cover strict schemas, actor injection rejection, workspace isolation,
non-Human actors, missing/removed membership, and current rename/avatar clearing.
An administrator editing an Agent does not acquire its original creation edge.
Unknown and tombstoned Agent IDs are excluded from the shared UI projection.

The sidebar was extracted from the large detail module; its obsolete Human-only
row CSS was removed. Two source-contract tests were updated to inspect the actual
sidebar owner, retaining their interaction assertions instead of deleting them.
SDK and Core operation inventories explicitly include the new read operation.

The browser helper exercises real HTTP reads and real button/keyboard navigation:
desktop 1440x900 and mobile 390x844, reload, created-Agent navigation, invalid
principal rejection, mobile return, and a deliberately delayed profile response
released after switching to an Agent. It checks no self-DM mutation, no overflow,
matching header baselines and computed section geometry. Only the exact deliberate
unknown-principal 403 is exempted from its error check.

Inspection of the first formal negative-state screenshot caught an unstyled
retry control: `rah-settings-button` was not a standalone library button. A real
browser assertion reproduced the 0px border before correction. The control now
consumes the existing internal `.btn` family; the profile notice only owns
message/action layout. The final browser helper checks its 2px border and
executes an actual denied-request retry. The initial formal build is not the
final accepted build for this reason.

One intermediate browser run timed out in the existing Tabs scenario; a later
run executed all scenarios but was correctly rejected for input hash drift while
the delayed-response case was being added. Neither is counted as acceptance.

## Verification and deployment

All results below are after the negative-state correction. No paid runtime was
invoked. The first production
dependency audit did not return and was cancelled; a bounded retry completed
with zero reported vulnerabilities (`npm audit --omit=dev --fetch-retries=0
--fetch-timeout=10000`). This is a dependency scanner result, not a full security
or performance audit.

- `npm run check`: passed. Package suite 874 passed / 2 opt-in skips; Web unit
  suite 306 passed; real-callback regressions 34 passed. Logs:
  `/tmp/rah-human-check-accepted.log`.
- `npm run format:check`, `git diff --check`, and `npm run build:web:workbench`:
  passed. Existing large-bundle warning remains; this batch does not claim a
  bundle-size/performance improvement.
- `npm run test:web:foundations`: 14/14 scenario/engine results passed,
  including the Human scenarios nested under integrated-shell acceptance.
  Chrome 152.0.7977.77 and Playwright Firefox 150.0.2. Final receipt:
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-V8ZP3M/receipt.json`.
  All receipt input hashes were rechecked against the final implementation;
  no drift. This is not the user's existing native Firefox profile.
- Fresh **formal** Chrome/Firefox verification passed at 1440x900 and 390x844,
  including denied-profile retry and late-response navigation. Receipt and
  screenshots:
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-human-final-H6kE3Q/`.
  Manually inspected `chrome-human-1440.png`, `firefox-human-390.png`, and
  `firefox-human-denied-390.png`; the retry control now has its visible frame.

Formal URL: `http://127.0.0.1:4173`. Final frozen build:
`a36cdd083d2f4e3f015ab5e5e2e753c33075402590dd8e214a2ecba6a4388bbb`.
The guarded restart verified exact PID/cwd/database/listener, no active work,
backup equivalence and stable Room sequences before graceful shutdown. Final
PID 65670, started 2026-09-04 20:02:26 Asia/Shanghai. Final rollback backup:
`/Users/sun/.rah/backups/pre-restart-f51a4f60-7a2c-4500-a9a5-1467ffb52a10`.
An earlier guarded restart's backup is retained at
`/Users/sun/.rah/backups/pre-restart-1c5b0383-0af3-45f2-bef1-a9e297f5cb70`.
No cleanup or Git commit/push was performed in this batch.

Before and after both restarts: 6 principals, 6 Rooms, 43 messages, 2 Tasks,
4 execution policies, 4 Agent definitions, 34 Agent definition revisions.
Backup verification also covers persistent private files; the counts alone are
not claimed as proof of byte-equivalent state. The formal browser tests were
read-only and created neither messages nor self-DMs.

## Remaining order

1. Connect Human creator, mention and relationship-graph entry points to this
   same typed profile route; currently the sidebar and direct URL are connected.
2. Design canonical Human description/edit permissions and tests before adding
   those controls. Do not infer Computer ownership or copy central account fields.
3. Migrate remaining Agent/Computer profile sections to the internal profile
   primitives, then settings dirty/disabled states and diagnostic layout.
4. Complete missing official same-state browser comparisons and, if requested,
   a separate independent review. UI008 is one bounded behavior, not whole-site
   completion; the behavior inventory is not a percent-complete denominator.
