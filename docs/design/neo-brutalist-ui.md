# RAH Neo-Brutalist UI

RAH OS owns this library. It adopts authorized Raft assets and inspected behavior,
but the temporary `raft-ui` reconstruction is neither a dependency nor an absolute
standard. This is the maintained product, not an official Raft source distribution.
See [ADR 0028](../adr/0028-owned-neo-brutalist-ui-library.md).

## Start here

- [Library catalog](../../packages/ui-tokens/neo-brutalist-library.json): stable
  component/template IDs, source owners, behavior IDs and executable scenarios.
- [Visual resources](../../packages/ui-tokens/README.md): CSS, fonts, sprites,
  avatars and the distinction between immutable assets and editable source.
- [Components and templates](../../packages/ui-web/README.md): production imports
  and controlled composition examples.
- [Behavior registry](../product/ui-behavior-registry.json): the existing contract
  owner, including official evidence, applicability and local differences.

The catalog links these records; it does not create another business protocol.
The maintained catalog covers ten primitives and five composition templates.
It does **not** certify all pages, states, permissions or official parity.

## Visual grammar

Use semantic CSS variables from the library, not a second palette in a page.

| Family            | Contract                                                                       |
| ----------------- | ------------------------------------------------------------------------------ |
| Surfaces          | White reading surface, cream navigation, hard black boundaries                 |
| Accent            | Yellow rail/active tabs; pink selected navigation and primary actions          |
| Functional colors | Cyan runtime; lavender model/mention; orange warning; coral destructive action |
| Typography        | Packaged Space Grotesk and Space Mono; retain the quote-glyph fallback         |
| Edges             | Square controls, solid boundaries, hard offset shadows without blur            |
| Motion            | Explicit hover/press/focus/disabled rules; no data-reconciliation animation    |
| Layout            | Shared header tracks, single divider owners, bounded resizable panels          |

Colors are not business facts. Unread attention, Computer connectivity, Agent
presence and diagnostic events have separate existing data owners. Never derive
an Agent's status by choosing a convenient accent color.

CSS is authoritative for rendering values. Do not copy this table into constants.
Historical fallback tokens and extracted aliases still coexist; their consolidation
is recorded debt, not permission to add another override.

## Agent choice row colors

Choose colors by component family and interaction state, never by whether the
component is inside a modal, drawer, popover or base page. The
[source-backed matrix and counterexamples](../audits/2026-09-14-agent-choice-hover-contract.zh-CN.md)
are the current contract: member-add/create candidates use full yellow hover;
member browsing and property menus use 30%; autocomplete distinguishes the
current candidate from ordinary hover (including 50%). Task-modal assignee menus
remain 30%, and sidebar Agent search can become full yellow on pointer entry.

Raft's unqualified `soft-signal` is opaque `#FFD440`. Our historical
`--soft-signal` already contains 30% alpha. Use `--yellow` for opaque yellow and
`--soft-signal` for that existing 30% contract; derive other source-backed alpha
values from opaque `--yellow`. Never infer equivalence from token names or apply
alpha twice. Do not change the global alias to repair one component.

Treat hover, keyboard/pointer current candidate, selected membership and disabled
states separately. Pink 20% plus a checkmark belongs to the create-channel member
selection contract, not every Agent picker. Preserve shared component behavior
when nesting it in a dialog; do not add ancestor-modal hover overrides. New or
changed pickers must cite their source family and verify computed colors on
pointer entry/exit, selected rows and keyboard highlighting as applicable.

### Shared choice-state contract

Component differences do not authorize page-specific palettes. The reusable
contract has three layers: library-owned color values, explicit interaction
states, and a closed set of component profiles. This is a presentation contract,
not a new command/event in `packages/protocol`.

The color vocabulary is opaque yellow (`--yellow`), yellow at 30%
(`--soft-signal`), yellow at 50% (derived once from opaque yellow), and pink at
20% for the member-selection marker. These are the existing source-backed
recipes, not permission to choose arbitrary alpha values. Alpha is composited
over the actual surface; a sampled screenshot RGB must not replace that recipe.

