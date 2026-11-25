# HOLDER-HARDEN-1 — make the native holder boring and proven

Base: main @ 52219963 (HOTSWAP-3/4, UPGRADE-FAIL-1, ADOPT-1 merged). The holder (holder/holder.c, ~700 lines C, owns every live PTY/pipe) must be the most stable component in loom: if it crashes, the CLI's terminal is lost. Do not add features; only prove and harden.

1. **Memory/UB safety**: build test variants with `-fsanitize=address,undefined` (and `-fsanitize=thread` if threads exist) and run the whole holder test suite + the HOTSWAP-3 matrix runner against them. `clang --analyze` / `-Weverything` with justified suppressions only. Zero findings or each fixed.
2. **Fuzzing**: libFuzzer (or AFL++) harnesses for the frame decoder, manifest parser, journal segment reader and write-guard evaluation; ≥ 30 min per harness; corpus + any crashers committed as regression tests.
3. **Soak**: 4 CLIs (isolated HOME, absolute binaries, local mocks) × 6 h with high output rate (scrollback churn, alt-screen, resize every few seconds, UTF-8), loomd restarted every 20 min and holder handed off every 30 min. Assert: no fd/memory growth beyond bounds (sample `lsof -p` count, RSS), journal size within cap and rotation correct, zero lost/duplicate bytes by offset, every delivery confirmed exactly once.
4. **Chaos**: kill -9 loomd at random points incl. mid-frame and mid-write; SIGSTOP/SIGCONT holder; disk full on journal dir; socket dir removed; hc core update (`hc update` only if a safe local path exists — otherwise state it is untested); outer terminal resize storm. Document the exact behaviour for each and make every failure explicit (`gap`, `exited`, refusal) — never silent.
5. **Independent review**: produce a review brief; Super will have a different-vendor reviewer read holder.c line by line.
6. Linux: if no container runtime exists locally, say so; do not claim Linux runtime coverage.

RESULT.md Chinese, `STATUS: done`, numbers for every item, uncommitted for Super review. Red lines as all prior cards.
