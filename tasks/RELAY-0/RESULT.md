# RELAY-0 结果

## 设计

`relay/relay.mjs` 是无模型后台进程。它使用 Node ESM、Node 内置模块、仓库内现有的 transcript 解析器和 `hc`，无需安装 npm 依赖。轮次观察和项目状态处理共 288 行核心代码，命令行入口和 hook 安装独立。

relay 每秒读 `.project/workers.md`，自动发现新增终端，按终端地址和 cwd 关联事件。首次观察到结束时记录在册的派工波次。所有成员结束或 `--window` 秒到期时，用一次 `hc send` 向 Leader 投递，可向 Auditor 发送同一条抄送。晚于窗口的回复进入下一波。中途紧急消息继续由 worker 直接发给当前指挥者。

完整正文保存在 `.project/replies/<任务ID>.md`，并保留每一轮的原文副本。投递中每个 worker 最多展示 16 行，超限时带该轮存档路径。relay 在投递前把 `workers.md` 的状态改为 `done/failed`，结果取正文首行。轮次、未投波次和收件人状态持久化，正常重启或换 Leader 时沿用。新 skill 位于 `skills/project-hc-relay/SKILL.md`，约定 Leader 登记后结束本轮，worker 完成只写最终回复，由 Auditor 接管时重启 relay。

## 各 CLI 的提取路径

| CLI | 优先路径 | 验证 |
| --- | --- | --- |
| Codex | 工作区 `.codex/hooks.json` 捕获 Stop，优先用 `last_assistant_message`，按原生 `turn_id` 去重 | 真实 hc 冒烟 |
| agy | 工作区 `.agents/hooks.json` 捕获 `fullyIdle` Stop，按 `transcriptPath` 读取 `transcript_full.jsonl` 中本轮最终模型正文，按记录身份去重 | 真实 hc 冒烟及相同 `executionNum` 的续跑回放 |
| Claude | 当次 `--settings` 捕获 Stop，从 `transcript_path` 提取主链 assistant 正文，识别 StopFailure | 合成样本 |
| 通用回退 | 用 `hc wait` 核对停止，按 worker cwd 定位对应 transcript。拿不到正文时存 `hc read` 的屏幕尾部，加 `[fallback: hc read]` 标记 | 合成样本 |

## 测试和冒烟

在 Node 25.9.0 上运行 `node --test relay/relay.test.mjs`，退出码 0，10 项通过。覆盖合并与抄送、窗口边界、动态发现、重启和接管、相同正文的续跑、工作目录校验、失败、回退和完整存档。

真实冒烟目录为 `/Users/sun/Code/exp-relay/relay-smoke/`，使用 hc 0.1.22、Codex 0.171.0 和 agy 1.5.16。两个 worker 各写入从 1 到 10 的整数，复核文件各 10 行。agy 首次在工作区信任确认前完成写入，当次没有 Stop 记录。确认信任后，在同一 agy 终端复核行数并捕获了该轮的 Stop。普通 Bash leader 记录实际收到的 bracketed paste。收件日志只有一条，正文如下。

```text
SMOKE-CODEX t2wp DONE
DONE SMOKE-CODEX
codex.txt contains 1 through 10, one per line. Verified 10 lines.

SMOKE-AGY t2wn DONE
DONE SMOKE-AGY
Observed line count from `wc -l < agy.txt`: 10.
```

两份存档与该消息中的正文一致。最终提取代码用原 Stop 记录复核了两段正文。`workers.md` 的实际结果如下。

```text
SMOKE-CODEX | t2wp | codex | done | DONE SMOKE-CODEX
SMOKE-AGY | t2wn | agy | done | DONE SMOKE-AGY
```

已用 `hc kill` 清理本次创建的 relay `t2wq`、leader `t2wm`、Codex worker `t2wp` 和 agy worker `t2wn`，均返回 `finished`。仓库改动在任务指定目录内，未提交 Git。会话记录只读取了冒烟目录所属的 agy transcript。

## 遗留问题与副作用

- Claude 的真实终端链路，以及 Auditor 真实接管，仍待独立冒烟。两者均有合成测试覆盖。
- 无 hook 时需要能把 transcript 绑定到 worker cwd。Codex、agy 的全局会话目录没有做广域扫描。无法定位时使用带标记的屏幕诊断。
- `hc send` 没有按消息 ID 查询送达的接口。发送结果不明时为防重发保留状态和存档，可能需要从存档取回该波通知。
- 冒烟按任务允许对新目录执行了 `hc keys <自己的终端> enter`。Codex 自己在 `~/.codex/config.toml` 持久化了该目录的信任项。hook 配置位于冒烟目录内。

STATUS: done
