# Web browser behavior fixtures

These fixtures exercise the real React product composition with a typed in-memory `RahClient`. They never read a Human PAT, connect to the daemon, or launch an Agent CLI. Vite's production build has only `index.html` as an entry, so files in this directory are test-only.

Start the development server and open:

```text
http://127.0.0.1:4173/test/room-agent-membership.html?run=<unique-id>
```

Changing `run` creates an isolated browser-fixture state.

## Parity reinforcement regression gate

`npm run check` also runs `npm run test:parity:regression`. This independent
audit harness extracts the actual application callbacks and renders selected
actual components; it does not replace them with an invented reference model.
Controlled promises/clocks cover navigation ownership, old completion safety,
Activity filter/Thread route composition, Inbox reconciliation/deadline/cleanup,
and clipboard retry feedback. It complements—not replaces—real browser evidence
at 1440×900 and 390×844. Use separate fake fixtures/ports, never the live state.

## Required interaction matrix

| Surface                | Action                                           | Required visible result                                                                                                                     |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile navigation      | Open Rooms from Chat or Agents                   | Rooms is the only active bottom destination; close/select restores the previous destination                                                 |
| Room drawer            | Select a Room                                    | Drawer and backdrop close; Chat is active                                                                                                   |
| Chat                   | Post a Message                                   | Composer clears; Human body and one reply per joined fixture Agent render                                                                   |
| Chat attention         | Type `@Handle`, add/remove a Room Agent          | Mention badge changes attention only; Room membership remains the delivery scope                                                            |
| Thread                 | Create and reply                                 | Thread opens, reply renders, composer clears, reply count survives reload                                                                   |
| Task                   | Create from composer                             | Task remains a numbered top-level Message, appears on the board, and owns one canonical Thread                                              |
| Task review            | Agent progresses/submits, Human opens discussion | Progress/result render as Thread replies; at 1280×720 the reviewed card remains a real pointer target and completes while Thread stays open |
| Agent directory        | Create/open a Workspace Agent                    | Manager creates a durable identity bound to an available Runtime; reload keeps the new catalog entry                                        |
| Agent chat directory   | Open an Agent's Chat tab and choose a Room       | Only mutual canonical Rooms render; choosing one opens the actual Room Chat surface                                                         |
| Agent settings         | Edit, pause, resume, or delete                   | Pause stops new placement and safely cancels an active lane; delete still requires fully quiescent work                                     |
| Computer inventory     | Open Computer page                               | CLI/Runtime evidence renders read-only and never mutates Room membership                                                                    |
| Room members           | Add/remove/rejoin/concurrent join                | owner/admin + capability controls enabled state; cross-Workspace Agent onboarding fails closed                                              |
| Dialog keyboard        | Open create/member dialog; use Tab/Escape        | Focus stays inside, Escape closes when idle, and focus returns to the trigger                                                               |
| Capability degradation | Open Files                                       | Explicit unavailable view renders; no fixture success is invented                                                                           |
| Managed MCP Settings   | Open without capability                          | Explicit unavailable state; the real-daemon Chrome gate owns discover/create/assign/disable coverage                                        |
| Placeholder controls   | Search/Activity/notifications/bookmarks          | Control is disabled, not silently clickable                                                                                                 |
| Recovery               | Reload                                           | Selected `?room=` and canonical data restore; long Message catch-up resumes without horizontal overflow                                     |

Any newly enabled control must first gain a typed fixture handler and a browser assertion. A control without a business implementation must be visibly disabled or render an explicit capability-unavailable state.

## Real daemon browser gate

Automated desktop, keyboard, membership, delivery-scope, reload, and mobile
coverage runs in an installed Chrome/Chromium browser through its native DevTools
protocol:

```text
npm run test:web:browser
```

Set `RAH_BROWSER_EXECUTABLE` when Chrome/Chromium is installed outside the common
macOS/Linux locations. The gate creates an isolated daemon database, Human
credential, browser profile, ports, and fake Agent runtimes, then deletes them.
It never launches a paid provider. Its fixture announcement contains only public
ephemeral IDs and loopback origins; the Human PAT stays in the Vite proxy process.
This gate is also a required CI step, so a pull request cannot pass only on typed
or fixture-level tests while the real browser business flow is broken.
The fixture seeds 130 canonical Messages before any Agent joins. Chrome must
render only Raft's latest 50-Message window, expose the earlier-history control,
prepend exactly one 50-Message page, and keep the previously visible Message
within 2px of its viewport offset. This proves bounded initial/history network
and one real scroll-anchor transition while keeping the mounted Message DOM
bounded.

