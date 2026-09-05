# Human page family

Status: implementation batch, 2026-09-04. Completes the bounded Human family,
not all Agent/Computer/settings pages. No per-control handoff.

## Contract and source

Reviewed published `HumanDetailPanel-p6I0u4UJ.js`, `ut`, SHA-256
`fca1dc1f0c7434d33856c716cb6a133904a8bfb275966a762671aaae15778470`.
Self avatar upload, self description edit (trim, nullable clear, 3000 characters,
multiline textarea, Save/Cancel/pending/error), conditional membership details,
created-Agent cards and typed profile opening are structural references. They
are not evidence of Raft Server implementation. Use the existing Principal
owner, profile-image intents/GC and Room ACL; no external raft-ui dependency.

## Delivery unit

- Shared Human identity/preview/open action across message avatar, mentions,
  Agent creator, members and graph. Preserve Agent-name mention behavior.
- Self profile description and avatar editing, account name/avatar propagation;
  shared mutation hook, stale-editor checks, clear/retry/cancel/focus behavior.
- Human profile read and created-Agent relations remain authorized and scoped.
  Different identity, actor and workspace responses never overwrite new pages.
- Browser matrix: all entrances, shared avatar/name updates, mutation success,
  failure/draft retention, stale updates, reload, desktop and 390x844; no paid CLI.
- Official source and local browser results are separate. Native Firefox later
  allowed a read-only check of Human navigation, description editor and Cancel;
  no official profile write or complete same-fixture pixel comparison was done.
  Local mutation tests use real Chrome and Playwright Firefox on isolated state.

## Ownership and compatibility

`Principal.description` is additive metadata in schema 47. The existing
`principal.update` transaction remains self-only and owns image references;
description omission preserves existing data for older account clients.
New editor clients send a normalized `expectedProfile` snapshot. A differing
current snapshot rejects stale writes, while exact repeated final values remain
idempotent. This is existing Principal metadata, not a new Room business command.
Unknown email and Computer ownership are not synthesized.

Server-wide removal must not be emulated by deleting only a control-Room
membership while leaving channel access intact. Workspace-role/removal and
self-DM differences require explicit local contracts; unavailable actions stay
absent, not wired to an unrelated mutation. This batch does not invent them.
