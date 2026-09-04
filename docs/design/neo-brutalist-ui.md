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
The initial adoption covers five primitives and three composition templates.
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

## Ownership and composition

1. Load `@rah-os/ui-tokens/neo-brutalist.css` once at the application boundary.
2. Import primitives from `@rah-os/ui-web/neo-brutalist/*`.
3. Pass labels, values, disabled/pending state and callbacks from the existing
   product owner. Components do not fetch, persist Room state or parse providers.
4. Pages retain composition and typed SDK/client-core integration. A template is
   a composition of the same components, not cloned HTML or simulated success.
5. Edit a migrated family's library owner and remove its obsolete page rule.
   Do not fix it with a late `!important`, duplicated selector or new theme.

Native disabling applies to pointer and keyboard. Tabs use one focus stop,
wrapping arrows, Home/End and disabled-item skipping. Splitters own pointer
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

Future bilateral comparisons target these production owners at matching viewport,
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

Legacy page CSS in `apps/web` remains active. Settings, Computer, general forms,
overlays, empty states and toolbars need family-by-family consolidation. The
existing preview Escape intermittency and automated official bilateral diff
runner remain open work. This ownership migration does not fix or certify them.
