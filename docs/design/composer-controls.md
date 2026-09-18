# Composer file references and execution control

Current contract: 2026-09-18. This user-requested design preserves the upload
pipeline and shared button geometry, with separate path and mobile upload actions.

## Plus entry

- Chat, Direct Room and Thread use one 26px Plus, with the shared 14px icon,
  2px border and button motion documented in
  [attachment provenance](composer-attachment-pickers.md).
- Plus always opens the Computer tree directly, on every origin and device.
  There is no Plus menu, machine inference or default-action preference. Old
  browser-local default-action values are no longer read.
- Mobile layout (the shared 767px breakpoint) adds a paperclip immediately after
  Plus. It invokes one unrestricted, multiple-file native input, without `accept`
  or `capture`. iOS owns the photo library/camera/files chooser. This is a layout
  decision, not evidence that a desktop browser shares the daemon's filesystem.
- The Computer file tree dialog strictly handles filesystem path references and
  does not retain photo/upload buttons. Device file and media uploads are accessible
  via the mobile paperclip or existing desktop drag-and-drop pipeline.
  Camera availability belongs to the browser/OS media picker; the app does not
  promise camera hardware access.
- The Computer label currently shows only the connected daemon host, without a dropdown.
  Future remote Computers must implement the same authenticated listing contract;
  no remote connection or SSH upload is implied by a path reference.