The dedicated large-history gate renders the real `ChatPane` with 10,000
variable-height Messages, prepends another 50, and requires no more than 80
mounted Message rows, a fully scrollable logical history, a preserved visible
Message anchor within 2px, and zero browser console/page errors:

```text
npm run test:web:message-timeline
```

It starts only Vite and an installed Chrome/Chromium browser. It does not start
the daemon, read credentials, or launch a paid Provider.
It also right-clicks an existing top-level Message, converts it through the
typed `task.convert` route, proves the existing Thread history is reused, and
proves a Thread reply never exposes the conversion action.
From the Tasks toolbar it opens the Raft create dialog, creates another Task,
and proves its numbered board card, top-level Chat Message, canonical Thread,
Agent submission, and Human completion all refer to one durable object. The
review regression keeps the Task Thread pane open, shrinks the desktop viewport
to 1280×720, dispatches a native pointer click to `确认完成`, and rejects a
DOM-only `element.click()` success when the card is actually covered by the
Thread column.

The persistent production entry has a separate gate:

```text
npm run test:web:workbench
```

It builds the trusted-proxy production bundle, starts an owner-private persistent
state root twice, and uses a fake `codex` executable through the real
RuntimeProfile/AgentHost/Worker path. Real Chrome must open without a Human token
form, render the canonical Agent reply after restart, and remain overflow-free at
390×844. The test never discovers or runs an installed paid Provider.

The same production entry also has an independent Playwright Firefox gate:

```text
npm run test:web:firefox
```

It uses an isolated persistent Core plus fake Codex, and verifies the 1440×1000
shell, Raft 64px rail, authored standard thin-scrollbar rule, Agent directory,
Settings, 390×844 mobile navigation/Room drawer, zero horizontal overflow, and
zero page/console errors. The Web bootstrap selects Zod's CSP-safe jitless mode
before importing protocol schemas, so the strict production CSP remains intact;
the gate must never be made green by adding `unsafe-eval`.

For exploratory inspection, run:

```text
npm run dev:web:multi-agent-fixture
```

Then open the printed `webOrigin` (default `http://127.0.0.1:4174`). The command starts an ephemeral database, a real daemon, two deterministic Fake CLI runtime profiles, and a loopback Vite proxy. Alice begins as a Room member; Kimi is available from the Room member dialog so onboarding is part of the test.

The proxy holds the ephemeral Human PAT server-side and replaces the browser's non-secret development header. The page, URL, Local Storage, and fixture output never contain the PAT. This bypass is available only when `RAH_DEV_ACCESS_TOKEN` is set for the development server; it does not alter production authentication.

For an iPhone/iPad on the same trusted LAN, run:

```text
npm run dev:web:multi-agent-fixture:lan
```

Open one of the printed `lanOrigins`. This explicitly binds the ephemeral test UI to `0.0.0.0`; stop the command after testing. The daemon remains loopback-only and the PAT remains in the same-origin development proxy, but anyone who can reach that temporary LAN origin can exercise the fixture's Human authority while it is running.

## Installed local CLI inspection

To inspect the same UI against the supported Agent CLIs discovered on this Mac,
without copying a bearer token into the browser, run:

```text
npm run dev:web:local-cli-fixture
```

Open the printed `webOrigin`. The fixture creates the Agent definitions in the
same product Workspace shown by the page, starts the daemon and same-origin Vite
proxy, and prints no Human credential. Merely starting it probes executable
availability; a paid CLI is launched only after a Room action creates work for
that Agent. Use `npm run dev:web:local-cli-fixture:lan` only for a temporary test
on a trusted LAN, then open one of its printed `lanOrigins`.

Required sequence:

```text
Workspace Agent directory and read-only Computer/Runtime inventory
create channel -> add Alice + Kimi from Room members
Human Message -> Alice + Kimi replies -> remove one Agent
Thread create -> Human reply -> canonical reply count -> close
open Task -> one Agent wins -> submitted -> Human complete
reload -> selected ?room=, Messages, membership, activity, and Task recover
create/member dialogs -> Tab loop + Escape + trigger focus return
390x844 -> Rooms drawer + Chat/Task/Agents navigation remain usable
```
