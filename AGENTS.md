# RAH engineering guide

Read this file before changing RAH. Start with `HANDOVER.md` and `docs/README.md`, then open only the owner documents relevant to the change.

## Product and architecture

RAH is a local-first, multi-provider workbench. The daemon owns provider runtimes, lifecycle, canonical events, history, input delivery, and indexes. Web/PWA/Canvas/TUI are clients; they never become runtime or conversation truth.

Package boundaries:

- `packages/runtime-protocol`: provider-neutral API/event types and validation.
- `packages/runtime-daemon`: the single runtime owner, provider adapters, history, HTTP/WS, PTY/TUI surfaces.
- `packages/client-web`: React workbench and projections. It consumes canonical protocol and must not parse provider logs.

Before adding behavior, name its single owner. Prefer a small owner module over a second implementation in a page, store shell, adapter, or renderer. `scripts/source-architecture.mjs` is a ratchet: existing large files may shrink but may not grow beyond their recorded ceiling; ordinary production files stay below 1,600 physical lines.

## Non-negotiable session-input invariant

New, Resume, and Attach are one activation transaction:

1. The client creates stable `clientMessageId` and `clientTurnId` values and projects the submitted user row immediately.
2. The start/resume/attach request carries the complete model, effort, permission/mode configuration and `initialInput`.
3. Before issuing the mutation, the client waits for the current event transport's initial replay. This is a causal barrier, not a reconnect: lifecycle/delta events for the new runtime cannot race ahead of the browser's replay baseline.
4. The daemon stages every provider input in the canonical per-session queue before any PTY write or provider RPC.
5. Delivery succeeds only after the exact identity produces `session.input.accepted`. A PTY write, an HTTP/RPC return, runtime creation, or disappearance from a queue is not acceptance.
6. The browser clears its draft only after the activation response confirms the same input identity. Failure restores text and attachments.
7. A late activation completion may update its own session, but never navigate the user away from the page or session they chose meanwhile.

Projection handoff has two explicit ownership rules. New Task keeps optimistic draft/configuration from the provisional projection but takes canonical conversation from the live projection. Resume keeps the fully paged stopped transcript as its baseline and overlays newer live lifecycle/deltas. Never use one generic spread order for both paths.

Do not introduce a second post-navigation `/input`, text/time-based acknowledgement, or a startup page. Stopped, starting, running, and resumed sessions stay on the same Chat surface.

## Canonical state rules

- Timeline identity is `provider + providerSessionId + turnKey + itemKind + itemKey`; origin is not identity.
- Provider-native structured events/history are conversation evidence. ANSI/TUI screen text is never Chat truth.
- Sidebar sessions come only from selected/revealed workspaces and authoritative provider/live catalogs. UI caches cannot resurrect an absent session.
- Per-turn Changed Files comes only from provider turn artifacts, never current workspace Git state.
- The browser keeps an in-memory page cache; reload acceleration belongs to the daemon's bounded revision-keyed hot cache. Do not put transcripts in localStorage or IndexedDB.
- Long history renders a cost-bounded virtual window and pages upward with an opaque frozen cursor. Preserve the visible anchor when prepending.

## UI rules

- Desktop and PWA reuse the same component/protocol; responsive CSS may compress labels to icons but cannot create a second behavior path.
- New Task and Chat reuse the unified composer. Permission, Plan when supported, model, effort, and Send/Stop remain mounted across stopped/starting/running transitions.
- Session, Council, and Canvas use the shared 40px conversation header protocol and divider placement.
- UI font setting affects Session/Council conversation body only.
- Validate interactions in a real browser at desktop and 390x844; DOM/unit tests alone are insufficient for layout changes.

## Testing and operational safety

Use isolated temporary `RAH_HOME`, provider homes, ports, workspaces, and fake provider binaries for lifecycle/browser tests. Never restart the user's live RAH daemon unless the user explicitly asks. Never use a real paid provider merely to test an orchestration path.

The user has explicitly forbidden GPT-5.6 Ultra for testing. Keep all automated New/Resume/Attach tests on fake providers or a non-Ultra model explicitly approved by the user.

Minimum gates before handoff:

```bash
npm run typecheck
npm run test:protocol
npm run test:web
npm run test:runtime
npm run test:web-build
npm run test:regression:e2e-plan
npm run test:release-gate-contract
npm run test:p0:browser
npm run check:repo-hygiene
npm run check:source-reachability
npm run check:source-architecture
npm audit --omit=dev
git diff --check
```

For broad lifecycle or UI changes, additionally run the isolated slow-start/large-history native browser sequence in `scripts/native_codex_browser_smoke.py`. Inspect screenshots rather than treating a green exit code as visual proof.

## Documentation discipline

When a change alters ownership, lifecycle, protocol, performance limits, provider boundaries, or release gates, update the corresponding document in the same change. `HANDOVER.md` is an operating map, not a changelog; do not write volatile PID/build IDs into it. Do not claim the worktree is clean, code is pushed, or the daemon is restarted unless those facts have just been verified.
