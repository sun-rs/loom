# UI contract integrity and entity network

Status: staged implementation, 2026-09-04. This continues ADR 0028 and the
existing UI consolidation plan; it does not create another theme or data store.

## Ordered delivery

1. **Integrity:** reject unresolved CSS variables; make the status-dot primitive
   own its complete shape/state; remove misspelled aliases and duplicate rules.
2. **Entity projection:** one application-level, actor/workspace-scoped read-only
   directory composes the existing canonical Agent catalog, current Human and
   local runtime inventory. Initial consumers are task identity choices,
   Computer bindings and Agent hover summaries. No persistence, network owner,
   provider parsing or mutation is added.
3. **Body primitives:** selection input/rows, entity cards, contextual empty
   states, profile sections and general buttons; migrate consumers and remove
   their old rules, one family at a time.
4. **Missing data/actions:** Human profile route, canonical creator/join dates,
   shared profile navigation, settings form dirty states and remaining layouts.
   Missing fields stay unknown until the canonical owner supplies them.
5. **Acceptance:** unit invariants, actual production component combinations,
   Chrome/Firefox desktop and 390x844, official source/capture comparison, then
   guarded formal restart. Record untested official states separately.

## Entity contract

Identity is typed: Human principalId, Agent agentDefinitionId + participantId,
Computer hostId, Runtime profile/offer identity. Names never join entities.
The directory is derived from current authorized inputs, rebuilt on changes;
it cannot resurrect removed entities or retain another workspace/actor's data.
Missing/ambiguous bindings stay missing/ambiguous rather than selecting the first
runtime. CLI availability is not Agent presence. Human ownership is not inferred
from the OS user or from installation on the same machine.

The existing shared-Channel member graph keeps its own ACL-safe Kernel query;
this directory does not broaden that graph or fetch other Rooms. Pages may
filter authorized results but must not maintain competing identity records.
DisplayName, handle, avatar, runtime label and diagnostic transport label are
different fields. User-authored names are never silently rewritten.

## Sources and intended differences

Reviewed official live entry on 2026-09-04: app.raft.build,
`index-Biin3FEA.js`, `index-DuTUw-4P.css`. The preceding read-only review located
`fp` (round status marker), `n7/BJe/Vu` (task sentinel/avatar/search input),
`XO/ant/rnt` (conditional profile/recent activity), and Search home flex layout.
Frozen historical assets remain under docs/evidence; do not modify them.
This is a structural port plus RAH local glue, not original React source reuse.
No central account, billing, relay or CLI installation flow is imported.

## Failure-first checks

- Unresolved variables fail, including nested fallbacks; comments are not code.
- A standalone dot is round with its own border, including inside the footer.
- Task sentinels have no avatar but retain the leading slot; real entities use
  the canonical avatar/name. Search matches name and handle; selection uses ID.
- Updated inputs replace labels/bindings without changing IDs; removed or
  ambiguous relationships are not guessed; availability does not imply online.
- Rest/hover/focus card border and input focus shadow are computed in browsers,
  not asserted from class names. Tests use isolated fixtures, not paid providers.

## Progress

First slice implemented and verified; see the
[scoped delivery audit](../audits/2026-09-04-ui-entity-integrity.md):

- `scripts/ui-css-contract.mjs` checks maintained CSS names at the library gate;
  existing aliases are replaced, not perpetuated. This detects missing names,
  not every scoped-cascade or invalid-value error; browser checks remain required.
- `packages/ui-web/src/neo-brutalist/status-dot.tsx` and internal `identity.css`
  own dot shape, size, color and pulse; page-level duplicates were removed.
- `apps/web/src/workspace-entities.ts` derives stable typed identity/binding
  edges once at the App boundary. The shared provider supplies Computer Agent
  rows, hovercard binding/model resolution and both task identity menus.
- `task-person-options.tsx` supplies real profile avatars, sentinel spacing and
  displayName/handle search to the existing selection popup. The popup owns its
  focus shadow; no separate page-specific menu behavior was introduced.

Second slice: Computer and created-Agent cards now consume `EntityCard` through
`AgentEntityCard`; Search home and Agent Activity consume contextual `EmptyState`.
Removed their former page-specific card rules and intrinsic Search home wrapper.
The official empty Activity's **caller** retains its diagnostic header; reviewing
only the inner empty component would miss this composition. Loading/failure stay
distinct. Fresh source/native-browser observations are in
`docs/evidence/raft-ui-body-20260904.json`; executable UI006/UI007 records are in
the existing registry. Delivery results belong to the scoped audit, not this plan.
See [second-slice delivery](../audits/2026-09-04-ui-body-primitives.md) for the
final browser receipts, formal restart and explicit bilateral limitations.