| Profile            | Applicable interaction                         | Ordinary unselected hover | Current candidate                     | Committed selection                            |
| ------------------ | ---------------------------------------------- | ------------------------- | ------------------------------------- | ---------------------------------------------- |
| `member-selection` | Create/edit channel and add-member candidates  | Opaque yellow             | Follow the registered picker behavior | Create/edit members: pink 20% plus checkmark   |
| `member-browse`    | Existing member rows and identity navigation   | Yellow 30%                | No autocomplete current index         | Membership is data, not a selected-row color   |
| `property-option`  | Agent assignee and equivalent property options | Yellow 30%                | Shared menu highlight: yellow 30%     | Preserve the selected-value checkmark          |
| `autocomplete`     | Chat mention and sidebar conversation search   | Yellow 50%                | Opaque yellow                         | Accept the candidate using the existing action |

These profiles are exported by `ChoiceRow` in `ui-web/neo-brutalist/choice-row`.
`profile` is required. `current` is available only for autocomplete/property
options. Member selection explicitly opts into `selection="tint"` plus `selected`;
add-member checkboxes keep the default check-only marker. `as="div"` supports
member rows containing independent controls without nesting buttons.
The API excludes inline `style`; callers retain geometry classes and actions.

State rules are shared:

- `hover` means pointer presence; `current` identifies the keyboard/pointer
  navigation candidate; `selected` means the value already chosen. Keep them
  independent. Sidebar search promotes pointer entry to current, explaining
  opaque yellow without introducing a sidebar-specific color.
- In autocomplete, current wins over ordinary hover. In member multi-selection,
  the committed pink marker remains on hover. Property options retain their
  checkmark while the menu highlight changes. Do not create one universal
  selected/hover priority that erases these distinct meanings.
- Focus indication remains explicit and must not silently commit a selection.
  Disabled options cannot activate and must not gain enabled hover/current
  feedback. Pointer exit removes hover but does not erase a separately owned
  current or selected state.
- Moving the same component into a modal, drawer or page preserves its profile,
  state rules and values. Overlay dimming is a separate surface behavior.

New Agent choice surfaces must select an existing profile and reuse its owner;
pages supply data, state and actions, not color/alpha/hover-style overrides.
An additional profile requires a central contract update with a source-backed
reason and interaction tests; a new window is not itself such a reason.
`ui-tokens` owns rendering values, `ui-web` owns shared row presentation, and
the existing client/component controller continues to own current/selected
state. A visual row must not introduce another business-state owner.

Adopted callers: create-channel candidates, add-member candidates, Human/Agent
Room member browsing, shared DiscoveryFilter property/assignee options, and the
Room/DM/Thread/file-comment mention menu. Reaction options remain their separate
pink family. Agent directory navigation cards, ordinary conversation rows and
native `<select>` controls are not Agent choice rows and retain their own contracts.
There is currently no separate sidebar conversation autocomplete controller to
migrate; the shared autocomplete profile supports its source-backed current state.

`npm run check:ui-library` runs `ui-choice-contract.mjs`: it discovers ChoiceRow
consumers and their geometry classes, rejects inline styles/prop spreads/raw
profile attributes, and rejects local background/opacity/filter/custom-property
rules targeting those rows, including enclosing-container button rules. Layout
and child-icon rules remain permitted. `npm run test:ui:choice` verifies computed
colors in Chromium/Firefox at desktop and 390px widths, pointer exit, current,
selected, disabled, nested placement and the actual shared property picker.
The browser gate is also part of `npm run check`; broad global CSS must still be
reviewed and tested, not assumed safe solely because a static selector scan passes.
New picker work must use this API. Evidence and scope:
[code adoption](../audits/2026-09-14-choice-row-code-contract.zh-CN.md).

## Ownership and composition

