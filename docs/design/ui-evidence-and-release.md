# UI evidence and safe local release

This batch builds on milestone `5b3f48f`. It does not add another UI theme,
business state machine or Computer upgrade coordinator.

## Restart guard

The development workbench release tool owns this sequence: verify frozen assets,
inspect exact incumbent and active work, create an exclusive private online SQLite
backup plus file backup, verify it, recheck incumbent/work, then send SIGTERM and
await exit. Every step must return positive evidence; exceptions or false receipts
stop the sequence. No force-kill, restore-over-live-data or automatic deletion.

Reuse the existing asset snapshot validator, SQLite online backup and the current
workbench signal/drain owner. This is RAH operational glue, not copied Raft code.
Each SQLite copy is normalized to DELETE journal mode, checked for integrity and
foreign keys, synced and hashed. The receipt fixes both the exact database set
and SHA-256 contents; a healthy-but-rewritten database fails verification.
It is not a transactional maintenance lock: operators must avoid simultaneous
mutations during release, and the existing daemon owns any last-moment drain.
The macOS installed-service/K upgrade path is separate and unchanged.

Build and run required checks first. Then use
`npm run restart:local-workbench -- --pid <exact-pid> --state <absolute-state-child> --build <verified-web-build-id>`.
The command requires the PID to own the exact database, listener and checkout.
It never guesses a process or installs a provider. It keeps the successor in the
foreground and forwards signals; browser/build-identity acceptance is a separate
required step. If startup fails after stop, keep the backup and restart the known
good frozen build manually; this tool does not claim automatic rollback.

## Minimal comparison runner

Compare the current library/production owners with a versioned official capture.
Start with header, header action/icon and Tabs; do not generate a second rendered
reference app. Capture only geometry, computed styles, state and focus outcomes,
not messages or credentials. Pin viewport/DPR, state prerequisites, source and
implementation hashes. Report matched, different, approved local difference or
uncomparable; missing values and changed prerequisites are never green.

Keep official live capture, official capture replay and reconstructed reference
labels separate. The local capture is automated and the diff is generated. The
reviewed semantic pairing is maintained by humans. Refreshing a baseline requires
new official evidence; do not accept local output as the official baseline.

`npm run test:web:ui-compare` starts the existing isolated canonical fixture,
captures actual production components in installed Chrome and emits a temporary
`report.json`, `report.md` and screenshots. Nonmatching/missing measurements or
runtime errors produce a nonzero exit. The report is labeled
`official-capture-replay`, never live parity. The initial sample is a live Raft
capture from 2026-09-04; its script URL and SHA-256 are verified independently.
Only matching data-independent properties are paired: different Room messages,
font fallback rasterization and whole-page pixels are not compared. Fonts must
finish loading. Exact achromatic color aliases and transparent zero shadows are
normalized; missing properties are not ignored, and an empty scenario plan is
rejected. `scripts/ui-evidence-inputs.mjs` owns the input manifest shared with the
foundation runner: Web/package sources and tests, scripts, package/configuration
and lock files, plus registry/library/adoption-referenced evidence. Both bytes
and the re-enumerated file set are checked at completion, including newly added
or removed inputs. Generated builds and third-party node_modules are not source
inputs; their dependency declaration/lock files are included. This is not a hash
of the user's machine or every historical document.

The command also runs `ui-shell-comparison-plan.json`: five additional frozen
Settings/Room header samples at mobile, short desktop and standard desktop.
Only the explicit read-only `room` and `settings-notifications` routes are
accepted. It compares header tracks, title typography and identity tile/glyph
geometry; a hidden mobile tile is not paired. CI runs both plans. This adds
measured property coverage, not a percentage of complete product behaviors.

Refresh procedure: open the official page, inspect current selectors/components,
record viewport/DPR and loaded fonts, collect read-only computed styles for
header/actions/icons/tabs and actual End/Home focus+selection observations, then
freeze the content-free capture and update its digest in `ui-comparison-plan.json`
after review. Unknown states remain absent. No credentials or message bodies are
included. Baseline refresh/authenticated capture remains operator-assisted;
scheduled upstream discovery is not implemented.

TDD covers failed release stages, real WAL backups, missing/drifting evidence and
comparison classification. Existing Chrome/Firefox foundation and integrated
business gates continue to cover interactions and layout composition. This small
runner does not replace them or claim whole-site coverage.
