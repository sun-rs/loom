# Loom engineering contract (main; promoted from evo)

This guide applies to the current `main` of Loom (repository `rah_os`, promoted
from `evo` on 2026-10-23), not the
legacy sibling `rah` repository. There is no `HANDOVER.md`. Do not import the
legacy project's Session-first rules or obsolete roadmap restrictions.

## Owner directive: complete official frontend baseline (2026-10-30)

The next accepted frontend baseline is the **complete official Web1.21.40
source plus raft-ui0.52.2**, not old page source with newer resource patches.
This directive supersedes the selected-closure/resource-port upgrade recipes
below for future frontend migration. Existing ports describe the deployed
legacy implementation and historical evidence; they do not authorize adding
another cross-version UI slice or declaring the migration complete.

Acquire and verify the complete target release before replacing the frontend.
Owner explicitly authorized extracting the deployed release: the complete,
immutable executable module/resource closure is an accepted intake, separately
identified from the original authored TSX checkout. Do not wait for a public
source mirror or describe compiled code as recovered original TSX. Preserve
official files unchanged; SDK/data/identity/capability and delivery bindings live
outside that source. Selected fragments, the UI npm package alone, screenshot
matches or a changed version label do not prove a complete Web intake.
Verify the entire graph, dynamic resource seams, actual bundled UI implementation
and offline native-page boot. Acquisition does not certify backend adaptation
or visual/behavioral acceptance. Preserve current service/data until the new
whole-release adapter passes; never mix old page implementations into the new
runtime. Backend Role/Instance/Session/Channel owners and approved Loom-only
capabilities remain intact. See
`docs/design/full-official-frontend-baseline.zh-CN.md`.

- `chatbox` now contains the independently imported `rah/main` workbench
  (initial source `871ace825954750a546a027a832d76332cbd467e`). It is a separate
  product branch with its own engineering contract; never merge its Session-first
  rules or source into Loom implicitly. The former reconstructed UI branch is
  retired; existing tags and Git history retain it.
- `main` is the active Loom product branch; the obsolete `evo` branch is removed.
  Existing instructions to develop/commit/push `evo` now apply to `main`.
  Historical comparisons to `main` mean the retired baseline `f1bc8c9d`,
  not today's imported `chatbox`.
  Keep `docs/evo`, deployment labels and data paths unchanged; branch promotion
  does not certify unresolved acceptance gates. See
  `docs/evo/branch-promotion.zh-CN.md`.
- The promoted product has frozen its backend MVP and entered the official-source frontend
  replacement. The owner explicitly retired the reconstructed `apps/web`,
  `packages/ui-web`, `packages/ui-tokens` and `packages/raft-ui-snapshot` source
  on 2026-10-14; do not restore them. `frontends/raft` is the sole product UI base.
  The temporary `apps/console` was retired on 2026-10-17 after its supported
  capabilities received product UI replacements. Acceptance uses
  `frontends/raft`, API and focused tests. Do not restore the console workspace,
  gateway route, deployment environment or dedicated build/test scripts.
- `docs/evo/target-contract.zh-CN.md` is the single target contract and takes
  precedence; `docs/evo/status.zh-CN.md` records current main state and retained acceptance limits; code
  proves current behavior but never overrides owner goals or safety
  constraints. Owner documents in `docs/architecture` and `docs/product`
  describe the `main` baseline and are superseded where they conflict with the
  evo documents.

## Current architecture and modification map

This is Loom main, a local-first single-Human multi-instance collaboration product.
Read the target contract before changing behavior; this map is not a replacement.

- **Role** is a reusable configuration with a stable ID and immutable revisions.
  **Instance** is a Channel member/principal with its own stable ID, frozen Role
  revision and serial execution lane. Several instances run in parallel.
  **Session** is that instance's continuous native CLI conversation, not the
  business ledger. **Channel** is the durable collaboration/message-box boundary.
  Names are presentation; stable IDs own references. Editing/deleting a Role
  never silently changes or deletes existing instances or their history.
- **Backend ownership:** protocol validates contracts; Kernel owns transactions,
  Room events, delivery, tasks, memory and execution fences; AgentHost owns native
  CLI lifecycle; application-service/SDK expose authenticated operations;
  client-core reconciles durable state. UI and provider transcripts never create
  a competing business owner. Backend MVP is frozen: reproduced fixes and
  owner-authorized compatibility changes only, not a new orchestration rewrite.
- **Frontend ownership:** `frontends/raft` is the only product UI. Official
  `raft-ui` owns primitives/recipes; `upstream/raft-web-source` owns the pinned
  immutable selected source closure; generators own extracted presentation;
  `loom/` owns explicit SDK/data/route bindings and recorded exceptions. Keep
  upstream stores out of business state. Some page composition and resource
  ports remain local: this is not an untouched copy of the whole official Web.
- **Change location:** component appearance -> official package; upstream page
  changes -> independently acquired source plus generator/export closure;
  Loom-specific behavior -> thin adapter and its existing backend owner.
  Never hand-edit generated output or immutable source to make an upgrade pass.
- **Upgrade method:** identify package/Web/source/Computer/server separately;
  acquire the candidate without moving pins; inspect official old/new diff and
  changelog; add failing affected contracts; update exact dependencies/resource
  hashes, then adapt only affected bindings; verify source integrity, one runtime,
  type/build, desktop/mobile messages/forms/panels and safe deployment. Deprecated
  official aliases may bridge older immutable source; do not blanket-codemod it.
  Passing hashes/build does not prove visual or behavioral parity.
  Candidate files outside the lock must be reported separately, not silently ignored.
  Compare each retained page's empty/default/selected state and its sidebar/list
  width policy (default, persisted drag, min/max and narrow-screen transition).
  A component-package upgrade never closes these page-level checks.
- **Current package:** `@botiverse/raft-ui@0.52.2` via alias `raft-ui`.
  Selected page source remains `db5e399` (Web 1.21.23 source); resource ports retain
  their original provenance. A package upgrade alone does not prove latest
  whole-site parity; Theme/swipe bindings have separate source records.
  Retained resource changes from Web 1.21.35
  settings mode belongs in Themes; workspace notification preferences have a
  separate destination from browser permission; Activity uses a Filter menu and
  clearable chip; Roles group by verified Computer runtime bindings. Never infer
  a local Computer from an opaque offer ID or block the Role list on discovery.
  Empty pages/conversations use the official EmptyState composition; zero-instance
  Computer sections render a quiet caption without an empty bordered list.
  See `docs/evo/evidence/2026-10-28-ui-refresh/README.md`.

Web 1.21.38 selected declaration intake lives in `upstream/published-2026-10-29`:
message text-selection Drawer, mobile compact task-head observer/pull-down and
semantic Chat/DM/follow icons. New package list-cell styling owns its frame; do
not retain the old search wrapper hairline. These are scoped resource bindings,
not a whole-site source upgrade. Generated JS **and** declaration surfaces are
owned by `generate-refresh138.mjs`. Mobile audit must report host-field changes
and Compose paths outside the selected lock, not only unchanged width numbers.
The follow-up `upstream/published-2026-10-29-closeout` intake and
`generate-remaining138.mjs` own native menu rows, manual-unread marker and
narrow merged-side cover tabs. Both panes must stay mounted, with independent
drafts and inert hidden content. Clipboard is a generated leaf shared with the
official selection drawer; never import a whole drawer just to copy text.
Right-click Unfollow commits immediately; only swipe Unfollow stages a single
deferred write with Undo. Context-menu mute has no swipe Undo toast.
Runtime picker groups use verified Host offers/catalog facts, never inferred
login/account status. Native OS Duo regions remain outside this Web binding.
See `docs/evo/evidence/2026-10-29-ui-closeout/README.md` and its menu matrix.

