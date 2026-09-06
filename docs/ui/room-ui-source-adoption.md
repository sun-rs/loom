# Room UI source adoption decision

Status: adopted, 2026-09-06.

## Decision

RAH owns one internal neo-brutalist Room component and asset library. Production code must not import a sibling `raft-ui` or `rah_os` checkout. Raft remains the behavior and visual evidence source for overlapping features; it is not a runtime dependency and a reconstructed reference repository is not an absolute standard.

`raft-ui` is a temporary forensic and reconstruction workspace. It may help discover a candidate behavior, but no path, package, build step, test, or runtime fallback in RAH may depend on that checkout. Accepted evidence is copied into `docs/ui/evidence` as a small English artifact with an immutable hash and a precise upstream locator. The RAH component library is the implementation source of truth after adoption; the evidence record explains why a behavior was adopted and when it must be rechecked.

Source classifications are machine-readable in `raft-behavior-registry.json`:

- `official-original`: byte-identical official files with a recorded artifact hash.
- `extracted-transplanted`: data extracted from a shipped official artifact, with the artifact and hash retained.
- `reference-rebuilt`: independently reconstructed layout or interaction behavior based on official browser and bundle evidence.
- `rah-local-adaptation`: RAH-specific behavior required by the local-first daemon architecture.

Leaf assets may be adopted byte-for-byte when provenance and authorization permit. Composition and responsive behavior must still pass a browser state matrix. Visible Raft UI never becomes the owner of Task, Review, execution, identity, notification, or history truth.

The evidence chain is intentionally repository-local:

1. `docs/ui/evidence/manifest.json` records every evidence artifact, its repository path, byte hash, source type, upstream identifier, and observed version.
2. Each artifact records the extraction method, upstream location, and the exact extracted data or behavior statement. A compact extracted artifact is not described as an official original file.
3. `raft-behavior-registry.json` binds each adopted contract to an artifact hash and JSON-pointer locator. A local adaptation may additionally cite supporting official evidence.
4. `npm run check:room-ui-contract` fails when an artifact is missing, resolves outside this repository, changes without a matching hash update, or no longer contains the registered locator.

The registry is an adoption ledger, not a blanket Raft-parity declaration. A registered UI behavior still requires its named tests and real-browser acceptance, and a RAH-local capability still requires its daemon owner.

## Ownership

- `packages/client-web/src/room-ui` owns reusable visual primitives and extracted assets.
- `packages/client-web/src/room/RoomPage.tsx` owns Room page composition only.
- `packages/client-web/src/room-projection.ts` is the sole browser projection owner.
- `packages/runtime-daemon/src/room` owns canonical Room, Task, Review, RunAttempt, Inbox, and history state.
- `packages/runtime-protocol` owns transport types and strict validation.

## Update and rollback

An observed upstream artifact, documentation revision, or live-product change triggers evidence review; it does not silently replace the adopted baseline. Live bundle names are not pinned as perpetual truth. Accepted changes update the repository evidence artifact, manifest hash, registry locator, fixtures, and browser evidence together. Rollback is a normal RAH commit revert. No production fallback may import a sibling checkout or revive a second page-specific style owner.

## Acceptance matrix

Every reusable control must cover rest, hover, focus-visible, disabled, loading, long labels, empty data, insufficient permission, open side panel, desktop, 390×844, and both sides of the primary responsive breakpoint. Integrated browser acceptance must also assert the canonical daemon result after mutations; screenshots alone do not establish completion.

## Presentation acknowledgement contract

Automatic acknowledgement is an exact presentation request, not a tab-wide read receipt. It is allowed only while the document is visible and focused and the projection has observed the canonical Room head. Chat additionally requires the latest message window and latest scroll edge, and acknowledges only messages rendered in that window. Tasks uses the board scroll container as the intersection root and acknowledges only pending Task/Review attention whose exact card is at least 50% intersecting; a horizontally or vertically offscreen mounted card is not presented, while opening a typed Task deep link scrolls the target card into view. Members, unrelated tabs, background documents, stale projections, and older Chat windows never acknowledge. The daemon still validates the exact Inbox item, event, entity and observed sequence; the browser cannot advance a general Room cursor.