Sidebar touch interaction follows the
[source-backed touch contract](../audits/2026-09-14-sidebar-touch-and-mobile-navigation.zh-CN.md).
Touch scrolls or opens the context menu on long press; it does not reorder rows
or groups. Mouse and keyboard sorting remain available regardless of viewport
width. Navigation labels and menus suppress native selection/callouts, while
inputs and message text remain selectable. ContextActions owns release-click
suppression after its existing library long press; do not introduce a second
timer or block all touchmove events. Desktop WebKit automation is not physical
iOS Safari/PWA acceptance.

1. Load `@rah-os/ui-tokens/neo-brutalist.css` once at the application boundary.
2. Import primitives from `@rah-os/ui-web/neo-brutalist/*`.
3. Pass labels, values, disabled/pending state and callbacks from the existing
   product owner. Components do not fetch, persist Room state or parse providers.
4. Pages retain composition and typed SDK/client-core integration. A template is
   a composition of the same components, not cloned HTML or simulated success.
5. Edit a migrated family's library owner and remove its obsolete page rule.
   Do not fix it with a late `!important`, duplicated selector or new theme.

Identity composition is owned by `apps/web/src/workspace-entities.ts` and its
application-boundary provider. Consumers resolve stable Human/Agent principal,
Agent definition, Computer and Runtime bindings there rather than joining names
or maintaining page-local copies. It is an authorized-input read model, not a
new backend truth. Missing ownership/creator facts stay unknown. See the
[staged identity closure plan](./ui-entity-network-closure.md).

The status-dot primitive owns its complete shape/state even without a parent
page class. The library gate rejects unresolved CSS variable names; real browser
checks still own scoped cascade, actual values and interaction verification.

Body primitives now include `EntityCard` and `EmptyState`. Cards accept an
already-authorized identity, runtime subtitle and one trailing presence slot;
they cannot infer presence from CLI availability. `AgentEntityCard` connects the
existing view and status projector, not a second data store. Computer and
created-Agent lists consume this same presentation owner.

`ProfileSection` owns the 20px horizontal / 16px vertical spacing and 1px muted
divider for the Human profile body. The typed `human.profile` query supplies
current Workspace membership and immutable creation IDs; the entity directory
joins those IDs to the authorized catalog. A principal is not a Computer owner.
Human profile navigation uses principal ID and never creates a self-DM. Fields
without canonical data (email, hardware ownership) are omitted,
not filled from OS data. Agent/Computer section adoption is described below;
the complete Human directory and ownership relations remain separate work.

`ProfileField` owns the multiline description edit state, 3000-character limit,
Save/Cancel, Escape focus return, pending state and error/draft retention.
`HumanIdentity` joins authorized candidates through the entity directory and
opens the same Human route from message avatars, mentions, creators and graph.
Profile and account edits share `useHumanProfileMutation`; only the existing
authenticated `principal.update` owner writes identity or image references.
See [Human page family](human-page-family.md) for source and scope boundaries.

Agent and Computer bodies also consume ProfileSection. The `field` variant owns
the 4px heading gap; `divided=false` is the Agent inline-field 12px vertical variant.
Default sections use natural content height with 20px horizontal/16px vertical
spacing and a 1px muted leading divider. Never restore fixed per-page section
heights. The title action slot uses the shared edit affordance. Profile/preview
CSS is maintained here, not layered underneath page-specific overrides.
See [Agent/Computer family](agent-computer-profile-family.md) for projection,
permission and local adaptation boundaries. UI009 is a scoped implementation
record, not a full-product parity certification.

Identity previews use the existing `PreviewCard` lifetime/placement owner and
the internal `preview.css` frame (background, border, shadow and stacking).
Agent and graph page-local frame rules were removed. The graph's existing
compact shadow remains an explicit variant; identity content stays in callers.

Empty states require a named `search`, `profile`, `task`, `activity` or `file` context and `fill` or `section`
placement. Search home fills its remaining stage only when suggestions are
absent. Profile empty content fills the area **after** the diagnostic toolbar.
Loading and read failures belong to the caller and must not show a successful
empty result. Other page families are not silently switched to either context.