Manual unread is Human attention state owned by Kernel `HumanActivity`, separate
from exact unread-message counts and provider/instance delivery positions.
Schema 91 adds `human_activity_manual_unread`; stale viewport acknowledgements
must not clear a later deliberate mark. Room deletion erases these marks with
the Room. Never synthesize a peer message/count merely to display the marker.

Web1.21.39 sidebar slice (2026-10-30) uses native npm0.52 Section/List/Item
composition for Role, chat and Computer lists. Published group/cell-state/caption
leaves are locked in `upstream/published-2026-10-30-sidebar` and generated by
`generate-sidebar139.mjs`. Never restore the Web138 Role-only inset override,
duplicate Computer padding or DnD section margins; historical sources remain
reproducible but inactive. This slice does not certify whole-site/latest parity.
See `docs/evo/evidence/2026-10-30-sidebar139-alignment/README.md`.
Pin one Web release and its actual loaded vendor/CSS per batch; compare page
wrappers and semantic icon callsites as well as package classes. If upstream
changes during work, record it as a new candidate instead of mixing releases.

Web1.21.40 scoped intake `upstream/published-2026-10-30-pwa140` supplies the
native browser-chrome hex resolver and avatar preset/grid classes, generated
by `generate-pwa140.mjs` (JS and declarations). Do not write raw OKLCH/CSS vars
to theme-color or restore locally styled preset buttons. WorkspaceTheme is
the single chrome writer; the persistent PWA edge paints only the safe top
(5px minimum when native inset is zero), with a matching compact root reserve;
there is no pointer hit area. This is a Loom browser adapter,
not native OS validation. Global Tasks retain their bounded UI projection while
hidden/inert, stop inactive reads, and revalidate on return without replacing
same-query content with initial skeletons. Other workspace/filter results must
not leak through that retention. Native Tasks loading primitives serve module
and query loading; all writes still use the existing task owner. Role-to-member
bindings must pass avatarUrl from the current Role revision; existing member
avatars continue to come from their frozen instance configuration.

Executable upgrade practice and the current change matrix:
`docs/design/official-ui-upgrade-workflow.zh-CN.md`. Commit/push active product
work to `main`; `docs/evo` and `com.loom.evo` are retained paths/labels, not active
Git branch names. Chatbox has its own branch and engineering contract.

Sidebar spacing checks must cover the complete retained hierarchy, not only
one row: scroll origin, group header, title-to-list, adjacent rows and adjacent
groups, including several Computer groups. The full Web1.21.40 desktop probe
is `native-sidebar-spacing-browser.mjs`; Loom's matching gate is
`LOOM_PIXEL_AUDIT_EXPECT=140 LOOM_BROWSER_SLICE=sidebar-pixel-audit`.
Record deliberately omitted native modules separately (e.g. the54px Graph entry
above the Agent group); do not recreate their empty space with arbitrary padding.
Desktop measurements do not certify mobile-app parity or the whole-Web migration.
Owner correction2026-10-30: the earlier static sidebar report missed empty
Pinned and actual drag behavior. Sidebar acceptance must include empty/expanded/
collapsed, populated, dragging, cancel, delayed confirmation, rejection and reload;
numeric populated-row checks alone cannot establish parity. The complete pinned
Web1.21.40 drag declarations, collision/projection, stable geometry, overlay and
empty hint now come from `generate-sidebar-drag140.mjs`, with source hashes in
`loom/sidebar-drag.provenance.json`. Never restore the simplified local sortable
substitute or disable an entire row because its source group uses recent/az:
native policy governs valid destinations. Section IDs and list-drop-zone IDs
must remain distinct. Native visibility reveals empty destinations while dragging
and retains the source zone. Loom binds IDs and the existing WriteIntent/Kernel
preference owner; pending presentation is transient, rolls back on refusal and
never grants another write queue. A pending status line must not shift the list.
Use the real-mouse `sidebar-drag` browser slice, including both Channels and DMs.

## Reading map

- Current documentation index: `docs/README.md`.
- Target contract: `docs/evo/target-contract.zh-CN.md`; current main state,
  contract deviations and open items: `docs/evo/status.zh-CN.md`; paid and
  real-CLI runs: `docs/evo/paid-runs.zh-CN.md`; construction history (sections
  1–65, cited as "status §N"): `docs/evo/log/status-history-2026-09.zh-CN.md`;
  efficiency gate: `docs/design/cli-efficiency-gate.zh-CN.md`.

Main-baseline references (valid unless superseded by the evo documents):

- Product/ownership: `docs/architecture/room-first-core.zh-CN.md`,
  `docs/architecture/core-sdk-boundary.zh-CN.md`.
- Delivery/execution: `docs/architecture/delivery-and-activation.zh-CN.md`,
  `docs/architecture/runtime-adapter-and-observation.zh-CN.md`.
- Client/deployment: `docs/architecture/client-daemon-and-deployment.zh-CN.md`,
  `docs/architecture/frontend-platform.zh-CN.md`.
- UI integration: `docs/architecture/raft-ui-product-integration.zh-CN.md`,
  `docs/product/raft-frontend-local-contract.zh-CN.md`.
- UI library: `docs/design/neo-brutalist-ui.md` and
  `docs/adr/0028-owned-neo-brutalist-ui-library.md`.
- Upstream reuse history: `docs/audits/2026-08-29-raft-multica-reuse-ledger.zh-CN.md`.
- Memory (current isolated baseline): `docs/product/agent-memory-raft-baseline.zh-CN.md`.
- Task intent/ownership: `docs/adr/0020-task-intent-single-owner-and-secondary-roles.md`.

Dated audits specify evidence and limits at that revision, not current
completion. Resolve contradictions against code and recent evidence explicitly.

Keep current-state summaries separate from construction history. Append detailed
runs to dated evidence, not to the documentation index or an ever-growing status
page. The verbatim pre-cleanup index and status are retained as
`docs/history-index-2026-10-27.md` and
`docs/evo/status-history-through-2026-10-27.zh-CN.md`; their "current" and "next"
wording is historical, not a new backlog. Never erase failed gates, unknown usage,
upstream provenance or compatibility fixtures to make the repository look clean.
Retired-path mentions in retirement tests enforce absence and must remain.

## Product boundary

Scope is one Human with multiple instances on the local Mac. Multi-Human
features and nonmember public-Channel parity are a future optional project, not
blockers (`docs/product/single-human-mainline-and-multi-human-backlog.zh-CN.md`).
Preserve authentication, membership/execution fences and memory isolation.

RAH-managed third-party MCP connection/catalog/assignment/call management is excluded by the user. Do not restore its Settings or Agent tabs, API, executor configuration or runtime proxy. Preserve provider-owned CLI tools and Room Worker communication; keep historical database compatibility. See `docs/product/managed-mcp-retirement.zh-CN.md`.

Loom is room-first. The durable Room ledger, Inbox, Task, Activation, Artifact, Review, and RunAttempt state are authoritative. Provider sessions, transcripts, JSONL, PTY screens, stdout, thinking, and tool streams are diagnostics only.

The permanent causal chain is:

```text
Room event -> Inbox item -> Activation -> AgentHost lease -> RunAttempt -> explicit Room action
```

WebSocket/SSE notifications are hints. They may be duplicated or lost. Reconnection must recover from durable state.

MCP and CLI are facades over the same application service. They are used after an agent is activated; an LLM tool-call loop must never own notification delivery or long-term waiting.

Loom is a local-first multi-Agent platform: single-Mac Core/daemon/runtime
first, secure LAN access, future direct remote-Computer extension; no Raft
central account, billing or relay. Local deployment keeps authentication, ACL,
causal barriers and execution fencing. Users install and authenticate their own
Codex/Claude/Kimi/OpenCode/Pi/Antigravity CLIs; Loom discovers, invokes and manages them but
never installs them or configures their accounts.

