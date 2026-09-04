# ADR 0028: Product-owned Neo-Brutalist UI library

Status: Accepted for incremental implementation, 2026-09-04.

## Decision

RAH OS owns **RAH Neo-Brutalist UI**. This is the existing presentation system
under explicit maintenance, not a new theme or a second application. English
documentation and a machine-readable catalog describe assets, primitives,
composition templates, behavior IDs and executable examples.

- `packages/ui-tokens/src/neo-brutalist` owns adopted CSS and visual resources.
- `packages/ui-web/src/neo-brutalist` owns browser-safe React primitives.
- `apps/web` composes these primitives and retains typed SDK/client-core bindings.
- `packages/raft-ui-snapshot` remains immutable historical evidence only.

Remove the sibling-directory importer and snapshot-to-product overwrite
generator. Product installation, build, runtime and library maintenance require
no external `raft-ui` checkout. Do not delete that unrelated checkout.

Use the existing package names and export boundaries. Move existing files and
consumers; do not retain compatibility component copies or create another CSS
override layer. Keep the same visual output during this ownership migration.
Legacy page rules remain explicitly recorded migration debt, not certified
library components. Their removal requires a separate failing test and browser
verification for each family.

## Evidence and change policy

The reference reconstruction is not official source and is not an absolute
standard. Official published assets retain their notices and original bytes.
Adopted CSS/components may evolve in their internal source owner; record their
origin separately from subsequent local changes. Never edit frozen evidence to
make a comparison pass or require all product CSS to equal a historical copy.

The current behavior registry is the contract index. The library catalog links
to its IDs and scenarios, rather than duplicating business contracts. All future
Raft comparisons target the actual library/production compositions. A reference
fixture is labeled as reconstructed evidence; it cannot certify official parity.
Self-regression and official bilateral comparison remain different receipts.

Freeze the initial adoption by the existing snapshot manifest SHA-256 and asset
hashes. Reassess upstream when a user reports a difference, before changing an
affected behavior, or during an explicitly scheduled release review. No automatic
baseline promotion or recurring network job is introduced. An update requires
source review, explicit deviation accounting, TDD and browser gates. Roll back
source, catalog and contract changes together with a scoped Git revert; do not
roll back canonical user data.

## Initial implementation and acceptance

1. Add failing ownership, asset-closure and catalog/contract tests.
2. Adopt current resources as maintained source; preserve binary assets exactly.
3. Move Icon, PanelHeader, PanelHeaderAction, PanelTabs and PanelResizer into the
   existing shared presentation package. Move their shared CSS/state owner once.
4. Expose one library stylesheet entry and executable template examples using
   the real production compositions. Document remaining page-specific rules.
5. Run source checks, type checks, existing suites, Chrome/Firefox component and
   integrated matrices, inspect screenshots, build and safely restart the formal
   workbench. No live-provider request or production conversation mutation.

This batch does not claim that all pages have migrated, or that an automated
official bilateral diff runner has been completed.
