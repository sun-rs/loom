# L1-EVAL-0 reviewer pack

Nine native sessions cover three Codex workers, three agy workers and three Claude TUI sessions. A supplemental headless sample pairs an OAR relay journal with its native Codex transcript. For each sample, start with section B for L1 and the adjacent activity digest, then use C for filtered L2, D for `--diff`, E for evidence and A to check the native final replies. The tables show UTF-8 bytes and approximate tokens for each view against the full JSONL transcript. The estimate divides bytes by four and rounds up.

## Samples

| Session | Origin | Turns | L2 focus |
| --- | --- | ---: | --- |
| [Codex H0 T1](codex-h0-t1.md) | Worker, H0 | 1 | Turn 1, parser tests and `--outcome quota` |
| [Codex H1 T2](codex-h1-t2.md) | Worker, H1 | 1 | Turn 1, shell checks selected by `--outcome failed` |
| [Codex Orca T2](codex-orca-t2.md) | Worker, Orca | 1 | Turn 1, failed directory check followed by successful tests and an Orca receipt |
| [agy H0 T3](agy-h0-t3.md) | Worker, H0 | 1 | Turn 1, parser tests and exit output |
| [agy H1 T4](agy-h1-t4.md) | Worker, H1 | 1 | Turn 1, screen parser tests |
| [agy Orca T4](agy-orca-t4.md) | Worker, Orca | 1 | Turn 1, failed and successful test runs, `--outcome quota` and an Orca receipt |
| [Claude runtime probe](claude-runtime-probe.md) | CLAUDE-TUI-RT-0 probe | 3 | Turn 3, user interruption during Bash |
| [Claude runtime final](claude-runtime-final.md) | CLAUDE-TUI-RT-0 live run | 5 | Turn 3, user interruption followed by recovery and a queued prompt in the same session |
| [Claude indexed coordinator](claude-loom-cli.md) | LOOM-CLI-0 verified run | 3 | Turn 1, worker dispatch. Section E includes both `W-SMOKE` evidence cards. |
| [OAR headless supplement](oar-headless-codex.md) | LOOM-CLI-0 verified Codex worker | 1 | Turn 1, smoke test, native tool activity and the OAR journal’s turn record |

The six worker IDs come from `exp-relay/runs/20261124165640-99591/sessions.json`. The Claude probe and final session come from the runtime task’s native profiles. The TUI-REL-0 runtime hooks point to three native files that are absent. The indexed coordinator uses `loom hist` directly for L1, L2 and the wave cards.

Each sample includes the actual diff result for every turn. The experiment repositories have only their initial commits in the retained refs, and the selected turns have no recorded closing commit. `missing-boundary` leaves the commit-based file count unknown. The indexed coordinator’s worker wave supplies two Loom cards. The headless supplement shows the same Codex card attached to its own turn. The Orca receipts record `worker_done` for the matched dispatches.

## Questions for both reviewers

1. For which sample could you have skipped the raw transcript after reading L1? Name the action or decision you could take from L1 alone.
2. Which fact did the activity digest add to L1? If a decision still required L2, the native reply or the transcript, where did you find the missing evidence?
3. Which L1 line or outcome tag could mislead a coordinator or auditor? Give the sample, the wording and the native evidence you used to check it.
4. Did the L2 filters show enough command and result context to distinguish an expected check failure, a recovered test run and an interrupted turn? Which filter would you change first?
5. How did `missing-boundary`, the available evidence cards or the Orca receipts affect what you could verify about files, tests and claims? Which source would you open next?
6. In the five-turn Claude run, could you reconstruct the interruption, recovery and final outcome from L1? At which turn would you open a larger view, and was its size warranted?

## Observed extraction bugs

- **False `quota` tag.** Codex H0 T1 passes `--outcome quota` with `errors: []` and only zero recorded exit codes. The scan includes the output of tools with `exitCode: null`, and the native specification text at lines 19 and 22 contains the literal state name `rate-limit`. In agy Orca T4, line 39 is an actual test failure whose output names `agy-rate-limit-synthetic.txt`. The same matcher tags that turn as `quota`. [Codex H0 T1](codex-h0-t1.md#c-filtered-l2--turn-1) · [agy Orca T4](agy-orca-t4.md#c-filtered-l2--turn-1)
- **Duplicate failure diagnostic in L1.** Codex Orca T2 prints the same `ls -d lib test` failure twice. agy Orca T4 does the same for the failed `node --test` command. Both the history wrapper and the native adapter emit the diagnostic. [Codex Orca T2](codex-orca-t2.md#b-loom-hist-l1) · [agy Orca T4](agy-orca-t4.md#b-loom-hist-l1)
- **Claude prompt wrappers consume the L1 task preview.** In the indexed coordinator sample, the task previews end inside `<pasted_content>` or `<hc>` and `[loom:…]` wrappers. The prompt body is present in L2 for the dispatch turn. [Claude indexed coordinator](claude-loom-cli.md#b-loom-hist-l1)
- **The Codex smoke evidence card omits a recorded test.** The headless supplement’s card says `验证 无可确认测试命令`. The same turn’s native command result supplies exit `0` and `1` test passed for `node --test smoke.test.mjs`. [OAR headless supplement](oar-headless-codex.md)

## Reproduce a sample

Run from the repository root. The script prints Markdown to stdout and uses Loom’s own history reader and native adapters for sessions outside the index.

```sh
node tasks/L1-EVAL-0/read-sample.mjs claude-runtime-final
```

[`activity-digest.mjs`](activity-digest.mjs) also runs by itself. Pass `codex`, `agy`, `claude` or `oar`, then a native JSONL file and optionally the session working directory. OAR mode accepts flat `Session.events()` records, raw frames, `oar-voyage/3` records and Loom’s relay journal. The headless supplement shows the archived journal’s outcome beside the native tool activity for the same turn.

`?` indicates missing evidence. File reads come from explicit tool paths and literal operands of recognized successful shell reads. Edits marked `reported` have a tool result or completion. `requested` indicates a tool input with no matched result, and `failed` indicates a tool-reported failure. Edit counts come from recorded patches or tool reports. An explicitly reported net line count appears as `net`. Tests are reported per invocation from observed output. The prototype does not evaluate shell code, open cited files or infer hidden file effects from arbitrary commands.