## Role / Instance / Session / Channel

- **Role** is configuration, not an entity: CLI + model + effort + prompt +
  skills and optional launch environment, with a stable Role ID. Every save creates an immutable Revision.
  Owner 2026-10-29 separates `description` (display-only remarks) from the
  executable `instructions` prompt. Description and prompt each have a pencil;
  both open the same editor and use native Dialog initialFocus for the selected
  input. Both fields still save in one revision; remarks never enter standing prompts. Empty remarks display the
  verified model/effort as a grey fallback/placeholder and never save that fallback.
  The Role sidebar retains official avatar/name/subtitle/runtime anatomy; CLI
  labels come from verified Host offers, never parsed opaque offer IDs.
  Sidebar labels use Codex/Claude/Kimi/OpenCode/Agy/Pi; keep full runtime names
  elsewhere. New npm list-cell geometry differs from the live Web 1.21.38 sidebar.
  Role sidebar alone uses the locked `role-sidebar-2026-10-30` horizontal port:
  8px outer inset, row content at17.5px (8+8+1.5px original real border), section
  and Computer group at16px. The generator owns the compatibility style slot;
  never add a second shared Frame inset or change the npm recipes globally.
  Active/deleted Role sections collapse independently and persist per workspace
  in the existing device UI-preference layer; this is not business state.
  Role `instructions` may be empty; create/revise/instantiate and the editor must
  preserve an empty prompt without manufacturing instructions.
  New Role avatars are sampled once and stored after idempotency replay; never
  randomize existing Roles on read/restart. Owner 2026-10-30 replaces the
  Pokémon selectable/random pool with the complete Web1.21.40 native catalog:
  72 original 8x8 sprites in nine native series, exact palette/order/Chinese
  labels. The two reserved originals remain excluded. Data is reproducibly read
  from the whole pinned release by `scripts/official-web/generate-official-avatars.mjs`,
  not hand-drawn or copied from an older catalog. `loom/avatars/official.json`
  owns frontend art; generated Protocol keys own identity validation/allocation.
  Existing 539 PNGs and older 32x32 artwork remain read compatibility for stored
  Roles, frozen instances/history only; they are not selectable or randomized.
  Never rewrite revisions to replace artwork. The picker uses native series,
  tiles and 4/8-column rules without Pokémon search/pagination. The avatar editor
  forwards AgentProfileEditDialog's native `max-w-lg` policy (512px desktop);
  retain one scrolling DialogBody and its sibling DialogFooter. Never put the
  footer inside the scrolling body or inherit the primitive's 448px default.
  Phone width/90dvh remain owned by the native sheet recipe. This owner-requested
  catalog switch does not certify the pending whole-Web business adapter.
  Owner follow-up: automatic creation and the explicit random-avatar action
  exclude the distinct current avatars of active Roles in the same workspace;
  `availableAgentAvatarKeys` is the shared pool rule. Kernel chooses within the
  creation transaction, after replay; creation forms must not preselect a key.
  Manual selection still exposes all72 and allows duplicates. When the entire
  pool is occupied, recycle the complete pool as owner requested. An unsaved
  draft must not trigger this fallback early. Existing/deleted revisions and
  instances are never rewritten or counted as additional active Role choices.
  The native upload tile uses the existing authenticated profile-image transport
  (JPEG/PNG/GIF/WebP,5MiB). Store an uploaded identity key in configuration and
  carry `avatarUploadIntentId` separately on Role create/revise; consume it in
  the same transaction. All immutable Role revisions retain image GC references.
  Resolve keys to same-origin URLs only at the resource adapter. Selecting or
  uploading an image is a draft; only Save creates the revision. Cancelled
  unreferenced uploads use the existing lifecycle owner, not a second cleanup job.
  Runtime info uses the independently pinned official badge/card/mobile-sheet
  composition. Its status square reports Host CLI detection, not account health.
  Version/path/model count/probe time come from inventory; quota remains unknown
  until an actual account-usage owner publishes it. Never infer balance from
  installation, authentication guesses, transcript totals or model catalogs.
  Runtime Fast uses the selected model's published service tier (including
  Codex priority and Claude supportsFastMode); never infer it from the CLI name
  or silently switch models. Default mode overrides inherited native Fast
  settings per launch, without editing user CLI configuration.
  Kimi K3.1 Pro's verified ordinary/Highspeed pair is an explicit UI exception:
  one model and a Fast checkbox resolve to two real published model binding IDs,
  both with default service tier. Never invent a native Fast parameter or fold
  unrelated highspeed suffixes (K2.8/K2.7 differ). Missing counterparts stay
  exact separate model choices; editing never mutates frozen instances.
  Launch environment belongs to that revision and the frozen instance definition;
  it must not write global runtime settings. Reuse RuntimeLaunchEnvironmentSchema
  and preserve protected environment keys at both save and launch boundaries.
  Active names are unique within a workspace (case/NFKC normalized); renaming
  preserves the ID and deletion/recreation gives a new ID. Deleting configuration
  retains existing instances and snapshots. Human restoration (owner 2026-10-22)
  preserves Role ID, creates a new revision and requires a unique active name;
  it never merges a replacement Role or changes existing instances. Editing a Role never changes existing
  instances; they show as out of date.
- **Instance** is a Channel member and principal (Instance ID) with a frozen
  Role Revision snapshot; one Role may have several instances per Channel. It
  uses a readable Role-name suffix as both display and mention name. Existing
  instances retain their names and configuration. It may switch model/effort
  natively; switching CLI requires the owner-approved explicit session restart
  with a chosen current Role Revision (target contract §2). The default retains
  actual current configuration, including native overrides; adopting requires
  no live run, unresolved cleanup or leased/reserved execution. Ordinary service
  restart never changes configuration.
  Removal stops delivery, safely
  ends execution and keeps history; re-adding creates a new instance.
- **Permanent Channel deletion** (owner 2026-10-28) stops and removes its
  instances, private conversations, Side rooms and canonical history, while
  retaining reusable Role configurations. Reuse durable instance deletion and
  require actual execution termination before erasure; pending stops do not prove
  deletion. There is no reserved/global `#all` or automatically seeded channel;
  each instance belongs only to its chosen Channel. No system-channel settings,
  greeting toggle or unused UI extraction may be reintroduced. Historical visibility
  columns and receipt readers are compatibility fences, not feature entry points.
  Keep deletion receipts, backups and channel home
  directories. This differs from removing an instance alone, which keeps history.
- **Session** is the instance's native CLI session. Each instance has its own
  execution lane and one continuous session that is never silently replaced and
  never auto-rotated by task, turn count or tokens.
- **Channel** is the collaboration record and message box; its members are
  instances, not Roles. A Channel owns one platform-created home directory (the
  CLI cwd and default artifact directory of its instances, private box
  included) plus optional Human-attached directories, both fixed at creation
  (owner approved 2026-09-26). Owner 2026-10-29: creation uses official name/description/optional
  member fields plus the existing folder-tree chooser; no manual path textarea.
  Selected Roles create new instances after confirmed Channel creation, through
  the existing causal/idempotent write owner. Unknown results must be verified
  before continuing; partial member failure never recreates the Channel.
  Channel public/private controls and badges are omitted for the single-Human UI;
  historical visibility, authentication, membership and instance-private isolation stay.
  Platform memory is shared per Channel and never
  materialized as instance or Channel files (contract §4, "Memory boundary").
  Channels created before the home directory keep their instances' private cwds.

Native subagents are permitted as internal execution of their parent instance
(owner approved 2026-10-12; target contract §2). The continuous session is the
main session; child sessions do not become Channel members or replace it.
Parent authority, responsibility, lifecycle and total usage cover its child
work. Match subagent capability policy across benchmark arms; actual fan-out
may differ. Count descendants without double-counting provider aggregates,
retain unknown coverage, and apply batch model and automatic-memory rules to
child work. Internal delegation cannot substitute for an explicitly requested
peer instance's participation. This does not authorize native schedulers or
new independent instance lanes.

