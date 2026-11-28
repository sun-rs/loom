# DLV-CCP-1 验收记录

## 现场诊断

2026-11-28 使用 `d6b4e26f` 的 `loom status --project <绝对路径> --json` 和 `loom state`，核对两套项目的 `.project/loomd` 状态与投递回执。Claude transcript 核查限于文件名、mtime 与尾部记录的 `type`。

| 项目 | Auditor / 投递 | 恢复后仍在写入的 transcript | 核查结果 |
| --- | --- | --- | --- |
| pilot-cell | `loom-a9ef7e1f` / `c8032531` | `dd8f3c43-2781-4f75-8c80-7a259c3d3137.jsonl`，mtime 15:36:45 +0800 | 约 1,460 秒仍在 `waiting-writable`。holder 记录原生状态 `idle`、屏幕 `unknown`、`composerEmpty=false`，画面可见空 `❯`。 |
| pilot-2 | `loom-3f4df1ff` / `2c0fc285` | `296091e4-ad89-4b92-80d9-d7968f4e4a31.jsonl`，mtime 16:00:15 +0800 | 投递在约 10 小时 11 分后由同一原生会话确认。核查时 holder 报 `idle`、`composerEmpty=true`。历史卡住时的画面未能核实。 |

两边 Loom 会话和 holder 均绑定原生恢复 ID，对应文件仍在原项目目录更新，两边的状态均报告 `hookGap.source=transcript`，表明该轮从 transcript 获得收尾证据。pilot-cell 的屏幕根因已复现：Claude 在空输入框下显示 `new task? /clear to save 433.4k tokens`，原有页脚白名单把该行判为未知内容。原生状态已识别为空闲，但 holder 仍要求屏幕证明输入框为空，导致消息一直排队。

## 修复与验证

- Claude 屏幕识别器接受完整的上下文节省提示。写入仍要求空输入框、安静的终端及符合条件的原生状态。现场画面经本地修正后的识别器重判为 `idle` 且 `empty=true`。
- 回归夹具以同一原生 ID 切换前后 transcript 路径，验证旧路径的写入和复制来的历史收件记录无法冒充恢复后的回执。原生忙碌、屏幕忙碌、模型选择器和未知页脚均拦截写入。回归在修复前以 `composer-not-proven-empty` 失败，修复后确认一次投递及一次原生收件。定向套件 56 项通过。 [RED](/private/tmp/loom-dlv-ccp-red.log) · [GREEN](/private/tmp/loom-dlv-ccp-targeted.log)
- 两个现场均在约 2 分钟时生成 `delivery-stalled`，通知状态记录 `pushRoute=external` 与 `pushedAt`。pilot-cell 同时出现在 `status --json` 的 `stalledDeliveries` 和 `health.alerts`。另用假时钟验证，只有一条未确认的 Claude Auditor 投递时，2 分钟后状态显示投递停滞并向 Super 推送通知。项目整体无活动达到 30 分钟时告警，2 小时时触发桌面通知路由。 [告警回归](/private/tmp/loom-dlv-ccp-alarms.log)

验证使用 `PATH=/Users/sun/.loom-cell/runtime/node-26.13.1/bin:$PATH`，Node 版本为 26.13.1。`npm ci` 和 `npm run lint` 通过。全量 `npm test` 通过 1,164 项，失败、取消、跳过均为 0。 [安装日志](/private/tmp/loom-dlv-ccp-npm-ci.log) · [Lint 日志](/private/tmp/loom-dlv-ccp-lint.log) · [全量测试日志](/private/tmp/loom-dlv-ccp-npm-test.log)

两个 pilot 的核验限于只读诊断，写入与原生收件均在隔离夹具中验证。

STATUS: done
