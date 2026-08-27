# Web browser behavior fixtures

These fixtures exercise the real React product composition with a typed in-memory `RahClient`. They never read a Human PAT, connect to the daemon, or launch an Agent CLI. Vite's production build has only `index.html` as an entry, so files in this directory are test-only.

Start the development server and open:

```text
http://127.0.0.1:4173/test/room-agent-membership.html?run=<unique-id>
```

Changing `run` creates an isolated browser-fixture state.

## Required interaction matrix

| Surface                | Action                                           | Required visible result                                                                                 |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Mobile navigation      | Open Rooms from Chat or Agents                   | Rooms is the only active bottom destination; close/select restores the previous destination             |
| Room drawer            | Select a Room                                    | Drawer and backdrop close; Chat is active                                                               |
| Chat                   | Post a Message                                   | Composer clears; Human body and one reply per joined fixture Agent render                               |
| Chat attention         | Type `@Handle`, add/remove a Room Agent          | Mention badge changes attention only; Room membership remains the delivery scope                        |
| Thread                 | Create and reply                                 | Thread opens, reply renders, composer clears, reply count survives reload                               |
| Task                   | Create from composer                             | Task appears in the Task board and Task navigation is active                                            |
| Agent directory        | Create/open a Workspace Agent                    | Manager creates a durable identity bound to an available Runtime; reload keeps the new catalog entry    |
| Agent settings         | Edit, disable, enable, or delete                 | Definition/Policy revisions and lifecycle are canonical; active work blocks unsafe disable/delete       |
| Computer inventory     | Open Computer page                               | CLI/Runtime evidence renders read-only and never mutates Room membership                                |
| Room members           | Add/remove/rejoin/concurrent join                | owner/admin + capability controls enabled state; cross-Workspace Agent onboarding fails closed          |
| Dialog keyboard        | Open create/member dialog; use Tab/Escape        | Focus stays inside, Escape closes when idle, and focus returns to the trigger                           |
| Capability degradation | Open Files                                       | Explicit unavailable view renders; no fixture success is invented                                       |
| Placeholder controls   | Search/Activity/notifications/settings/bookmarks | Control is disabled, not silently clickable                                                             |
| Recovery               | Reload                                           | Selected `?room=` and canonical data restore; long Message catch-up resumes without horizontal overflow |

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
