# Agent configuration acknowledgement recovery

The single-Human mainline keeps the existing Agent identity, execution policy,
Room barrier and daemon runtime binding owners. This change repairs the Web
editor's acknowledgement handling; it does not implement a new scheduler or
change any Provider/memory policy.

Raft profile/runtime edit behavior is recorded in
[the Agent/Computer contract](agent-computer-profile-family.md) and the pinned
`docs/evidence/raft-ui-body-20260904.json` (AgentDetailPanel-BayGfy6W.js SHA-256
`e6ef1e2a3df4585e687d481a1a51f4b43983a8b5d13dcc5a61d652fbed53481f`).
That evidence does not prove how its private server retries configuration.
Multica's `packages/views/agents/components/inspector/runtime-picker.tsx` and
`components/tabs/runtime-config-tab.tsx` were inspected: they expose async
selection/save and provider-specific forms, not RAH's causal Room receipt
contract. No upstream code or unknown server algorithm is claimed copied.
The repair reuses RAH's existing `runRoomMutationAtLatest` and Kernel
`workspace-agent-management` exact requestDigest/idempotency receipt.

Previously the App re-read the current Agent revision and generated a new key on
every save. A committed save whose response was lost therefore made its own
retry look like another editor's revision conflict.

`agent-configure-command.ts` owns one editor's bounded, in-memory pending command.
Before first dispatch it checks the opened revision after the existing Room
barrier. Once dispatched it retains the exact wire body, including Room sequence
and key, for receipt replay. Only a typed stale-context rejection discards that
wire body and permits rebase; unknown failures do not prove nonacceptance.
A changed draft while the result is uncertain requires resolving the original
intent or reopening against current state. No browser persistence or second
business queue is introduced. Authorization remains server-side on replay.

App composes the same command for both configure editors. Late completion does
not update or close a newly selected navigation context. Restarting the browser
reads canonical Agent state; this helper does not claim cross-reload retry storage.

TDD covers ambiguous acknowledgement, conflicting edits, changed pending intent
and stale causal retry. The real browser gate uses an isolated fake-provider
daemon, forwards the first mutation to commit, drops its response, and retries via
the real UI. It asserts exact request identity, one revision, preserved Agent
identity/role and the canonical selected Runtime after reload. It does not invoke
paid CLIs or prove that a model read memory; those remain separate evidence gates.

Multica inspected revision: `11861145abc59a0d39c8c8f24ad837d4584e664f`.
Runtime picker SHA-256: `405e50845550a2092e8b3f515b5511ab8a126edd80e169ed679f37e3eb95e63a`;
runtime config tab SHA-256: `bf07010af538cdcc2fde821abd2160b5e9b6dddaa46f726f377d34cc626ee4b6`.
No source was ported in this repair; these are comparison references only.
