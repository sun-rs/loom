# Settings page family

## Scope and ownership

Complete the shared Settings composition before further page families. The
maintained visual owner is `packages/ui-tokens/src/neo-brutalist/settings.css`;
remove the migrated rules from `product.css`. Account uses the existing Human
mutation owner, Workspace uses typed `workspace.update` and the control-Room
causal baseline, and Push uses its existing subscription and sidebar owners.
Do not introduce mock domain state into production.

## Source and adoption

Public Raft entry inspected on 2026-09-05: `index-BVfbaScj.js`, CSS
`index-D8Neh8lc.css`, Settings chunk
<https://app.raft.build/assets/SettingsPanel-DHSayJ6f.js>.
Raw Settings chunk SHA-256:
`82aeff3dfec47b269824d1d955298b8d429e6c281d0e33691c92d3faa6eb4926`.
This is published minified code inspected as evidence, not original licensed
Web source or a production dependency. Adoption is structural port plus RAH glue.

Source components: `Yc` (Appearance: framed cards, unframed actual message
preview, saved-on-device status, labelled toggle), `Ec` (Workspace profile:
dirty submit, read-only slug, left save), notification section (yellow status,
green test, pink save, error and request feedback). Source CSS maps
`--color-soft-signal` to yellow; RAH's similarly named translucent hover token
is not interchangeable. Use the semantic yellow token for the status badge.

After the Mac was unlocked, the logged-in Raft 1.12.0 application was inspected
live on 2026-09-05. Its navigation still includes `language-region`; excluding it
was a real RAH defect, not a local-first product decision. The corresponding
published `Lc` component owns two separate forms: display/translation language,
and timezone/time format. RAH adopts that composition. Simplified Chinese and
the device timezone are truthful read-only values; 12/24-hour format is a real
device-local preference. Automatic/manual message translation remain disabled
and explicitly unsupported until a canonical translation owner exists. A
disabled control is not claimed as functional parity.
The privacy-safe observation manifest is
`docs/evidence/raft-settings-live-observation-20260905.json`; it is a
hash-pinned manual observation, not an automatically replayable capture or
published source file.

The current `Ec` does not contain the old screenshot's server-delete card.
Do not fabricate a local destructive action to reproduce that historical image.
Billing, central Apps/invitations/login remain outside local product scope.
MCP and LAN retain their existing service owners. Live inspection also confirms
that Raft Administration contains owner/admin assignment, system-channel,
translation, Human visibility, invitation/agreement and onboarding controls.
RAH's current-member summary is therefore only a projection, not Administration
feature parity. Resource placeholders and full administration/MCP behavior are
not claimed equivalent merely because they render in the shared shell. OS
notification delivery remains a device gate.

## Section-by-section adoption map

The Settings shell contains 12 RAH sections. This is a product inventory, not
a claim that Raft has exactly 12 tabs or that every section is feature-equal.

| RAH section       | Source category                               | Canonical capability / declared limit                                                                                                |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Account           | Raft 1.12 structure + RAH adaptation          | Real local Human profile mutation and local authorization; central connected-account/login functions omitted.                        |
| Language & Region | Raft 1.12 `Lc` structural port                | Chinese UI and device timezone are read-only; shared device-local 12/24-hour formatter is real; translation is visibly unavailable.  |
| Appearance        | Raft 1.12 `Yc` structural port                | Real device-local message size and live-activity preferences; production message renderer powers the inert preview.                  |
| Notifications     | Raft notification structural port             | Existing Push subscription owner and workspace mute; OS/iOS delivery is a separate device acceptance gate.                           |
| Server Profile    | Raft 1.12 `Ec` structural port                | Real typed Workspace update with canonical Room sequence; no fabricated server deletion.                                             |
| Administration    | Raft category, partial RAH projection         | Current membership and Agent counts are real; applicable ACL, system-Room, onboarding and directory-privacy controls are incomplete. |
| MCP Servers       | Raft category + RAH local implementation      | Real local MCP owner; no claim of parity with Raft's central recommended-integration catalog.                                        |
| LAN Devices       | RAH local extension                           | Real local LAN owner when available; explicit unavailable result on loopback development edges.                                      |
| About             | Raft composition + RAH adaptation             | Real local build/PWA/workspace information.                                                                                          |
| Docs              | Raft navigation category + RAH local resource | Local documentation destination; not copied central content.                                                                         |
| Feedback          | Raft navigation category + RAH local resource | Local diagnostics/feedback entry; no central support/account dependency.                                                             |
| Release Notes     | Raft navigation category + RAH local resource | Local release information; not a mirror of Raft release history.                                                                     |

Raft Billing and Apps remain intentionally omitted because central account,
commerce and hosted-app catalog behavior are outside RAH's local-first scope.

Loopback and Vite's development edge explicitly answer GET `/_rah/session`
with HTTP 200 `{ available: false }`, without cookies or upstream access. This
reports an absent LAN capability, not authentication; the HTTPS LAN gateway
keeps its existing authenticated/unauthenticated contract. Old 404 edges remain
read-compatible. Other LAN routes and mutations remain unavailable on loopback.

## State contract / TDD

- Pristine and invalid forms cannot submit, including Enter. Trim names.
- Background projection refresh must not overwrite a dirty draft.
- A changed client/entity invalidates pending reads, writes, uploads and errors.
- Failed baseline reads fail closed and expose retry. Never guess sequence + 1.
- Account and Workspace avatar uploads stay intents until canonical save.
- Role labels come from canonical membership, not a hardcoded owner badge.
- Device storage failure must not claim persistent success.
- Appearance preview consumes the real Markdown/reference grammar, not a
  second hand-written mention/tag/code renderer.
- Test desktop and 390x844, pointer/focus/keyboard/disabled, empty/error/late
  response, reload, all navigation tabs, and screenshot geometry. Fixture
  mutation success is not proof of production writes or OS Push delivery.

After implementation, independent review covers the cumulative dirty tree,
including earlier entity/Human/backend changes. Fix blocking findings, run the
full gates, then safe formal restart and read-only browser verification.
