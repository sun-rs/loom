# Secondary headers and notification read states

Incremental B2/B3 batch, 2026-09-04. Keep the existing typed SDK, canonical
Saved/Search operations and Raft-derived Web Push registration helpers.

## Source review and boundary

- Frozen `index-BoAC7nSE.js` (SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`):
  Search uses the shared Panel header `titleSlot`, `size-icon-header`, 18px glyph,
  a mobile back action, and a conditional clear-query action. Keep its input,
  IME, query and navigation owners; do not replace them with a fixture store.
- Frozen `SavedPanel-BvhJ1TDV.js` (SHA-256 `261c2bd2262c8afe8040486ff2b5dad330badc14c573ee05c2ae522ffbb180cf`):
  Saved uses the same Panel header with title, subtitle, 18px bookmark and mobile
  back. Existing saved-list loading, pagination and mutations stay unchanged.
- The same shared bundle's `b4/hce/Lit/Dit` registration helpers distinguish
  unsupported browser, existing registration and subscription read failure.
  Do not treat an exception as proof of missing subscription or disable Push.
- Official foreground browsing is currently blocked by the locked Mac. This
  batch uses frozen source plus prior measured header contracts; local browser
  runs cannot be labeled fresh official bilateral acceptance.

## Owners and implementation order

1. Notification state presentation: a small pure RAH view projection distinguishes
   checking, read failure, explicit unsupported, denied, unsubscribed and active.
   iOS guidance requires explicit browser-unsupported evidence and an iOS device;
   daemon unavailability has separate wording. Unknown counts are not zero.
   Keep actual errors visible, add read-only retry, and reuse `createLatestRequest`
   to reject late reads after newer reads/actions/unmount. Never create a new
   background poll, permission request or subscription as part of retry.
2. Saved/Search compose `PanelHeader`, `PanelHeaderIcon`, `PanelHeaderAction`.
   Remove their duplicate header/tile sizing, preserve specialized input and
   subtitle composition, and add the source-backed Search mobile back/clear
   actions. Do not migrate unrelated body controls in this batch.
3. TDD: red unit/ownership assertions and real-browser failure injection first;
   then production changes. Fault injection uses temporary browser profiles and
   only stubs the browser subscription read, never the formal service or provider.
4. Verify latest-response wins, retry, retained raw error, no false iOS/zero state,
   no implicit subscription; Saved/Search standard/short/mobile header tracks,
   clear/back/Escape/IME interactions. Run existing suites, compare replay, inspect
   Chrome/Firefox screenshots, then guarded formal restart and read-only check.

The internal library remains the maintained standard. This does not certify
notification delivery banners, iOS hardware, all overlays or all body buttons.
