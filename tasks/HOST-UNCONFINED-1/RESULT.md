# HOST-UNCONFINED-1 验收

- 分支 `infra/host-unconfined`，基线 `f17576f7264ce5b8aac868ff9aa74042678059b1`，工作树 `/Users/sun/Code/repos/loom-host-unconfined`。
- 本机核对 `/usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true` 退出 0，非嵌套 Seatbelt 受限环境，全部 macOS Seatbelt 用例实际执行（0 跳过）。

## RED 复现

先增补回归用例再改实现，运行定向 RED：

- `/opt/homebrew/bin/node --test --test-name-pattern='unconfined host grants bypass|unconfined host grant persists|Claude headless host uses Seatbelt|agy host worker bypasses sandbox-exec|unconfined host grants require Super|Status TUI highlights unconfined' daemon/host-grants.test.mjs daemon/adopt-launch.test.mjs daemon/hardening.test.mjs daemon/supervisor.test.mjs cli/status-tui.test.mjs` 与 `daemon/socket-auth.test.mjs` 均失败退出 1：
  - `daemon/host-grants.test.mjs`：`hostWriteBoundary` 在 `unconfined: true` 下仍返回 `.../agy-unconfined/host-native`（包装 `/usr/bin/sandbox-exec`）；`hostGrants` 持久化结果缺少 `unconfined: true`。
  - `daemon/adopt-launch.test.mjs`：Claude host worker 在默认 grant 下走 `host-native` 且内层 `sandbox-exec` 退出 71；在 `unconfined: true` 下仍返回 `wrapped: true, sandboxExecStatus: 71`。
  - `daemon/hardening.test.mjs`：`agy` host worker 的 `--unconfined` grant 未保留 `unconfined: true`。
  - `daemon/supervisor.test.mjs` & `daemon/socket-auth.test.mjs`：`loom grant ... --unconfined` CLI 拒绝未知选项，RPC 未保存 `unconfined: true`。
  - `cli/status-tui.test.mjs`：Status TUI Board/Workers 未标注 `unconfined`。

## 实现摘要

- 授权与 CLI（`lib/worker-tiers.mjs`、`cli/control.mjs`、`cli/loom.mjs`）：`loom grant <task|wave> host` 新增 `--unconfined` 布尔选项，沿用必填 `--reason`、绝对路径 `--write`、正整数 `--uses`/`--ttl` 校验与 `roles.worker.tiers` 预授权不放开 `unconfined`；签发仍由 `daemon/socket-auth.mjs` 与 `daemon/supervisor.mjs` 限制为仅已认证 Super（非 Super 签发返回 `forbidden`；Leader 仅可用 `--request --unconfined` 发起 `needs-decision` 申请）。
- 外层 Seatbelt 免除（`daemon/host-worker.mjs`、`daemon/host-grants.mjs`、`daemon/sessions.mjs`）：`hostGrants` 持久化并在 `binding()` 传递 `unconfined: true`；`hostWriteBoundary` 在 `row.hostGrant?.unconfined === true` 时对任意 CLI 直接返回原可执行路径（不生成 `host-native`，不经 `/usr/bin/sandbox-exec`），同时设置 `LOOM_HOST_UNCONFINED=1` 并保留 `LOOM_HOST_GUARD=1` 最佳努力钩子与 Codex 原有免除逻辑；默认 host grant 对非 Codex CLI 仍保持外层 Seatbelt 写入边界。
- 回执、通知、证据与状态页（`daemon/host-grants.mjs`、`daemon/supervisor.mjs`、`evidence/host.mjs`、`cli/status.mjs`、`cli/status-view.mjs`）：
  - `grant` / `spawn` / `state` 回执包含 `unconfined: true` 及 `unconfined` 警告；
  - `host-tier-grant` / `host-tier-used` / `host-tier-refused` / `host-tier-expired` 与 Leader 申请通知标记 `unconfined: true` 与 `Host (unconfined)`；
  - host 审计证据卡 `verification.host` 记录 `unconfined: true` 与对应覆盖说明；
  - `loom status`（`Elevated workers` 行显示 `host/unconfined`，`--json` 输出 `unconfined: true`，离线读盘同样保留）及 `loom tui`（Board 摘要显示 `N unconfined`，Workers 列表与详情浮层显示 `[host/unconfined]` / `Tier: host/unconfined`）。
- 文档（`docs/HEADLESS.md`）：补充 `## host 档` 一节，说明默认 Seatbelt 写入边界、Codex 例外及 Super 专属 `--unconfined` 与审计呈现。

## 验证

- `/opt/homebrew/bin/npm run lint`：`Loom lint passed (331 files).`
- 定向回归（7 项）：`daemon/host-grants.test.mjs`、`daemon/adopt-launch.test.mjs`、`daemon/hardening.test.mjs`、`daemon/supervisor.test.mjs`、`daemon/socket-auth.test.mjs`、`cli/status-tui.test.mjs` 全部通过（覆盖 agy/claude 默认与 `--unconfined` 的真实 `sandbox-exec` 71 vs 0 行为、Codex 默认免除不变、非 Super 签发拒绝、计次与到期、回执/通知/证据卡/状态页/TUI 显示）。
- 全量 `/opt/homebrew/bin/npm test -- --test-concurrency=4`（含 `pretest` lint）：886 项通过，0 失败，0 跳过。注：不限并发的默认全量运行出现 7 项无关子进程 5s/10s CPU 争抢超时（含 `hc`/`account-refresh`/`holder`/`worker-environment`），按 `--test-concurrency=4` 重跑全量 886/886 通过。
- `/usr/bin/git diff --check` 通过。

STATUS: done
