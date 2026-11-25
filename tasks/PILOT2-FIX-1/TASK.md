# PILOT2-FIX-1 — Claude draft held on the v3 holder path (loomd-side, hot-fixable)

Do this AFTER finishing HOTSWAP-4's current step (or between steps); keep it small. Base: main HEAD. Do not commit.

Evidence (read-only): pilot-2 Auditor (Claude 2.1.331 TUI, v3 holder, release 22b96cca, pane t3fj — do NOT type into it). Delivery `ff487830-3974-43cd-9151-8c90b4e63390`, a 3-line, 79-char Loom drift notice, went `sending/uncertain`, status `draft-held`, loomd log `TUI submit unconfirmed`. Screen captured at /Users/sun/Code/exp-relay/pilot2-held/t3fj-screen.txt, inbox state at /Users/sun/Code/exp-relay/pilot2-held/inbox-state.json, pilot loomd log /Users/sun/Code/loom-pilot2/.project/loomd.log, holder journal under the pilot's .project (read-only). The draft was unwrapped and uncollapsed — FIX-4 should have accepted it. Super pressed Enter once (counted as manual intervention #1 of pilot-2); it then became `received`.

Find the root cause on the v3 path (grid rebuilt from journal vs live grid? isWrapped flags? Enter written before Claude finished ingesting the paste — see Orca `native-chat-paste-landed`? CAS write refused and not retried?). Fix in loomd (not holder), regression test from the captured journal/screen, verify live with native Claude (absolute path, isolated HOME). Then Super will hot-upgrade the pilot's loomd — the fix must take effect for the already-running Auditor without restarting it; state explicitly if it cannot.
RESULT.md Chinese, `STATUS: done`. Red lines as before.
