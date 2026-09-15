# Task virtual window and layout anchors

Date: 2026-09-07. Implemented; Chrome/Firefox and formal workbench verification are recorded in
[the batch audit](../audits/2026-09-07-room-lifecycle-navigation-verification.zh-CN.md).

## Source and ownership

Authorized Raft source: `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`,
SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`.
The frozen public Web bundle is analysis evidence, not a production dependency.
Source symbols `L8`, `Fj`, `lce` and `cce` around offsets 3134583–3142150
implement shared Task layout anchoring, virtual stacks and boundary Tab handling.
Both official list groups and board columns use these owners. Parameters are
116px estimate, 10px gap, overscan 6 and initial rectangle 320×720.
Upstream ownership/authorization notices remain in the existing Raft evidence and
product legal provenance. This is a structural TypeScript port, not byte-exact reuse.

Multica revision `11861145abc59a0d39c8c8f24ad837d4584e664f` was inspected for a
Task virtual-list implementation; no equivalent shared Task owner was found.
Raft supplies the more complete applicable implementation. No Multica algorithm
or legacy RAH Session model is introduced.

`packages/ui-web/src/neo-brutalist/task-virtual-layout.tsx` owns cross-stack
visible-anchor preservation. `task-virtual-stack.tsx` owns measured rows,
bounded DOM and keyboard traversal. The existing TanStack React Virtual package
is reused; it already backs message virtualization. Task UI does not reuse the
message-specific history/anchor state. `GlobalTaskBoard` composes both Task
views, retaining the existing canonical Task projection, paging, mutations and
DndKit controls. Presentation code owns no business queue or Task status.

Local changes are typed interfaces, descriptive names, explicit scroll refs,
existing Task cards and CSS layout integration. The installed TanStack 3.14.10
React adapter defaults to synchronous flushing; local layout-driven anchor
correction can otherwise emit React lifecycle re-entry errors. As in the existing
MessageTimeline, Task stacks set `useFlushSync: false`. This local compatibility
adaptation follows the installed upstream adapter option, not a new scheduler. The source's five-correction
limit, visible anchor selection, input cancellation and two-frame keyboard focus
transfer are retained. Virtualizing rows intentionally removes offscreen cards
from the DOM; browser checks must scroll to them rather than assume every loaded
Task has a mounted element. Pagination and refreshing previously visited pages
remain independently required.

2026-09-16: Native scrolling can update `scrollTop` before its event reaches
the main thread. Layout correction now records the scroll offset associated
with its anchors and rebases when the offset changed independently; a render
in that interval must not undo user scrolling. Input cancellation also cancels
pending anchor capture. This is an intentional correction to the source port,
not a new Task scrolling owner. See [the repair evidence](../audits/2026-09-16-task-scroll-and-toolbar-insets.zh-CN.md).

## Evidence requirements

The failing `task-virtual-window` gate first proves 500 loaded Tasks mount more
than 80 cards on the old implementation. Verify 1,000 Tasks in both views and
both browsers, desktop and 390×844, real wheel scrolling, bounded mounted rows,
keyboard boundary traversal, live updates and scroll anchors. The existing
1,001-Task continuation check retains cursor and repeated-page-refresh assertions.

Firefox's repeated full-foundation `out of memory` reports motivated this audit.
The missing virtual window is a demonstrated parity defect; a successful
bounded-window test alone does not prove the entire memory-failure cause or
long-term performance. Full Chrome/Firefox gates must be rerun on the final
source before claiming the previously failing scenario now passes.
