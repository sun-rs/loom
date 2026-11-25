# OAR-INTEG-0 结果

## 集成与验证

- 项目内锁定 npm 发布包 `@botiverse/oar@0.130.1`。实测环境为 Node 25.9.0、hc 0.1.22、Codex 0.171.0、agy 1.5.16。胶水实现 240 行，另有单元测试和依赖锁文件。[npm 发布记录](https://registry.npmjs.org/@botiverse%2foar/0.130.1)
- `spawnHeadless` 通过 OAR Session 启动 Codex app-server 或 agy ACP 并提交首轮。OAR 的轮次和用量写入协议 JSONL，`quota` 与 `rate_limited` 映射为 `stuck/rate-limit`。四条主表无头样本的 `turn-end` 正文和输入、缓存读、输出用量均与原生记录一致。
- relay 从同一事件目录读取 OAR 完轮事件。实测将一条 TUI 回复与一条 OAR 回复合并，通过 `hc send` 向本卡创建的接收终端 `t2zn` 投递一次，两份归档均与原文逐字一致。混合波次去重也有自动测试覆盖。[投递验证](/Users/sun/Code/exp-relay/mode-bench/_control/relay-live/proof.json)
- 四条无头样本都写入了会话 ID、原生记录绝对路径和结束时间。项目内索引导入后，已逐条使用 `loom hist <addr> --level L2 --json` 读回首轮。Codex 对应 rollout，agy 对应 `transcript_full.jsonl`。
- 实测同一个 Codex OAR Session 完成两轮，第三轮被 `interrupt()` 中断。原生 rollout 显示两轮完成、一轮中断。另在 `codex-headless-1` 的原 cwd 用 `codex resume 01a20ebe-6704-77d1-a441-2b676d1c3402` 打开 TUI，看到原最终正文。启动参数见运行说明。[续作与中断验证](/Users/sun/Code/exp-relay/mode-bench/_control/live-controls/summary.json) · [接手验证](/Users/sun/Code/exp-relay/mode-bench/_control/codex-headless-1/resume-proof.json) · [运行说明](../../runtimes/oar/README.md)
- `node --test runtimes/oar` 通过 3 项，`node --test relay/relay.test.mjs` 通过 13 项。

## 对照实测

八个主表样本分别从 seed 复制到 `/Users/sun/Code/exp-relay/mode-bench/<样本>`。同一任务的四份提示逐字一致，包含公共会话规格和对应任务段，按卡片原文要求以 `完成后最终回复首行 DONE T1` 收尾。Codex 使用 `gpt-6.2-sol` / `high`。四条 agy 主表记录均显示 `gemini-4-neon-xhigh`。

用 `tokens.py` 使用的同一参考解析器计量首轮原生记录。新鲜输入等于完整输入减缓存读，总量等于完整输入加输出。墙钟从发起启动计至 TUI 的原生 Stop 或 OAR 的完轮事件，包含启动耗时。隐藏验收列只统计对应任务。

| 样本 | 任务 | 模型调用 | 新鲜输入 | 缓存读 | 输出 | 总 token | 墙钟（秒） | 隐藏验收 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| codex-tui-1 | T1 | 12 | 52,380 | 388,096 | 12,883 | 453,359 | 285.4 | 4/4 |
| codex-tui-2 | T1 | 10 | 31,487 | 318,720 | 13,530 | 363,737 | 296.6 | 4/4 |
| codex-headless-1 | T1 | 10 | 36,128 | 361,984 | 16,216 | 414,328 | 346.2 | 4/4 |
| codex-headless-2 | T1 | 11 | 32,519 | 382,336 | 11,824 | 426,679 | 260.5 | 4/4 |
| agy-tui-1 | T3 | 7 | 102,859 | 354,007 | 68,261 | 525,127 | 632.7 | 3/3 |
| agy-tui-2 | T3 | 7 | 138,447 | 406,280 | 72,246 | 616,973 | 603.3 | 3/3 |
| agy-headless-1 | T3 | 9 | 106,003 | 515,962 | 72,001 | 693,966 | 619.6 | 2/3 |
| agy-headless-2 | T3 | 8 | 122,192 | 355,349 | 62,304 | 539,845 | 549.2 | 3/3 |

各次会话 ID、记录路径和计量明细保存在 `mode-bench/_control/<样本>/metrics.json`，隐藏验收原始输出在同目录的 `accept.tap`。[八次原始计量](/Users/sun/Code/exp-relay/mode-bench/_control/final-metrics.jsonl)

## 结论与问题

- **Codex** 的无头平均总 token 增加 **2.9%**，新鲜输入减少 **18.1%**，平均墙钟增加 **4.3%**（291.0 秒到 303.4 秒）。T1 四个样本共通过 16/16 项。
- **agy** 在相同 `xhigh` 档位下，无头平均总 token 增加 **8.0%**，新鲜输入减少 **5.4%**，平均墙钟减少 **5.4%**（618.0 秒到 584.4 秒）。T3 四个样本共通过 11/12 项。`agy-headless-1` 的解析器把一个中断轮的 `endedAt` 返回为 `null`，验收要求保留该轮结束时间。[失败项](/Users/sun/Code/exp-relay/mode-bench/_control/agy-headless-1/accept.tap)
- agy 的 TUI 默认 `xhigh`，ACP 默认 `high`。两条 `high` 试跑留存在 `mode-bench/_calibration/`，主表采用显式 `xhigh` 的两条无头补跑。补跑启动时修正了 OAR 订阅游标缺少 `sessionId` 的错误，在提交首轮前重新启动。
- Codex 人工接手首次弹出更新菜单，使用仅对当次进程生效的 `check_for_update_on_startup=false` 后直接打开指定历史。
- 每组仅两次，部分运行在时间上重叠。均值只描述本轮样本，受模型调用次数、缓存命中和运行时负载影响。

操作限定于本卡自建终端、配套项目文件和这些运行产生的原生记录。依赖安装在项目内，参考源码保持只读，工作区改动未提交。

STATUS: done