Instances run in parallel; each has one serial lane. A Channel `@instance` is a
public directed request; when a Human message's canonical @ names enabled
instance members, only those are woken (message-level set; no such @
broadcasts; `@all`/`@所有人` broadcasts for Human and instance authors alike), and a woken instance reads the delta for channel posts, followed threads and
explicitly delivered targets, using independent target positions (contract §3,
owner ruling 2026-10-02). Unfollowed Task bodies are not automatic catch-up;
explicit history reads retain Channel membership permissions. The private box shares the instance session (so it
affects later context), queues while busy, never steers Channel work and is
invisible to other instances. Only Human messages steer; other instances'
replies are read when idle. A unique, actually delivered top-level peer request
may receive one Kernel-derived final reply return without a repeated @ (contract
§3, owner 2026-10-12). It uses the existing Inbox/lane/chain guard; automatic
returns do not grant another automatic return. A request mentioning several
instances is outside this automatic-return slice: its replies must explicitly
address the requester. Native-final guidance must state that boundary, and use
plain names for status-only references to avoid unintended wakes. Ambiguous origins, threads,
private boxes and attachments retain explicit addressing. The legacy persona-Agent path is being removed from
the evo backend; old data is not migrated. A new data home seeds no persona
Agent, and every Kernel unconditionally creates no Inbox item or Activation
for a persona Agent (an Agent definition that is not a Role instance). Phase-4
close-out removed `POST /v3/client/agents/provision`, its SDK operation and the
optional scheduling switch; low-level historical provisioning and the protocol
configuration schema remain for compatibility and Role creation.

Loom builds only the Channel foundation, never scenario-specific features: users
reach discussion, collaborative development, planned tasks and similar goals by
talking with instances in a Channel (owner ruling 2026-09-26). Do not add
per-scenario workflows, roles, prompts or endpoints.

The remote-Computer mechanism (Computer protocol, k-carrier, remote AgentHost
control, release/upgrade) is frozen and kept, not deleted (owner ruling
2026-09-27): it is the planned basis for OAuth account-pool load balancing and
single-machine multi-container deployments of several CLI subscriptions. It is
outside current review scope; do not extend or remove it.

## Vertical MVP first

Build the smallest usable end-to-end business flow before broadening
subsystems. Each slice is a complete working path; do not complete identity,
lifecycle, memory, provider and UI layers horizontally first. Record rare edge
cases explicitly with triggers and limitations and defer them; do not build
disabled APIs or large frameworks in anticipation. Authentication,
channel/instance isolation, idempotency and preservation of existing data remain
necessary MVP behavior. Tests establish the vertical workflow and critical
invariants, not hypothetical completeness.

Phase-3 slice order (contract §8): S1 per-turn efficiency -> S2 session
lifecycle plus usage/context/compaction visibility -> S3 private box gaps -> S4
fork -> S5 side -> S6 platform memory. The owner approved implementing S6
before S4/S5; the owner has now authorized a narrow phase-4 UI slice after close-out
acceptance (2026-10-02), and authorized S4/S5 implementation on 2026-10-13.
The first OpenCode Fork/Side slices used the console; provider coverage and
remaining lifecycle limits are recorded in status. The console was retired after product UI replacements (contract §8). Each slice: tests first, implementation, visible in the product UI,
commit and push to `evo`. After S1, measure against contract §6; if far from
target, stop and re-evaluate the architecture.

## Backend MVP freeze

The owner froze the local single-Human backend MVP on 2026-10-14, at
`milestone-evo-backend-mvp-2026-10-14`. Evidence and retained limits are in
[the freeze record](docs/evo/evidence/2026-10-14-backend-freeze/summary.json).
Backend maintenance is limited to reproduced defects, regressions,
security/data-integrity issues and necessary compatibility fixes. New backend
capabilities, architecture changes or exploratory optimization require a new
owner request. Do not restart open-ended audits or cost experiments merely to
improve a single sample's ratio. The target contract and unresolved evidence
limits remain intact; freezing the MVP neither enables unreleased paths nor
turns skipped or failed gates into acceptance.

## TDD is mandatory

For every behavior change:

1. Add or change a test that describes the externally observable invariant.
2. Run it and confirm the intended failure.
3. Add the smallest implementation that makes it pass.
4. Refactor only while the complete suite stays green.

Bug fixes require a reproducing test. Do not weaken assertions to accept the implementation.
Unit and integration tests use fake clocks, temporary databases, and fake runtime adapters. Real paid CLIs are opt-in release gates, never the default test suite. Gates use only the approved models below.

### Authorized paid CLI gate models

The owner authorized exactly these combinations for the opt-in real-CLI gates
(efficiency and drift). `scripts/cli-efficiency/approved-models.mjs` is the
single machine-checked copy: both gates refuse any other combination at
configuration time, before any provider process starts, and every guard then
asserts the exact catalog binding id and reasoning level and fails rather than
silently substituting another model. Change the table and that module together,
and only with owner approval.

| CLI         | Model binding id               | Reasoning | Approved   |
| ----------- | ------------------------------ | --------- | ---------- |
| Claude Code | `sonnet`                       | `low`     | 2026-09-09 |
| Claude Code | `haiku`                        | none      | 2026-09-25 |
| Codex       | `gpt-5.6-luna`                 | `low`     | 2026-09-09 |
| Codex       | `gpt-6-luna`                   | `low`     | 2026-09-25 |
| Codex       | `gpt-6-sol`                    | `low`     | 2026-10-03 |
| Codex       | `gpt-6-astra`                  | `low`     | 2026-10-03 |
| OpenCode    | `deepseek/deepseek-v4-flash`   | `low`     | 2026-09-09 |
| OpenCode    | `deepseek/deepseek-flash`      | `low`     | 2026-09-25 |
| OpenCode    | `aihubmix/deepseek-v4.1-flash` | `low`     | 2026-09-30 |
| Kimi CLI    | `kimi-code/kimi-for-coding`    | `low`     | 2026-10-28 |
| Kimi CLI    | `kimi-code/k3`                 | `high`    | 2026-09-09 |
| Kimi CLI    | `kimi-code/k3-256k`            | `low`     | 2026-09-25 |
| Pi          | `aihubmix/deepseek-v4.1-flash` | `low`     | 2026-10-10 |
| Pi          | `magpie/kimi-code-cn/k3.1-pro` | `low`     | 2026-10-28 |

The 2026-10-03 additions are owner-approved for the Loom advantage discussion test.

Owner 2026-10-28 additionally approved Claude CLI `sonnet`/`low` routed to
`kimi-code-cn/k3.1-pro[1m]` for the current comparison batch. This requires the
explicit gate route selection and exact resolved-model checks in
`scripts/cli-efficiency/claude-route.mjs`; it is reported as Claude CLI / Kimi,
never as Claude Sonnet. The ordinary Sonnet family fence remains unchanged.

Binding ids are the ones the installed CLIs actually publish (verified with
`probeLocalModelCatalog`); do not invent version-suffixed ids. The Claude Code
catalog publishes unversioned `sonnet` and `haiku` bindings, so the concrete
release is whatever that install resolves; `haiku` publishes no effort levels
and runs with none. The installed OpenCode catalog no longer publishes
`deepseek/deepseek-v4-flash`; `deepseek/deepseek-flash` (DeepSeek V4.1 Flash)
replaces it, and the old row stays approved but fails the catalog check before
any paid call. Never run Fable, GPT-5.6 Ultra or any `max`/`ultra` level in a
gate.

This authorization covers the model matrix for gates only; each paid run batch
still needs explicit owner authorization. Commit/push rules are in "Verification
and evidence".

