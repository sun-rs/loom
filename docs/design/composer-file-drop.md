# Composer file drop: one complete attachment delivery loop

Scope: B019 Chat/DM/Thread composer files only. File menus, preview formats,
clipboard attachments and public Channel reading are separate work.

Authorized Raft source: https://app.raft.build/assets/index-BoAC7nSE.js,
local docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js,
SHA-256 7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a.
Composer handlers around offset 2230500–2231900: Files-only drag detection,
nested enter/leave depth, copy drop effect, reset after drop, skip directories,
deduplicate items by name/size/type, fallback FileList. Overlay around 2240000:
absolute inset, z30, 2px dashed pink, pink 15% fill, white bordered label,
12px horizontal / 6px vertical padding, 14px bold and small brutal shadow.
Adoption is a structural port of behavior/classes into internal owners, not
byte-exact original React or a copied server. Preserve authorized source evidence.

Multica 11861145abc59a0d39c8c8f24ad837d4584e664f,
packages/views/editor/use-file-drop-zone.ts additionally clears on document drop
and dragend and guards disabled/already-handled events. Its single boolean hover
and unconditional text drag prevention are not preferable to the Raft depth and
Files-only contract. Reuse the cleanup idea without importing its upload owner.
Existing FileUploadStore already records its own Multica-derived coordination.

Owners: presentation in ui-web/ui-tokens; ephemeral drag and extraction in the
Web composer integration; FileUploadStore remains the sole draft/upload owner;
RoomFiles and existing message mutation remain the authority for published bytes.
Chat/DM and Thread forms share the integration. No new backend protocol or state.

Intentional local safety difference: disabled/archived/permission-denied,
sending, or unsupported attachment transport rejects file drops and prevents
browser file navigation. Task-mode attachments remain unavailable per existing
Task composer contract. Ordinary text drops are left to the textarea. The
source compact mode rejects files; local compact/non-composer inputs get no new
handler. Directory-only drops show the official refusal, mixed drops upload only
files with the official skipped-folder explanation. Drop is never send.

Exit: failing then passing tests; file extraction/depth/cancel and current
eligibility; real Chrome/Firefox Chat and Thread attachment-only send, frozen
canonical references and exact bytes after reload; navigation isolation,
pending/denial, invalid file/folder, failed upload removal and retry. Check
1440x900 and 390x844, overlay bounds/style, nested pointer targets, drag exit and
Escape. Formal user state receives only read-only smoke after safe restart.
Frozen-source comparison and official live comparison are reported separately.

The local backend is also compared with extracted Raft Computer 1.0.18
shared/src/attachmentUploadContract.ts (145–199): server-authoritative limits,
reservation, completion verification, cancellation and status. RAH's existing
FileUploadStore/RoomFiles own these equivalent local responsibilities; this batch
adds no imitation server or duplicate storage. The overlay is pointer-transparent
so the same composer remains the drop target; no focus trap is introduced.

Label black and shadow are verified against the published CSS index-EQxYM8hQ.css
(SHA-256 36d9e3d1cb74dd7638c87f7544042c77da547302a0e98112d95ad702be91d3d6): text/border black is #000;
shadow-brutal-sm is 2px 2px #141111. These are source values, not screenshot estimates.

2026-09-07 live inspection: authenticated app.raft.build loaded index-BVfbaScj.js
(SHA-256 65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde).
The current handlers (2275394 vicinity) and overlay (2284173 vicinity) retain the
same directory/depth/dedupe and class contract. Live #test composer at 1280x720,
DPR 2 exposes separate media/file buttons and a disabled empty Send; no message
was sent or attachment uploaded to the official workspace. Local compact picker
still combines these entries; that pre-existing menu difference is not closed by
B019 file drop. Current script and bounded extracts are in the external evidence
folder; production does not import them. This is live inspection plus source
comparison, not an official completed upload/download bilateral run.
