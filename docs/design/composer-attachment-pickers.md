# Composer attachment pickers

Scope: Chat/DM and Thread. The owner-approved 2026-10-15 phase-4 design
uses one Plus and one unified Computer file dialog, with the native upload
action in its footer (disabled for same-device presentation). Parent navigation
stays mounted while only file entries reload. See
[Composer controls](composer-controls.md) for current behavior and device
preference limits. FileUploadStore remains the draft owner; RoomFiles and
message transactions remain authoritative. Historical bundle details below
describe provenance, not the current placement of the upload control.

Source: authorized Raft Web https://app.raft.build/assets/index-BoAC7nSE.js,
local `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`, SHA-256
7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a.
VGe at 2209742 is `image/*,video/*`; the two inputs at 2244410 share Pr, allow
multiple selection, clear their value after change, and blur the editor only
after nonempty selection. Pointer-down prevents editor focus loss; native button
keyboard activation remains available. Compact mode omits these controls.

The inspected current official bundle `index-BVfbaScj.js`, SHA-256
65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde, retains B8e
(2253034), shared Ca (2273203), two inputs (2288137) and pointer-down Ya (2282517).
Buttons at 2291847 use `btn-brutal-sm bg-white p-1`, 14px icons and `gap-2`.
Published CSS `index-EQxYM8hQ.css`, SHA-256
36d9e3d1cb74dd7638c87f7544042c77da547302a0e98112d95ad702be91d3d6, defines 4px
padding, 2px black border, 2px brutal shadow, hover lift/4px shadow, 1px press and
0.4 disabled opacity. Together these give 26px controls and an 8px gap. These are
source-derived values, not screenshot estimates. Existing shared sq-btn motion
and tokens are reused; only the picker size/padding/icon variant is added.

The image-plus geometry is copied verbatim from k3e in the fixed bundle / v$e
in the current bundle (1871816). It enters maintained `src/interaction-icons.svg`,
not the immutable original sprite. Raft source is used under the user's stated
authorization. The image-plus geometry carries [Lucide's ISC notice](https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE) (retrieved 2026-09-07):

> ISC License. Copyright (c) 2026 Lucide Icons and Contributors.
>
> Permission to use, copy, modify, and/or distribute this software for any purpose
> with or without fee is hereby granted, provided that the above copyright notice
> and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
> FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT,
> OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
> DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS
> ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Multica comparison: revision 11861145abc59a0d39c8c8f24ad837d4584e664f,
`packages/views/chat/components/chat-add-menu.tsx`, uses one multiple-file input
with a shared upload callback and value reset. Its Plus menu/project actions do
not match Raft's original dual buttons. The current Plus entry adopts that
structural pattern. The user's 2026-09-18 design replaces the separate media/file
inputs with an unrestricted multiple input on mobile; the original Raft filter
and dual-button evidence above is historical provenance, not the current UI.
RAH uses the existing upload callback and local eligibility glue, not copied React.

2026-09-18 touch correction: the mobile paperclip places the native file input
over its visual control. A touch reaches that input directly, without canceling
pointerdown or forwarding a synthetic input click. Plus retains its caret-preserving
pointer handler. The accessible button wrapper handles Enter/Space and direct
border/assistive activation only; input clicks bubbling through it do not reopen
the picker. Both input and wrapper share upload eligibility. Cancel needs no
application-state reset and never uploads or sends; selection keeps the existing value reset.
This is an intentional native-touch difference from the historical Raft proxy.
WebKit's [FileInputType](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/FileInputType.cpp)
uses the user gesture and input renderer's rectangle for the native picker.
No WebKit implementation code was copied. The regression uses actual `tap()`,
checks trusted input click events and repeated cancellation, and runs Chromium
and WebKit; automation does not claim to exercise the iOS system action sheet.
See [touch regression evidence](../audits/2026-09-18-native-upload-reopen.zh-CN.md).

Local difference: archived/no-post and pending disable the Plus. Task mode and
absent file transport disable the mobile upload button; path references remain text input.
Late/direct file change events retain these checks. File accept is a picker
filter, not a new backend MIME permission rule. Cancel is no upload/no send;
nonempty selection queues files but requires explicit send. Media and ordinary
files share Room/Thread draft isolation and the existing failure/remove behavior.

Exit tests: real button -> filechooser -> exact filter/multiple; pointer focus and
empty selection/caret preservation; keyboard activation; same-file reselection;
media plus multiple ordinary files; explicit attachment-only Chat/Thread send;
canonical thread/reference and byte-exact downloads after reload; both forbidden
entries and existing slow-upload/failure/drop recovery. Chrome/Firefox at desktop
and 390x844, source geometry and inspected screenshots. Filechooser automation
tests the browser boundary; it is not macOS native picker/Finder acceptance.
Formal read-only browser checks follow an idle, backed-up, safe frozen-build restart.
Official live bilateral and paid runtime evidence remain separate claims.

The multi-selection browser test reproduced a pre-existing integration defect:
three draft rows in the fixed-height Thread composer reduced textarea height to
zero and clipped a draft. The maintained styles owner now uses the same empty
minimum and a non-shrinking editor, allowing draft content to grow the box.
This is necessary local layout glue; the draft-chip tray itself does not claim
source-exact Raft media-thumbnail parity. The regression requires an editable
40px-or-taller desktop editor (the existing compact mobile minimum is 20px)
after multiple selection, without forced actions.