Owner 2026-10-28 authorized a bounded collaboration revalidation using Codex
`gpt-6-luna`/low, OpenCode `deepseek/deepseek-flash`/low (catalog: DeepSeek
V4.1 Flash 1017), Kimi `kimi-code/kimi-for-coding`/low (K2.8 Preview), and
AGY `gemini-3.8-flash-low`/low. AGY is admitted only to this functional batch,
not the efficiency gate: automatic-memory isolation remains unverified.

## Antigravity runtime boundary

AGY UI groups published effort variants into one model choice with a dependent
effort control. Selection labels are transient form values; every Role write
resolves back to the exact Host-published binding plus its matching effort.
Never send a grouped base ID/label to the CLI or rewrite an existing snapshot.
Unknown/inconsistent catalogs stay separate; native runtime-form rendering and
state transitions remain upstream-owned. Kimi discovery reads its native local
catalog: login/refresh first; the daemon's registered inventory requires a safe
restart to rescan (`restartRequiredToRescan`), not just a Role-list refresh.

Owner authorized AGY integration on 2026-10-27. AGY is a native runtime below
Loom, not a replacement orchestrator: `agy-print-json/v1` uses the existing
Role/Instance/Channel, provider-session store and WorkerFinalOutput owners.
Discover models from `agy models`, resume only the exact bound `--conversation`,
and fail closed on session/model mismatch or incomplete final evidence.
Count per-step usage once; AGY result usage/turn count/duration can be cumulative
across the conversation. Do not use those totals as per-turn measurements.
No native Fast/Fork/Side, benchmark automatic-memory isolation or complete
subagent/compaction accounting is claimed. See
[AGY intake and evidence](docs/evo/evidence/2026-10-27-agy-runtime/README.md).

## Ownership rules

- `packages/protocol` owns public commands, events, schemas, identities, and validation.
- `packages/kernel` owns transactions, projections, Room sequencing, Inbox, Activation, cursors, leases, and Outbox.
- `packages/agent-host` owns runtime discovery, start/resume/cancel/reap, process groups, heartbeat, and orphan cleanup.
- `packages/core` composes the headless Core; `packages/daemon` composes startup,
  shutdown and local services, without duplicating domain handlers.
- `packages/application-service` and `packages/client-sdk` expose authenticated,
  typed facades; `packages/client-core` owns ordered client reconciliation,
  causal command barriers and bounded in-memory projections.
- `frontends/raft` owns official-source presentation and route composition,
  not Provider parsing. The official `raft-ui` dependency owns shared primitives.
  The old reconstructed UI packages are retired; history remains in Git.
  Build, runtime and maintenance must not require a sibling `raft-ui` tree.
- UI and transports consume these owners; they do not recreate business state.
- Shared Web UI remains browser-safe. Desktop IPC/native bridges implement the same client contract and never create a second command handler.
- Room Kernel service and AgentHost daemon remain logically independent from every window or renderer lifecycle, even when packaged together.

Before adding state or behavior, name its single owner. Do not create a second queue, cursor, or task state in an adapter or client.

## Non-negotiable invariants

- Every accepted mutation atomically updates its projection, appends one Room event, and records any Outbox work.
- Room sequence numbers are monotonic within a Room.
- Actor identity comes from authenticated context, never an arbitrary tool argument.
- Idempotency keys prevent duplicate events and all derived Inbox/Activation effects.
- Business mutations carry `basedOnRoomSeq`; relevant newer facts trigger a stale-context hold instead of a silent stale write. Ordinary undirected peer chat may append under contract §3 (owner 2026-10-12); this never advances unread positions or weakens state-mutation fences.
- A wake hint, process spawn, PTY write, RPC response, or exit code never proves that an agent read or completed work.
- Completing an Activation requires the assigned runtime consumer to acknowledge Room delivery through that Activation's `toSeq`; it still does not acknowledge Inbox or complete a Task. A never-started duplicate message notification may instead be cancelled with exact same-instance/Room/session-generation consumption proof from a successfully completed Run; this is not a synthetic completion or ACK. See `docs/evo/read-covered-activation-plan.zh-CN.md`.
- One Instance (participant) has at most one active execution lane. New events while busy produce or extend durable follow-up work.
- Task completion is explicit and independent from RunAttempt termination.
- RunAttempt records actual runtime execution and exit provenance; retrying or completing an Activation never rewrites a finished RunAttempt.
- Provider session IDs are opaque metadata and never reconstruct Room history.
- Provider adapters and runtime plugins may emit diagnostics, but must not own or infer business status, Task transitions, Inbox acknowledgement, or durable memory promotion.
- Private file memory is distinct from canonical Room history; a provider
  transcript or model summary never automatically becomes either one.
- Unknown provider output stays diagnostic; do not expand the canonical protocol merely to mirror it.

Task is explicit durable work, not a prerequisite for tools or code changes.
A Channel's Human-managed `allowInstanceTaskCreation` defaults to false:
instances suggest work in ordinary messages and Human creates/converts Tasks.
When enabled, instances may autonomously create/convert Tasks; this accepts
misclassification risk and does not expand work authorization. Existing open
Tasks may always be claimed under the usual single-owner and execution fences.
There is no proposal queue or semantic authorizer. Preserve existing Tasks and
exact successful idempotent replays when the switch changes. CLI exit or a
collaborator reply does not complete a Task. See target contract §3a.

## Native-CLI benchmark

The native CLI running the same session, model and effort is the efficiency
baseline. Native controls must disable provider-owned automatic memory on
every initial/resume launch; unverifiable disablement blocks the benchmark.
Normal same-session conversation history remains enabled. The budgets and their measurement rules live only in contract §6;
do not restate the numbers elsewhere. Per-turn usage, context-window occupancy
and compaction count are shown per instance; data a CLI does not provide is
shown as unknown, never estimated.

Benchmark reply transport is part of experiment identity. The efficiency runner
requires `RAH_EFFICIENCY_REPLY_TRANSPORT=native-final` to measure Host-bound
final text; omitted means the legacy Worker reply path. It clears unrelated
final-output switches and records the selection in the baseline hash. Never
compare these modes as if only the code revision changed, or infer the deployed
service selection from library defaults. Codex warm native text uses
`LOOM_CODEX_NATIVE_FINAL_TRIAL`; Kimi uses `LOOM_KIMI_NATIVE_FINAL_TRIAL`.
Native-final selection must not also advertise the competing reply MCP tool;
retain Worker CLI fallback for ineligible/multiple targets. Preserve original
session identity and require successful current delivery registration plus
verified native terminal evidence before Host publication.

Owner 2026-10-28 promoted reviewed native-final entries to product-daemon
defaults in source/Node deployments: warm Codex/Claude/OpenCode and cold
Kimi/Pi; AGY keeps its existing native protocol. Selection belongs only to
`packages/daemon/src/reply-transport-policy.ts`. Explicit cold configuration and
exact launch switches retain rollback; older structured-final experiments stay
explicit and mutually exclusive with native-final. Do not promote cold Codex
exec, unknown entries, low-level adapter defaults, remote Computer wiring or SEA
packaging implicitly. Provider session identity and all publication fences stay
unchanged. Benchmark arms still write explicit switches, independently of these
product defaults. See [defaults, upgrade and rollback](docs/evo/native-final-defaults.zh-CN.md).

Raft source is reference only, not the default port source; keep the verified
ledger, authentication, idempotency and execution-fence foundations. Rules code
can enforce must not live in prompts; exception guidance appears only on error.
Never regress a verified safety property to match upstream behavior.

When upstream code is actually copied or structurally ported, record upstream
version/URL/hash, source location, license/provenance, adopted behavior, local
changes and tests. Distinguish byte-exact reuse, structural port, local glue and
unfinished work. Do not label a rewrite as copied source. Preserve upstream
notices. Legacy `rah` code is not a default dependency.

