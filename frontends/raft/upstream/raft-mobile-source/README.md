# Raft Mobile selected reference

Repository and revision: see source-lock.json. This directory contains byte-exact
selected native sources plus LICENSE/NOTICE. Do not edit them. This is a source
reference for mobile-Web behavior ports, not a Kotlin runtime dependency, the
whole native application, or proof of the owner's installed App release.

Compare an independently acquired checkout:

    node scripts/official-web/audit-mobile-source.mjs /path/to/mobile-checkout

The report verifies local hashes and candidate identity/dirty state, then reports
changed/missing selected files. Exit 2 requires review. Exit 0 is not UI acceptance
and does not scan unselected native features. Follow changed native composition
into Loom routes/components, explicitly classify reuse versus structural port,
then test affected touch/keyboard/accessibility flows. Keep Web and Mobile pins
separate. Update original files only through a documented version intake.

Current bindings: native ActivityConversationSwipe supplies leading read/unread
semantics; pinned Web1.21.34 supplies actual browser pointer handling, adapted by
scripts/official-web/generate-mobile-activity-swipe.mjs. Native refresh geometry
and title navigation are structural TypeScript ports, with browser listeners and
official raft-ui Spinner. Original code is never patched for Loom.