Native disabling applies to pointer and keyboard. Tabs use one focus stop,
wrapping arrows, Home/End and disabled-item skipping; these move focus only.
Enter/Space activates the focused tab (Raft `activateOnFocus=false`). Splitters own pointer
capture; existing panel policies own bounds and persistence. Room/DM/Thread
Enter sends; Shift+Enter inserts a line; IME confirmation never sends. The
composer keeps its existing owner and is not part of this initial move.

## TDD, examples and comparison

Run `npm run check:ui-library`, `npm run check:ui-contract`, and
`npm run test:web:foundations`. The latter uses Chrome/Firefox, the real library,
production templates and isolated canonical fixtures. The executable page is
`apps/web/test/ui-foundations.html`, available through the development server at
`/test/ui-foundations.html`; it is not a shipped product route.

Cover rest, hover, pressed, focus, disabled and pending states, plus long names,
empty data, denied capabilities, open inspectors, narrow screens and both sides
of breakpoints. Review screenshots, geometry, focus, pointer targets and callback
assertions. Browser receipts include library source/catalog hashes so moving a
component cannot hide later evidence drift.

Run `npm run test:web:ui-compare` for the foundation and Shell official-capture
replays, with generated JSON/Markdown differences, pinned evidence and source hashes.
See [the comparison and release contract](./ui-evidence-and-release.md). This is
not a fresh official-site scan, and does not cover all component/mouse states.

Further bilateral comparisons target these production owners at matching viewport,
font readiness and data preconditions. Official evidence, reconstructed fixtures
and self-regression have separate labels. An unavailable official state remains
unverified. Never update a baseline merely to turn a failed comparison green.

## Adoption and maintenance

Edit maintained source directly, recording a reason in `adoption.json` when an
adopted file changes. Keep original hashes and immutable historical evidence.
For new official evidence record URL/version/hash and applicable behavior IDs;
do not infer authority from a filename containing `official`.

Upstream updates are reviewed inputs, not automatic replacements. Preserve
authorization/attribution records; do not relabel third-party assets as RAH-authored
or assume this private library has a new redistribution license. Retire old
sources through scoped Git changes after dependency and browser checks.

## Remaining migration

Legacy page CSS in `apps/web` remains active. Settings, Computer, global
discovery and Saved/Search header tracks now consume the library. Search retains
its input composition and uses the compact header action for clear-query;
Saved retains its title/subtitle composition. Page bodies, general buttons,
forms, overlays, empty states and toolbars still
need family-by-family consolidation. Settings shared cards/forms and scoped
profile drafts now use the internal Settings owner; see
[Settings family](./settings-page-family.md). Preview pending/open Escape is
covered by the profile-family regression gate. Expansion of official bilateral
coverage remains open work; local migration does not certify it.
The notification read-failure mislabel found in the Shell review is corrected:
unknown/read failure, unsupported browser, unavailable daemon Push configuration,
permission and subscription are separate view states. Read-only retry and stale
response fencing are tested without creating a subscription. This does not
certify OS notification delivery or all notification settings; see the
[scoped implementation plan](./ui-secondary-headers-and-push-status.md).

Interactive notification popovers now share the internal `interactive-popover` owner,
using pinned Base UI for hover bridges, dismissal and focus. Raft's desktop 0/120 ms
and keyboard-only initial focus are source-backed parameters; mobile opens on click.
InputRequest answering remains a separate modal dialog. See the
[scoped takeover audit](../audits/2026-09-06-notification-popover-takeover.zh-CN.md).

## Mobile root navigation exception

The user-selected [iOS reference tab bar](../audits/2026-09-14-mobile-ios-tab-navigation.zh-CN.md) uses a translucent rounded surface and gray active capsule on mobile root pages. This is a bounded navigation presentation exception, not a change to dialog, button, Agent choice-row or desktop Rail styles. Detail pages hide the bar. Dimensions and blur are maintained RAH CSS based on supplied screenshots, not extracted native iOS source.
