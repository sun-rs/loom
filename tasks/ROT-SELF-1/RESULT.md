# ROT-SELF-1 结果

基线 `c79e43b1`，含 ROT-PASTE-1 尚未提交的改动。两张卡的改动均留在工作树。

## 自助换班

- Leader 和 Auditor 用 `"$LOOM_BIN" rotate --self --prepare` 获取交班单路径和在途卡片，再用 `"$LOOM_BIN" rotate --self` 发起换班，可附 `--reason`。loomd 核对交班单至多 60 行或 12 KB，并要求列出在途卡片。前任原生回合空闲后才启动接任者，沿用角色、CLI、模型、effort、模式、目录、项目和 Herdr 角色标签页。Super 可显式覆盖 CLI、模型或 effort。保留 `spawn --handover-from`。
- SHA-256 寻址的完整简报包含角色判断、章程和裁决账本、项目记忆索引、开放卡片和波次、在途结果及投递、最近门禁裁决和原文路径。接任首轮通过原生投递校验并回送文件末尾的确认码之后，loomd 才切换角色路由并退休前任。
- 上下文预算及配置的门禁信号随下一条现有投递附送。到三次后续投递回合或 15 分钟仍未交班时，Leader 升给 Auditor，Auditor 升给 Super。第一次确认失败后前任继续，在下一次现有投递收到原因并可重试一次。第二次失败升级。Leader 成功的通知随 Auditor 的现有投递附送，Auditor 成功进入 Super 通知。角色启动提示及 Loom 技能包含操作步骤和交班模板。

## 角色投递

- `loom send leader|auditor` 只匹配当前唯一已接任的活会话。退休、结束和尚待确认的接任者不参与匹配。在线 `loom state` 和 `loom stop` 的角色名使用同一路由。已有队列投递保留原 ID，在确认后可跟随角色。
- 外部 `--from super` 以独立 Super 发送者身份入账。送达或失败回执以及 `--expect-reply` 请求的确认回复进入项目通知。托管的非 Super 角色不能借用该身份。

## 验证

- agy 1.5.17 Leader 和 Claude Code 2.1.331 Auditor 分别完成三次隔离原生 TUI 自助接任。以各会话地址调用真实 CLI，比对前后配置、简报 SHA 和原文判断。六次首条输入均为 366 字节，原生确认各一次，前任在确认后退出。
- Claude Auditor 的另一次实机验证有意漏掉两次确认码。第一次保留前任，失败原因搭载外部 Super 发来的现有投递，Super 通知收到了回执及请求的答复。第二次保留前任并触发一次升级，第三次自助请求被重试上限拒绝。上述实机使用隔离 HOME、独立 Core、绝对路径原生 CLI 和回环模型端点，人工按键为零。Herdr 项目标签页由回归覆盖，pilot-2 现场未操作。
- 全量 `npm test` 通过 716 项。定向回归覆盖空闲等待、在途卡片、普通投递中的通知、两种升级边界、失败重试和在线角色名。Loom 技能校验和 `git diff --check` 通过。

[agy 自助接任](/private/tmp/rl-SHLEL4/evidence.jsonl) · [Claude 自助接任](/private/tmp/rl-0Fnv4n/evidence.jsonl) · [Claude 失败、重试和升级](/private/tmp/rl-vluAwS/evidence.jsonl) · [全量回归](/private/tmp/rot-self-final-npm.log) · [CLI、daemon 和简报回归](/private/tmp/rot-self-final-targeted.log)

STATUS: done