Open after the second slice: profile navigation/sections, factual relationship
metadata, remaining empty states, permission-conditional hover activity,
Computer diagnostic layout and settings dirty states. The third-slice scope
below supersedes only the Human sidebar/profile-read portion of that list.

The directory currently knows the signed-in Human and authorized Agent catalog.
Other Humans are enriched only from authorized query candidates; their profiles
are not cached centrally or fabricated. It is a starting read model, not a claim
that every page or every backend identity relation is already integrated.

## Third slice: Human navigation and factual relationship fields

Implemented scope of this slice (not whole-profile parity): `human.profile`
returns the current Principal, control-Room membership role/joinedAt, and bounded
revision-one created-Agent IDs. Kernel `HumanProfiles` rechecks the authenticated
Human and both current memberships on every request. Ordinary members can read
public Human identity but cannot enumerate the managed Agent catalog through
creation edges. No new tables, identity cache, provisioning authority or runtime
work is introduced. `principal-profile.fromRow` and
`listCreatedAgentDefinitionIds` remain the shared fact readers.

The members sidebar now navigates by Human principal ID. `memberView=human` is
mutually exclusive with Agent/relationship/Room state; reload and mobile back use
the existing route owner. The profile read is aborted on navigation and fenced by
actor/workspace/target. Catalog revision changes refresh creation relationships;
presence ticks do not. The entity directory joins only still-authorized Agents.
The former Human-only row CSS was removed; member rows and profile avatars are
reused. `ProfileSection` owns body dividers/spacing in the internal library.

Source inspected again: `HumanDetailPanel-p6I0u4UJ.js`, SHA-256
`fca1dc1f0c7434d33856c716cb6a133904a8bfb275966a762671aaae15778470`.
Its `ut` component provides identity, conditional membership fields, created
Agents, and shared 20px/16px section geometry. Official self-DM, description/avatar
editing, role changes and removal are **not** claimed as implemented here.
Current description/email/Computer ownership lack canonical data and are omitted.
The authenticated official browser was in concurrent use, so this slice does
not claim a fresh bilateral Human browser receipt. Existing supplied screenshots
and published source remain the reference, not proof of untested behavior.

The pre-change inspection confirmed that the member sidebar rendered the Human as a
non-interactive `div`. `PrincipalSchema` carries ID, kind, handle, displayName and
avatar only; `principal.update` changes displayName/avatar. Description, joined
date, email and ownership are not fields that a page may invent. This slice
separates existing profile data from facts requiring a canonical query.

1. Added typed Human profile navigation and a shared profile body. Reuse the same
   authorized directory and entity-card presentation; resolve by principal ID.
   Self profile is not another Agent and must not start a self-DM by accident.
2. Defined the smallest ACL-safe canonical profile projection for needed extra
   fields. Kernel owns membership/creation facts; Computer runtime observations
   own connectivity, not Human ownership. No graph database or UI persistence.
3. Resolved original Agent creator from creation evidence, not
   `currentRevision.createdBy` (which is the revision editor). The existing
   created-Agent query is retained; any new Human relation query must apply the
   same current actor/workspace authorization and omit unknown legacy facts.
4. Added rename/avatar propagation, unauthorized lookup and deleted-entity
   projection tests, plus original-creator checks after another editor changes
   the Agent. These do not certify future Human description mutations.

The [Human page family](human-page-family.md) supersedes the next-step list of
this read-only slice: creator, mention, message avatar and graph entrances now
share the profile route; Principal schema 47 adds local description and a
shared conflict-checked mutation for profile/account editing. Historical browser
receipts above do not certify these newer mutations; use the family gate.
Next families remain Agent/Computer body sections and settings form states.

The [Agent/Computer profile family](agent-computer-profile-family.md) now owns
the next batch: common natural-height profile geometry, runtime resolution,
conditional previews, Computer navigation and isolated mutation acceptance.
UI009 connects source/projection ownership to executable scenarios in the existing
registry. Completion and formal release evidence belong to that batch's audit;
the remaining Settings and full identity/ACL work are not implied complete.