## UI and interaction contract

Owner upgrade (2026-10-19): the product adopts the single Raft 0.6 design system,
not the retired Brutal/Elegant families. `frontends/raft/rui-resources.lock.json`
pins package, guides, styles and font provenance. `adoption.json` retains original
upstream hashes; `rui-v6-ports.json` separately records owner-authorized page
compatibility ports. Do not call these ports untouched/latest upstream pages.
Workspace-personal color themes are the official Raft theme IDs (owner requested
2026-10-26), persisted through Human sidebar preferences with version fences.
They are independent from device mode; never restore the retired Elegant family
or import upstream billing restrictions.
Mode selection is light/dark/system; migrate existing device mode without
restoring a family switch. The pinned native recipes own typography, radius,
borders, states and pointer targets. Earlier family-specific dimensions and
hard-shadow assertions are historical, superseded by this upgrade.

Owner ruling (2026-10-14): selective official-UI adoption may omit unsupported
features and their controls, but must preserve the retained surfaces' UI rules:
source dimensions/proportions, fonts/colors, hover/selected states, menu and
notification semantics, layering, and click/disclosure behavior. Read the
complete upstream composition chain (page, wrapper, component, recipe and
state parameters) before wiring data. Component reuse alone does not prove
parity. Record unsupported behavior explicitly; do not replace native gestures
or reshape retained components as a shortcut for missing backend bindings.

Owner decision (2026-10-14): replace the reconstructed product frontend with
the official Raft source as the phase-4 base. The initial source/build intake
lives in `frontends/raft`, isolated from production deployment until its Loom
paths pass acceptance. Preserve native layout and interactions; prefer data
replacement and renaming over new options or buttons. Keep Loom's SDK,
client-core and domain owners; upstream stores are not a second business truth.
The owner subsequently required immediate removal of the old reconstructed
source; the temporary backend console was subsequently retired after replacement acceptance.
Existing deployed immutable assets are not deleted by source retirement. Source provenance and
current limits are recorded in `frontends/raft/adoption.json` and
`docs/evo/evidence/2026-10-14-official-frontend-intake/summary.json`.

Current `main` uses the official-source replacement described above.
References to reconstructed UI implementation apply only to the retired
pre-promotion baseline, never to current Loom or the imported Chatbox.

Visual and functional parity are separate obligations. The behavior guide uses
`official trigger -> source component/parameters -> content/data source ->
close/keyboard/focus -> local frontend/backend owner -> bilateral result`. Each behavior needs a stable identity, source revision/location, conditions,
success/loading/empty/error/disabled states, async/stale-response rules and
explicit implementation/test status. An `onClick` count is not a function count;
neither an old reference fixture nor a visible tab proves product completeness.

- Extract CSS, icons, fonts, avatars and state parameters from authorized source
  evidence. Use the maintained internal tokens; label unavoidable approximations, never guess
  screenshot dimensions and call them extracted specifications.
