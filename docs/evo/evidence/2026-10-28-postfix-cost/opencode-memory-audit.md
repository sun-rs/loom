# OpenCode 1.19.4 native memory prerequisite

Source: https://github.com/anomalyco/opencode/tree/v1.19.4
Commit: `148842ef7cb1bc34192b3fff57d0f9721ab9c801`.
Installed CLI reports 1.19.4. This is a bounded audit of the selected DeepSeek
path, not proof about arbitrary configured plugins or future releases.

- `packages/opencode/src/index.ts`: `--pure` sets `OPENCODE_PURE`.
- `packages/opencode/src/plugin/index.ts`: pure removes external plugin origins;
  built-in plugins are provider authentication/integration plugins.
- `packages/opencode/src/session/instruction.ts` and `skill/index.ts`: existing
  Claude instruction/external skill isolation flags still apply.
- `packages/opencode/src/session/system.ts`: selected DeepSeek uses default
  prompt. Beast's memory-file instructions apply to the GPT-4/o1/o3 branch,
  not this model. No provider-owned automatic cross-session memory subsystem
  was found in the inspected session/config/plugin/skill composition.
- Normal conversation history and compaction are retained. User rule files
  are not described as automatic memory. The isolated fixed task supplies the
  same AGENTS.md to both arms. This is not OS-level global-file isolation.

Keep classification `not-applicable`, not an invented disable switch. Keep
exact-version rejection and require `--pure`, `OPENCODE_DISABLE_CLAUDE_CODE=1`
and `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` on native launches. Previous audited
versions remain verifiable. A new 1.19.4 acceptance test failed before adding
this exact revision; the focused memory/baseline tests establish launch guards,
not model quality or usage completeness.