- Click a directory row to open it; click files to toggle multiple selections in
  the current directory. Hover and selected rows use the shared `property-option`
  soft yellow profile; selected files also show a right-aligned check.
  Explicit deselection clears the check and fill together,
  even while the pointer stays over the file or a touch leaves sticky hover.
  Pointer re-entry restores normal hover; the keyboard focus outline remains.
  There are no separate row arrows. The Home button next to the Computer name returns to the configured
  starting directory (normally the daemon user's home). The single pink confirm
  action inserts all selected files in selection order, or the current directory
  when none are selected, as space-separated `@"/absolute/path"` references in one
  editor insertion at the caret. Navigating to another directory clears selection.
  References neither read file bodies nor publish/upload Artifacts.
  Listing does not prove an Agent can access a referenced path.
- AgentHost owns the bounded reader: at most 1000 entries, no symlink traversal,
  sensitive-directory exclusions inherited from the workspace reader. Daemon
  `fileReferenceRoots` lists explicitly authorized absolute roots. Following the
  2026-09-17 user decision, the default reference scope is `/`, starting at the
  daemon user's home; Parent reaches `/Users` and `/` without a root selector.
  Explicit narrower configurations retain their boundary and start at the first
  root. An omitted root plus empty path opens the starting directory; an explicit
  root plus empty path lists that root. Authenticated Humans may list those roots;
  Agent credentials and unauthenticated clients cannot use this endpoint.
  Only the metadata-only Computer reader permits `/`; Agent workspace list/read
  still reject it, and retain their Agent-owned roots. No new body-read API exists.
- The dialog has loading, empty, error/retry, hidden-file and selected states;
  Escape/backdrop/close return focus. Directory changes abort stale responses and
  clear selection. File uploads reuse FileUploadStore, Room/Thread draft isolation,
  native multiple selection and explicit sending. Task creation still disallows
  attachment uploads; absolute path text is allowed.
- File choices reuse `ChoiceRow` rather than local row color overrides; the single
  selected-reference action uses the shared pink button. Raft's published `web-index.js`
  create-channel dialog at offset 2421045 uses `btn-brutal bg-brutal-pink` for its
  primary action; the shared source tokens are `#FE7DA8` and `#FFD440`.
  This is a local file-picker composition of maintained Raft button conventions,
  not a claim that Raft has this exact dialog. Failed child listings retain Parent.

## Shared dialog presentation

The file-reference header reuses Task approval's `rah-dialog-header` in the
maintained `panel-foundations.css`: 8px vertical/16px horizontal padding, 14px
bold title and `--bd-heavy` separator. Both show the Room context on a 12px first
line; file references use the existing conversation label (`#channel` or `@peer`)
from the originating Chat/Thread composer, followed by the file-reference title
on the second line. Content determines header height, without a file-specific fixed
height. Both use `PanelHeaderAction` for Close (28px desktop, 32px mobile; 14px/18px
glyph). The mobile rule also covers body-portaled dialog headers. Confirm uses
unmodified shared `btn btn-pink` geometry (13px bold, 8px/14px padding, 16px glyph)
and interaction states. Both dialogs use `rah-dialog-frame`: desktop width
`min(960px, 100vw - 2rem)`, preferred height `min(86vh, 900px)`, viewport height
limit `100dvh - 2rem`; mobile compact width `100vw - 32px` and height limit
`100dvh - 64px`. The file tree retains the shared preferred height on mobile
so loading and directory row counts cannot move its centered header. Task
approval continues to shrink to its content. Home uses the runtime model refresh
button's shared borderless profile (24px control, 12px glyph).
Initial focus goes to the dialog container, as in Task approval, so opening the
window does not add a keyboard focus outline to Close. Keyboard Tab still exposes
the shared focus indicator on controls.
During navigation the last Computer identity stays visible and the requested
absolute path is displayed. Only the list changes to loading; reference is
disabled until the requested listing succeeds. Errors retain Parent/Home, and
aborted responses cannot replace a newer directory. No filesystem scope changes.
This extracts the existing structural TaskModalHead port, whose provenance is
recorded in [Task modal evidence](../audits/2026-09-14-chat-task-modal.zh-CN.md).
`npm run test:web:file-dialog-chrome` compares both live dialogs at 1440px/390px;
it also checks shared action styles, close/reopen and Escape/focus return. The
directory gate holds network replies to verify stable header position and text,
disabled references during loading, and Home winning over a late response.

## Send and Stop

`packages/kernel` owns execution state; the client polls its authenticated Room
projection. Text or attachments always select Send. Empty plus working selects
Stop; empty plus stopping displays a disabled stop control. New text restores Send
even while cancellation is pending. Submission still uses existing Room mutations
and durable follow-up activation merging, never a browser queue or a fabricated
provider-level steer acknowledgement.

Stop reuses Room Agent SOS, covering all execution lanes in the current Room.
Direct Rooms allow their Human member; Channel authority stays owner/admin.
Thread shares its Room. Task state and canonical messages are not deleted or
rewritten. Success requires terminal proof for every targeted runtime.

Composer requests set `resumeOnMessage: true`. The next accepted Human message,
Thread reply or created task supplies canonical guidance and releases the hold
only after all previous runtimes are proven stopped. A correction arriving during
stopping is durable and resumes after the final proof even if the HTTP caller
disconnects. A startup failure racing cancellation resolves the cancellation
instead of retrying it into a newer execution attempt. Original settings SOS
requests omit this flag and still require explicit manual Resume.
Host recovery also settles completed cancellation targets after lease expiry or
quarantine resolution; a disconnected browser is not required to finish Stop.

## Sources and ownership

- Raft Web 1.16.0, commit `ba2a1db`, published `web-index.js`, SHA-256
  `7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`:
  Xht's stop-all-agents/resume-all-agents is the upstream behavior reference.
  Immutable URLs/hashes and license/provenance limits are in the
  [release evidence manifest](../evidence/raft-release-20260916/manifest.json).
  The published bundle is analysis-only, under the user's source-access authority.
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`,
  `packages/views/chat/components/chat-add-menu.tsx`: structural Plus/native input
  reference; no byte-exact React reuse. Existing repository upstream notices apply.
- Legacy RAH's FileReferencePicker informed quoted path insertion only. Its
  Session ownership and unrestricted filesystem assumptions are not imported.
- Protocol owns schemas; AgentHost owns filesystem scope; daemon supplies roots;
  application-service/client-sdk own authenticated transport; Kernel owns stop,
  terminal proof, sequencing and resume; Web/ui-web own interaction and layout.
  Current source-backed UI plus RAH-specific file/stop glue does not claim exact
  Raft visual parity for this intentionally different composer.

## Verification

Directory loading keeps the fixed-height list region empty with `aria-busy`;
it does not insert a transient loading-text row. Confirm stays disabled until
the requested listing arrives; errors retain the existing retry action.
`test-file-dialog-chrome-browser.mjs` delays directory responses and verifies
Home/folder navigation has no loading-text flash or list-frame movement in
desktop Chromium and mobile WebKit. The 2026-09-18 repair passed these gates
and the Web build, but formal restart remains pending: the unrelated
`/v1/worker/message-present` registration gate and backend formatting checks
are failing. No deployment acceptance is implied.

- Unit/integration: path traversal, absolute-input and symlink rejection; sensitive
  paths and unknown hosts/roots; unauthenticated/Agent denial; path-only metadata;
  Channel/DM authority; manual SOS preserved; correction while stopping;
  startup/cancel/retry race; idempotency flag mismatch; reference text and action
  priority. Tests use temporary state and fake providers.
- `node scripts/test-composer-controls-browser.mjs` exercises desktop 1440x900 and
  touch 390x844: tree/caret/folder references, Home, file deselection, native upload
  entry, dialog geometry, Room/Thread/DM
  execution controls, injected failure, reload, repeated stop and correction.
  `RAH_UI_BROWSER=webkit` selects WebKit; default is Chromium.
  The same gate is exposed as `npm run test:web:composer-controls`.
- `npm run test:web:composer-drop` covers Chrome/Firefox upload, native chooser,
  keyboard, cancellation/caret, same-file reselection, forbidden uploads, late
  responses, byte-exact downloads and Room/Thread draft isolation.
- Browser automation is not a physical iPhone camera/native picker or paid CLI
  acceptance. Official nonempty Computer tree bilateral acceptance is separate.
  Formal restart must use frozen verified assets, idle inspection and state backup.