- Agent choice-row colors follow component family and hover/current/selected states,
  not modal versus base-page placement. Follow the [UI color contract](docs/design/neo-brutalist-ui.md#agent-choice-row-colors):
  Raft's opaque soft-signal maps to local --yellow; local --soft-signal already has
  30% alpha. Do not add modal-wide hover overrides or apply opacity twice.
  On evo, preserve official raft-ui component styling and interaction states;
  the retired local ChoiceRow and its gates apply only to historical main.
- Web/PWA share components, intents and protocol. Responsive layout changes must
  not create a second business path. Native shells remain thin clients.
- Shell borders, splitters, overlay/focus and message measurement each have one
  owner; reconciliation preserves message identity, anchors, drafts, disclosure.
- Use shared tooltip/preview/popover/dialog/drawer primitives; verify hover,
  pointer exit, click, Escape, outside press, keyboard focus and focus return.
- Dialog action DOM order is secondary Cancel, then primary Save/Confirm/Delete,
  as in official ConfirmDialog/AgentProfileEditDialog. Native DialogFooter owns
  horizontal order and overflow stacking (primary above Cancel); do not reverse
  it with local CSS. Mobile DialogSheet forms keep native left Close/right
  DialogCommit instead of adding another footer. Inline/full-page editors follow
  their own upstream composition, not the modal rule. Run
  `node --test scripts/official-web/dialog-action-order.test.mjs` after changing
  dialog actions; the source inventory is a guard, not rendered-state parity.
- Chat Agent name click inserts an `@` into the active composer; avatar hover
  shows a summary; avatar click opens the right inspector on Activity by default.
- Room/DM/Thread Enter sends, Shift+Enter inserts a newline, IME confirmation
  never sends. Pending/disabled/permission checks apply equally to keyboard and
  button submission. Do not impose this rule on unrelated form editors.
- Navigation unread dots, Computer connectivity, live presence and diagnostic
  event colors are different projections. Do not derive online state from PATH
  discovery or fabricate activity from chat text. Diagnostic tools/output remain
  separate from explicit Room messages.
- File browsing is authorized and root-scoped on AgentHost. A local browser/LAN
  client does not get arbitrary host filesystem access. A path is not a
  published Artifact, and listing a file does not prove attachment access.
- Long chat uses bounded pages, stable Message IDs and the existing virtual
  window/anchor owner. Do not load full history or persist transcripts in browser
  storage to disguise latency. API/business state is not a PWA shell cache.
- Missing backend capabilities stay explicitly unavailable with accurate labels;
  never connect an enabled production button to fixture success.

Current source upgrade (owner requested 2026-10-21): the official component package
is now `@botiverse/raft-ui`, pinned at `0.52.2` through npm alias `raft-ui`.
The obsolete unscoped package stopped at `0.6.0`; do not mistake that old
package version for the current official release. The package was upgraded on 2026-10-29 and patched to0.52.2 on2026-10-30; retained resource ports keep their individual provenance.
The 1.21.35 resource refresh is locked under `upstream/published-2026-10-28`,
not relabeled as newer original TSX. Prefer its exported primitives over local compatibility
recipes; keep existing owner-approved compact mobile exceptions explicit.

The selected official Web source dependency at
`frontends/raft/upstream/raft-web-source` is immutable upstream code, pinned by
`source-lock.json`. Do not edit its original files; keep Loom compatibility and
approved mobile exceptions in outer adapters. This selected closure is not the
whole official application or an upstream-published npm package. Compare it
directly with the next official checkout using `scripts/official-web/upstream-diff.mjs`,
then validate affected contracts. Follow its README for upgrades and keep the
canonical and legacy raft-ui imports bound to one runtime.

### Official dependency boundary and upgrade procedure

Follow [the dependency and upgrade contract](docs/design/official-dependency-migration.zh-CN.md)
and `frontends/raft/loom/dependency-migration.json`. Completion of the declared
migration plan is not proof that the entire official Web is an untouched library
or every Loom page is a thin adapter. Distinguish the official package, immutable
selected source, generated presentation, resource compatibility ports and retained
Loom composition. Never advertise whole-site/latest parity from hashes or the
migration-complete flag alone. Dated construction notes are historical, not new
backlogs; consult the current inventory before reopening migration work.

When the owner reports an upstream UI change:

1. Verify Web source, package and production-resource versions separately. Keep
   the existing pins and inspect an independently acquired candidate first.
2. Run `npm run audit:official-web:upstream -- /path/to/official-checkout`.
   Check candidate identity/dirty state and distinguish sourceDependency from
   historical intake rows. Exit 2 means local drift or missing paths need review;
   exit 0 is not UI acceptance. Missing paths do not prove missing product features.
3. Trace changed source/recipes through exports/generators to Loom consumers and
   registered scenarios. The report is byte-level, not an automatic semantic
   impact graph. Include shared style/font/responsive effects where applicable.
4. Update the relevant package/resource/source locks, preserve notices, regenerate
   affected presentation, and adapt explicit bindings only as needed. Never patch
   immutable originals or generated output by hand. Do not import upstream stores
   as a second business owner. Keep existing mobile exceptions explicit.
5. Apply TDD and scoped source/UI-contract/type/build and desktop/mobile browser
   checks to affected behavior; broaden only when shared changes justify it.
   Preserve the safe deployment and real-page verification requirements for
   product changes. Document/push the accepted version and its evidence.

If production resources lead published source, record that gap and retain the
verified version unless a separately sourced compatibility port is adopted under
the existing UI contract. Do not label a resource port latest official source or
recreate a screenshot to hide the gap. Tooling/document-only updates do not require
a product restart. Do not create a second `agent.md` rule file; this `AGENTS.md`
is the repository instruction entry point.

Owner mobile-navigation ruling (2026-10-26): mobile Web follows the confirmed
native-app information hierarchy: Home / Activity / Tasks / Search, plus the
More entry in the same bottom capsule. Members / Computers / Settings / Memory
share equal native destination cells in its upward popover. These are peer roots, not Home subpages. Use the pinned official
`raft-ui/wip` MobileNavServerPopover scenario; keep the approved compact touch
layout explicit. Touch narrow-screen Activity rows use the native focus-only direct action
recipe: visual completion is by swipe with bounded undo; keyboard focus can
reveal the accessible action. Desktop hover completion remains unchanged. This is an owner-approved Web adaptation, not a claim of copied
native iOS source or multi-workspace support.

### Native mobile reference boundary

Mobile Web must be compared against both the pinned Web source and the selected
native reference at `frontends/raft/upstream/raft-mobile-source/source-lock.json`.
Use `scripts/official-web/audit-mobile-source.mjs` on an independent candidate;
verify immutable originals, retain notices, and trace semantic/layout changes.
This reference is not an executable Kotlin dependency or whole-App parity.
Prefer official Web scenario primitives; native-only interactions require
explicitly recorded browser adapters and focused gesture/cancel/keyboard tests.
Do not infer the owner's installed iOS release from repository HEAD. Keep native
and Web source versions and physical-device versus simulated evidence separate.

### Mandatory Raft UI layering (owner approved 2026-10-19)

For evo, adopt the official Raft UI rules as the implementation contract, not
merely a visual reference. This applies to all retained and new Loom surfaces,
including Loom-only features, loading/error states and mobile presentations.

- **Foundation owner: `raft-ui`.** Reuse its recipes/tokens for typography,
  size, color, border, shadow, focus, hover, selected, disabled and loading
  states. Do not invent per-page button/component specifications, duplicate
  the token system or introduce a parallel universal `LoomButton` framework.
- **Scenario owner: the official specialized component.** Before choosing a
  generic `Button`, inspect the corresponding official composition and use its
  scenario component and parameters: e.g. `CloseButton` for detail dismissal,
  `DialogClose`/`DrawerClose` for their containers, picker triggers for filters,
  field triggers for forms, and dedicated message/composer controls. Importing
  `raft-ui` alone does not establish conformity. An X used to clear a filter,
  a mobile back arrow and a detail close action are different semantics.
- **Page owner: composition and Loom data binding.** Pages wire data, authority,
  state and events while preserving the official spacing, borders, responsive
  layout and interaction rules. Match the complete page/wrapper/component/
  recipe chain, including state parameters; do not style each callsite in
  isolation or replace native controls with ad hoc HTML/CSS.
- **Loom-only features and exceptions.** First map the feature to an existing
  official scenario. If none fits, use a thin composition of official
  primitives and document its semantic scope, source references and local
  differences. Record intentional overrides (including approved compact mobile
  adaptations) with their reason, owner and focused evidence. Do not silently
  extend an exception to unrelated controls. New deviations from retained
  official UI rules require owner approval; routine compliant reuse does not.
- **Enforcement.** For a changed control, identify its functional role, source
  component/revision and parameters, local binding, applicable exception and
  focused regression evidence. Guard established mappings against drift and
  review unexplained size/style overrides. Verify actual rendered DOM, focus,
  disabled behavior and pointer hit areas at the affected viewports; CSS text
  or screenshots alone do not prove an enlarged touch target works. Avoid
  selectors that infer control semantics from incidental SVG/span nesting.
  Keep verification proportional to the change under the existing scope rules.
- **Do not flatten legitimate differences.** Official defaults are defined
  behavior, not automatically defects. Native disclosure/tree buttons and
  quiet actions can be intentional. Do not bulk-convert all buttons to one
  size, all `ghost` variants to `outline`, or all close affordances to the same
  component without checking their scenario contract.

Maintain the [adoption rules](docs/design/raft-ui-adoption-contract.zh-CN.md)
and [scenario registry](frontends/raft/loom/ui-contract.json) when bindings or
intentional exceptions change. Run `npm run test:official-web:ui-contract` for
affected controls; this guard is also included in the existing source checks.

The [2026-10-19 button audit](docs/evo/evidence/2026-10-19-button-audit/review.zh-CN.md)
records source evidence and known gaps at that revision; it is not proof that
every current control conforms. Consult the current adopted source/package
versions, not an independently copied table of dimensions.

## Memory boundary

Target and decided semantics: contract §4 (owner-approved 2026-09-26/27).
Platform-managed long-term memory whose lifecycle is independent of instances
and sessions; Role/model/session/Channel/time are automatic provenance
metadata. Provenance proves authorship, not correctness.

Current S6 state (status table, history §48–§54 and §63): Role instances use
Kernel channel memory. Scope is the Channel; entries written from an instance's
private box also belong to the Channel's shared memory, not private memory.
Writes happen only through explicit Worker tools (`memory write/update`) or
owner-approved Human edits of existing entries (2026-10-16, description/body
only, channel-manager permission, expectedRevision and Human provenance); the
platform never extracts memory from conversations or transcripts and never
materializes it as files. Mutations return receipts only; bodies,
descriptions and provenance come only through reads gated by the read switch.
Update/invalidate/restore/delete carry `expectedRevision`; instances and the
Human may invalidate/restore, only the Human (channel manager) deletes, and
deletion clears bodies, descriptions and earlier reasons from online reads but
does not scrub provider sessions, diagnostics, backups or SQLite residue. Read
and write switches default per Channel with per-member overrides, enforced by
the Kernel on the authenticated Worker path. New sessions receive a light index
(3 KiB, pinned first) plus per-turn deltas; bodies are read on demand. Side
sessions derive their read-only authority from Kernel provenance, never a
client-supplied mode. Source read switches apply; Side may reply only inside
its own private conversation. Current provider/lifecycle coverage is in status (S5).

The per-instance `MEMORY.md` plus `notes/` is no longer loaded or materialized
for Role instances; old directories stay read-only and can be imported only by
an explicit Human `memory.import.legacy`. That path remains only for the legacy
persona Agent, which is being removed; do not extend it. Not strong isolation:
CLIs run full-access under the same UID and could read the database directly.
Turning reading off does not recall an index already delivered into a session.
A materialization or delivery receipt proves transport, not that a model read
it. Prompt-only requests cannot be advertised as enforced isolation.
Reset/restart honors the existing fence and active-work checks.

## Verification and evidence

Design/compare first, then TDD. Preserve existing user changes; do not widen
source-size ratchets merely to add code. Follow
`docs/architecture/core-module-boundaries.zh-CN.md` where it still applies.

Separate these claims in reports: code implemented; automated checks passed;
console/API verification passed; real CLI work passed; efficiency gate met
budgets; local service deployment verified. None implies the next.

Use temporary state, ports and fake providers for deterministic tests; label
fixture URLs and Fake CLI replies unmistakably and never hand one to the user as
the product. Real-provider acceptance is opt-in, narrowly scoped and records
actual model/effort/results. Never use GPT-5.6 Ultra for tests.

After a Codex update, verify the exact installed executable's native tool host
with a free localhost fake-model execution that actually reads a unique fixture
through the intended launch path before starting paid work. macOS may require
fresh approval to open the downloaded `codex-code-mode-host` (owner confirmed
2026-10-28). A version/catalog probe, `--help`, or exit 0 is insufficient. If
approval is pending, stop before paid calls and resolve that prompt; do not
misdiagnose it as Loom scheduling failure, disable the host as a shell fallback,
or remove quarantine/security protections. Preserve failed samples and costs.
The shared gate daemon and native Codex runner enforce this via
`scripts/cli-efficiency/codex-tool-preflight.mjs` (localhost fake model, actual
file-read receipt, executable hashes). Custom paid runners must use the same
preflight; metadata-only checks are not substitutes. Validate all selected
model bindings before creating collaboration members, so catalog failures
remain preparation failures without SOS-resume wake pollution.

Before sending a Human opener in an automated collaboration run, use
`scripts/cli-efficiency/human-wake-preflight.mjs` with the current enabled-member
handles and the intended recipient set. It reuses canonical mention parsing:
literal peer mentions inside workflow instructions also wake those peers.
Use plain names for future steps; do not assume only the first @ is active.
Record setup mistakes and all consumed usage; repairing the launcher does not
retroactively pass the run or authorize an automatic replacement batch.

Run the opt-in efficiency gate (`docs/design/cli-efficiency-gate.zh-CN.md`) at
the end of S1, S2 and S6 and after meaningful scheduling, prompt/context,
memory-transport or provider-session batches before accepting performance.
Failures and excess costs stay visible; successful replies alone are not
efficiency acceptance.

Owner ruling (2026-10-15): verification must match the change's scope. Small
features and UI repairs must not trigger long, unrelated acceptance suites.

- For presentation-only changes and narrow frontend wiring, run the relevant
  regression tests, affected type checks/build, and focused browser checks
  (desktop and 390x844 with real pointer hit targets). Do not run the full
  backend suite or complete frontend browser suite by default.
- For backend changes, run tests for the changed owner and affected boundaries;
  reserve `npm run check` for milestones, broad cross-layer changes, or evidence
  of a regression that warrants it. Paid gates retain their separate approval.
- Check formatting of changed files and run `git diff --check`. Documentation-only
  edits need affected link, format and diff checks only.
- Report exactly what ran. Broaden verification only for a concrete unresolved
  risk or failure; do not repeat passing suites without a new reason.

Frontend changes still require `npm run build:web:workbench` and relevant browser
gates at the same measured viewport/DPR/zoom. Required safe deployment and real
page verification remain in force; none implies paid-CLI or efficiency acceptance.

Do not commit, push, publish, or run paid-provider tests unless the user
explicitly requests it. Exception: the owner has authorized the lead agent to
commit and push completed Loom slices to `main` routinely. Paid gates still need
explicit authorization per run batch.

## User-requested repair handoff

Every completed repair batch includes a restart of the evo local service
(launchd label `com.loom.evo`, with its own data home) before handoff; the old
formal workbench is retired. After required checks, inspect active work, back up
persistent state, gracefully stop the exact service instance and start it
against the verified build. Verify the new process and a fresh real page; health
alone is not acceptance. Keep Room history, Role/instance configuration and
private memory intact. If active work cannot be safely drained, report that
blocker instead of force-killing it. Never substitute a Fake CLI fixture for the
user-review URL. Data homes are path-bound (mount receipts store absolute
paths): never relocate one. The daemon instance lock at
`/tmp/rah-os-daemon-<uid>` is shared, so two daemons with the same hostId cannot
run. This instruction does not authorize paid-provider tests.

## Documentation and handoff

Write back documentation only when it changes (owner ruling 2026-09-27): when
a capability's state changes, rewrite the affected rows of the status table
(implemented / fake-verified / real-CLI / paid-gate verdict / uncovered, with
evidence links); after a restart, update the current-deployment line; after a
paid or real-CLI run, append it to `docs/evo/paid-runs.zh-CN.md`. Batches that
change none of these need no status or ledger edit. Change the target contract
only with owner approval. The status page stays a current-state page; do not
append history sections to it. Update owner documents/ADRs
together with changes to protocol, lifecycle, authority, memory policy,
deployment or release gates. Keep this guide durable: no live PIDs, private
credentials, signed attachment URLs, temporary ports or volatile pass counts.

Never announce a completion percentage from source callback counts; coverage
needs a deduplicated inventory with per-row evidence. Report frontend, backend
and verification gaps separately. Verify commit, push, deployment and restart
claims at handoff; a local commit does not mean pushed or deployed.

Ordinary reply freshness (owner 2026-10-12): same-Channel Role text messages,
including directed and broadcast peer messages, do not alone hold an in-flight
ordinary text reply. They retain delivery and follow-up obligations; unread
positions never advance on publication. Human facts, attachments and business
state mutations retain their causal barriers. See target contract §3.

## Adaptive mobile and large-screen acceptance

Owner ruling (2026-10-27): adopting official component primitives does not prove
responsive composition parity. Track the selected Raft Mobile layout sources in
`frontends/raft/upstream/raft-mobile-source/source-lock.json`; run
`scripts/official-web/audit-mobile-source.mjs` for byte and semantic layout diffs.
`frontends/raft/loom/native-adaptive-bindings.json` records actual consumer and
pending/partial status. Do not relabel source intake or a passing hash audit as a
completed runtime migration.

Navigation placement, typography/control density and single/dual/triple-pane
admission are separate policies. Native logical dp is not physical device pixels;
Web integration must use logical viewport and actual available content dimensions.
Never replace all md breakpoints or scale all UI to address tablet density.
Preserve the desktop official Web rules and explicit font-size preferences. For
adaptive changes include intermediate and boundary widths (767/768, 839/840,
1199/1200), phone, tablet portrait/landscape and desktop, plus continuous resizing.
Check draft, selection, scroll anchor and back navigation preservation. CSS viewport
emulation is not physical folding, pointer/keyboard capability or iOS acceptance.

Owner acceptance matrix (2026-10-27): retain classic portrait phone, unfolded
book-style foldable (iPhone Duo), fully unfolded tri-fold (Mate XT 2), and
11-inch tablet (iPad Pro), with both orientations for the latter three. Record
logical viewport, pointer/hover capability, font preference, sidebar state,
body rectangle and screenshots. Physical resolution divided by an assumed DPR
is only a probe, not a verified device viewport. Compare fixed typography and
scroll anchors before claiming visible-content gains. Audit generated CSS as
well as helper/source tests: after the product build run
`node --test scripts/official-web/adaptive-built-css.test.mjs`; equivalent rem
and px breakpoint syntax must preserve the same coarse/fine layout boundary.

Owner mobile typography boundary (2026-10-27): orientation-driven area
optimization must not change the selected message font or line height. The
approved coarse landscape primary-channel exception consolidates the global
48px bar into existing channel controls; it is local layout glue, not an
upstream parity claim. Its scope and exclusions are tested by
`scripts/official-web/landscape-conversation.test.ts`. Preserve notification,
search and return paths; do not generalize it to other routes without review.

## Herdr caller context through background runtimes

A tool subprocess may be launched by detached Codex app-server without inherited
`HERDR_*` variables even while the owning conversation runs in a Herdr pane.
Missing variables alone do not prove Herdr is unavailable. When the owner
confirms the conversation is inside Herdr, verify read-only service/pane metadata
and a recent command echo from the matching repository pane before acting. Use
the verified explicit pane/session IDs; never fabricate caller environment,
operate the UI-focused pane by default, or touch unrelated sessions. Preserve
Herdr's remaining lifecycle and ownership constraints.
